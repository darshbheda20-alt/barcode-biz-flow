import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Loader2, Undo, CheckCircle, AlertCircle } from "lucide-react";
import BarcodeScanner from "@/components/BarcodeScanner";
import { DisambiguationModal } from "./DisambiguationModal";
import { MapSkuModal } from "./MapSkuModal";

interface OrderPackingData {
  id: string;
  order_id: string;
  platform: string;
  marketplace_sku: string | null;
  master_sku: string | null;
  product_id: string | null;
  quantity_required: number;
  quantity_scanned: number;
  status: string;
  label_file_path: string | null;
  invoice_file_path: string | null;
}

interface ScanAudit {
  id: string;
  scanned_barcode: string;
  resolved_master_sku: string | null;
  delta: number;
  action: string;
  created_at: string;
}

interface ProductCandidate {
  id: string;
  master_sku: string;
  name: string;
  brand_size: string | null;
  color: string | null;
  available_units: number;
  barcode: string | null;
}

interface SessionMapping {
  barcode: string;
  master_sku: string;
  product_id: string;
  remaining_scans: number;
}

export function PackingInterface() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<OrderPackingData | null>(null);
  const [scanHistory, setScanHistory] = useState<ScanAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [manualBarcode, setManualBarcode] = useState("");
  const [packetId, setPacketId] = useState("");
  
  // Disambiguation state
  const [showDisambiguation, setShowDisambiguation] = useState(false);
  const [candidates, setCandidates] = useState<ProductCandidate[]>([]);
  const [currentBarcode, setCurrentBarcode] = useState("");
  
  // Map SKU modal state
  const [showMapModal, setShowMapModal] = useState(false);
  
  // Session mapping for "apply to next 5 scans"
  const [sessionMapping, setSessionMapping] = useState<SessionMapping | null>(null);

  useEffect(() => {
    if (id) {
      fetchOrderData();
      fetchScanHistory();
    }
  }, [id]);

  const fetchOrderData = async () => {
    try {
      const { data, error } = await supabase
        .from('order_packing')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      setOrder(data);
    } catch (error) {
      console.error('Error fetching order:', error);
      toast({
        title: "Error",
        description: "Failed to load packing order",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchScanHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('packing_scan_audit')
        .select('*')
        .eq('order_packing_id', id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setScanHistory(data || []);
    } catch (error) {
      console.error('Error fetching scan history:', error);
    }
  };

  const handleBarcodeScanned = async (barcode: string) => {
    if (processing) return;
    setProcessing(true);
    setCurrentBarcode(barcode);

    try {
      // Check session mapping first
      if (sessionMapping && sessionMapping.barcode === barcode && sessionMapping.remaining_scans > 0) {
        await processDecrement(barcode, sessionMapping.master_sku, sessionMapping.product_id);
        setSessionMapping({
          ...sessionMapping,
          remaining_scans: sessionMapping.remaining_scans - 1
        });
        setProcessing(false);
        return;
      }

      // Find matching products
      const candidates = await findCandidates(barcode);

      if (candidates.length === 0) {
        setShowMapModal(true);
        setProcessing(false);
        return;
      }

      if (candidates.length === 1) {
        await processDecrement(barcode, candidates[0].master_sku, candidates[0].id);
        setProcessing(false);
        return;
      }

      // Multiple candidates - show disambiguation
      setCandidates(candidates);
      setShowDisambiguation(true);
      setProcessing(false);
    } catch (error) {
      console.error('Error processing barcode:', error);
      toast({
        title: "Error",
        description: "Failed to process barcode scan",
        variant: "destructive"
      });
      setProcessing(false);
    }
  };

  const findCandidates = async (barcode: string): Promise<ProductCandidate[]> => {
    // Search in products.barcode
    const { data: productMatches, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('barcode', barcode);

    if (productError) throw productError;

    // Search in sku_aliases
    const { data: aliasMatches, error: aliasError } = await supabase
      .from('sku_aliases')
      .select('product_id, products(*)')
      .eq('alias_value', barcode);

    if (aliasError) throw aliasError;

    const aliasProducts = aliasMatches?.map(a => a.products).filter(Boolean) || [];
    
    // Combine and deduplicate
    const allProducts = [...(productMatches || []), ...aliasProducts];
    const uniqueProducts = Array.from(
      new Map(allProducts.map(p => [p.id, p])).values()
    );

    return uniqueProducts;
  };

  const processDecrement = async (barcode: string, masterSku: string, productId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    // Start transaction
    const { data: product, error: fetchError } = await supabase
      .from('products')
      .select('available_units')
      .eq('id', productId)
      .single();

    if (fetchError) throw fetchError;

    if (product.available_units <= 0) {
      const shouldContinue = window.confirm(
        `Warning: ${masterSku} has 0 available units. Continue with negative inventory?`
      );
      if (!shouldContinue) return;
    }

    // Decrement inventory atomically
    const { error: updateError } = await supabase
      .from('products')
      .update({ available_units: product.available_units - 1 })
      .eq('id', productId)
      .eq('available_units', product.available_units); // Optimistic locking

    if (updateError) {
      toast({
        title: "Concurrency Error",
        description: "Inventory was updated by another user. Please retry.",
        variant: "destructive"
      });
      throw updateError;
    }

    // Create audit record
    const { error: auditError } = await supabase
      .from('packing_scan_audit')
      .insert({
        order_packing_id: id,
        user_id: user.id,
        scanned_barcode: barcode,
        resolved_master_sku: masterSku,
        product_id: productId,
        delta: 1,
        action: 'scan',
        source: sessionMapping ? 'session_auto' : 'manual'
      });

    if (auditError) throw auditError;

    // Update order_packing quantity
    const newQuantityScanned = (order?.quantity_scanned || 0) + 1;
    const { error: orderError } = await supabase
      .from('order_packing')
      .update({ 
        quantity_scanned: newQuantityScanned,
        status: newQuantityScanned >= (order?.quantity_required || 0) ? 'packing' : 'pending'
      })
      .eq('id', id);

    if (orderError) throw orderError;

    toast({
      title: "Success",
      description: `Scanned ${masterSku} - ${newQuantityScanned}/${order?.quantity_required}`,
    });

    await fetchOrderData();
    await fetchScanHistory();
  };

  const handleDisambiguationSelect = async (candidate: ProductCandidate, applyToNext: boolean) => {
    setShowDisambiguation(false);
    await processDecrement(currentBarcode, candidate.master_sku, candidate.id);
    
    if (applyToNext) {
      setSessionMapping({
        barcode: currentBarcode,
        master_sku: candidate.master_sku,
        product_id: candidate.id,
        remaining_scans: 4 // Already processed 1, so 4 more
      });
      toast({
        title: "Auto-apply enabled",
        description: `Next 4 scans of this barcode will auto-select ${candidate.master_sku}`,
      });
    }
  };

  const handleMapSkuComplete = async (productId: string, masterSku: string) => {
    setShowMapModal(false);
    await processDecrement(currentBarcode, masterSku, productId);
    
    // Update process_orders if this was unmapped
    if (order?.marketplace_sku && !order.master_sku) {
      await supabase
        .from('process_orders')
        .update({ master_sku: masterSku, product_id: productId })
        .eq('order_id', order.order_id)
        .eq('marketplace_sku', order.marketplace_sku);
    }
  };

  const handleUndo = async () => {
    const lastScan = scanHistory[0];
    if (!lastScan) return;

    // Check if within 10 minutes
    const scanTime = new Date(lastScan.created_at).getTime();
    const now = Date.now();
    if (now - scanTime > 10 * 60 * 1000) {
      toast({
        title: "Cannot undo",
        description: "Can only undo scans within 10 minutes",
        variant: "destructive"
      });
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    try {
      // Increment inventory back
      if (lastScan.resolved_master_sku) {
        const { data: product } = await supabase
          .from('products')
          .select('available_units, id')
          .eq('master_sku', lastScan.resolved_master_sku)
          .single();

        if (product) {
          await supabase
            .from('products')
            .update({ available_units: product.available_units + lastScan.delta })
            .eq('id', product.id);
        }
      }

      // Create undo audit record
      await supabase
        .from('packing_scan_audit')
        .insert({
          order_packing_id: id,
          user_id: user.id,
          scanned_barcode: lastScan.scanned_barcode,
          resolved_master_sku: lastScan.resolved_master_sku,
          delta: -lastScan.delta,
          action: 'undo',
          source: 'manual'
        });

      // Update order quantity
      const newQuantityScanned = Math.max(0, (order?.quantity_scanned || 0) - 1);
      await supabase
        .from('order_packing')
        .update({ quantity_scanned: newQuantityScanned })
        .eq('id', id);

      toast({
        title: "Undone",
        description: "Last scan reverted successfully",
      });

      await fetchOrderData();
      await fetchScanHistory();
    } catch (error) {
      console.error('Error undoing scan:', error);
      toast({
        title: "Error",
        description: "Failed to undo last scan",
        variant: "destructive"
      });
    }
  };

  const handleCompletePacking = async () => {
    if (!order) return;

    // For Flipkart, require packet_id
    if (order.platform === 'flipkart' && !packetId.trim()) {
      toast({
        title: "Missing Packet ID",
        description: "Please scan or enter the Packet ID before completing packing",
        variant: "destructive"
      });
      return;
    }

    if (order.quantity_scanned !== order.quantity_required) {
      const shouldContinue = window.confirm(
        `Warning: Scanned ${order.quantity_scanned} but required ${order.quantity_required}. Continue?`
      );
      if (!shouldContinue) return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Fetch invoice data from process_orders
      const { data: processOrderData } = await supabase
        .from('process_orders')
        .select('invoice_number, invoice_date, payment_type, amount, product_name')
        .eq('order_id', order.order_id)
        .eq('platform', order.platform)
        .maybeSingle();

      // Update order_packing
      await supabase
        .from('order_packing')
        .update({
          status: 'packed',
          packed_by: user.id,
          packed_at: new Date().toISOString(),
          packet_id: order.platform === 'flipkart' ? packetId : null
        })
        .eq('id', id);

      // Create sales order with complete invoice data
      await supabase
        .from('sales_orders')
        .insert({
          order_id: order.order_id,
          platform: order.platform,
          marketplace_sku: order.marketplace_sku,
          master_sku: order.master_sku,
          product_id: order.product_id,
          quantity: order.quantity_scanned,
          label_file_path: order.label_file_path,
          invoice_file_path: order.invoice_file_path,
          packet_id: order.platform === 'flipkart' ? packetId : null,
          packed_by: user.id,
          packed_at: new Date().toISOString(),
          // Include invoice data from process_orders
          invoice_number: processOrderData?.invoice_number,
          invoice_date: processOrderData?.invoice_date,
          total_invoice_value: processOrderData?.amount || 0
        });

      toast({
        title: "Success",
        description: "Order packed and sales order created",
      });

      navigate('/process-orders');
    } catch (error) {
      console.error('Error completing packing:', error);
      toast({
        title: "Error",
        description: "Failed to complete packing",
        variant: "destructive"
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!order) {
    return <div>Order not found</div>;
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Pack Order: {order.order_id}</CardTitle>
              <CardDescription>
                {order.platform} • {order.master_sku || order.marketplace_sku}
              </CardDescription>
            </div>
            <Badge variant={order.status === 'packed' ? 'default' : 'secondary'}>
              {order.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Required</p>
              <p className="text-2xl font-bold">{order.quantity_required}</p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Scanned</p>
              <p className="text-2xl font-bold">{order.quantity_scanned}</p>
            </div>
            <div className="border rounded p-4">
              <p className="text-sm text-muted-foreground">Remaining</p>
              <p className="text-2xl font-bold">
                {order.quantity_required - order.quantity_scanned}
              </p>
            </div>
          </div>

          {sessionMapping && sessionMapping.remaining_scans > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded p-4 flex items-center justify-between">
              <div>
                <p className="font-medium">Auto-apply Mode: {sessionMapping.master_sku}</p>
                <p className="text-sm text-muted-foreground">
                  {sessionMapping.remaining_scans} automatic scans remaining
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSessionMapping(null)}
              >
                Stop Auto-apply
              </Button>
            </div>
          )}

          {order.platform === 'flipkart' && (
            <div className="bg-orange-50 border border-orange-200 rounded p-4 space-y-2">
              <label className="text-sm font-medium">Packet ID (Required for Flipkart)</label>
              <Input
                placeholder="Scan or enter Packet ID"
                value={packetId}
                onChange={(e) => setPacketId(e.target.value)}
                className="font-mono"
              />
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Product Barcode</label>
              <BarcodeScanner onScan={handleBarcodeScanned} />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Or enter manually:</label>
              <div className="flex gap-2">
              <Input
                placeholder="Enter barcode manually"
                value={manualBarcode}
                onChange={(e) => setManualBarcode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && manualBarcode) {
                    handleBarcodeScanned(manualBarcode);
                    setManualBarcode("");
                  }
                }}
              />
              <Button
                onClick={() => {
                  if (manualBarcode) {
                    handleBarcodeScanned(manualBarcode);
                    setManualBarcode("");
                  }
                }}
                disabled={!manualBarcode || processing}
              >
                Scan
              </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleUndo}
                disabled={scanHistory.length === 0}
              >
                <Undo className="h-4 w-4 mr-2" />
                Undo Last Scan
              </Button>
              <Button
                onClick={handleCompletePacking}
                disabled={order.quantity_scanned === 0}
                className="flex-1"
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Complete Packing
              </Button>
            </div>
          </div>

          <div>
            <h3 className="font-semibold mb-2">Scan History</h3>
            <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
              {scanHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground p-4 text-center">
                  No scans yet
                </p>
              ) : (
                scanHistory.map((scan) => (
                  <div key={scan.id} className="p-3 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{scan.resolved_master_sku}</p>
                      <p className="text-sm text-muted-foreground">
                        {scan.scanned_barcode} • {scan.action}
                      </p>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {new Date(scan.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <DisambiguationModal
        open={showDisambiguation}
        onClose={() => setShowDisambiguation(false)}
        candidates={candidates}
        barcode={currentBarcode}
        onSelect={handleDisambiguationSelect}
      />

      <MapSkuModal
        open={showMapModal}
        onClose={() => setShowMapModal(false)}
        barcode={currentBarcode}
        onComplete={handleMapSkuComplete}
      />
    </div>
  );
}
