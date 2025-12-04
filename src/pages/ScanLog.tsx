import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { QrCode, PackagePlus, Package, AlertTriangle, X, Undo2, Edit3, XCircle } from "lucide-react";
import { z } from "zod";
import { getUserFriendlyError } from "@/lib/errorHandling";
import BarcodeScanner from "@/components/BarcodeScanner";
import { listenLocalEvent, publishRefreshAll, publishTableRefresh } from "@/lib/eventBus";

const scanSchema = z.object({
  barcode: z.string().trim().min(1, "Barcode is required").max(100, "Barcode must be less than 100 characters"),
  quantity: z.number().int("Quantity must be a whole number").positive("Quantity must be positive").max(10000, "Quantity cannot exceed 10,000"),
  orderId: z.string().max(100, "Order ID must be less than 100 characters").optional(),
  packetId: z.string().max(100, "Packet ID must be less than 100 characters").optional(),
  tagId: z.string().max(100, "Tag ID must be less than 100 characters").optional(),
  platform: z.string().min(1, "Platform is required").max(50, "Platform must be less than 50 characters").optional(),
});

const platforms = ["Amazon", "Flipkart", "Myntra", "Meesho", "Other"];

type Product = {
  id: string;
  name: string;
  master_sku: string;
  color: string | null;
  brand_size: string | null;
  standard_size: string | null;
  available_units: number;
};

export default function ScanLog() {
  const [activeMode, setActiveMode] = useState<"receive" | "pick" | "damage">("receive");
  const [loading, setLoading] = useState(false);

  // Receive section state
  const [scannedBarcode, setScannedBarcode] = useState("");
  const lastScanTimeRef = useRef<number>(0);
  
  // Session state
  const [sessionMode, setSessionMode] = useState(false);
  const [lastBarcode, setLastBarcode] = useState("");
  const [lastSelectedMasterSKU, setLastSelectedMasterSKU] = useState("");
  const [consecutiveCount, setConsecutiveCount] = useState(0);
  const [sessionScans, setSessionScans] = useState<Array<{sku: string, qty: number}>>([]);

  // Auto-map state (Apply to next scans)
  const [activeAutoMap, setActiveAutoMap] = useState<{
    barcode: string;
    master_sku: string;
    remaining_auto_scans: number;
  } | null>(null);
  const [applyToNextScans, setApplyToNextScans] = useState(false);

  // UI state
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmationProduct, setConfirmationProduct] = useState<Product | null>(null);
  const [showSKUSelector, setShowSKUSelector] = useState(false);
  const [candidateProducts, setCandidateProducts] = useState<Product[]>([]);
  const [showUnmappedModal, setShowUnmappedModal] = useState(false);
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [showQuantityEdit, setShowQuantityEdit] = useState(false);
  const [editQuantity, setEditQuantity] = useState("1");
  const [searchQuery, setSearchQuery] = useState("");

  // ===== PICK SECTION STATE =====
  const [pickScannedBarcode, setPickScannedBarcode] = useState("");
  const pickLastScanTimeRef = useRef<number>(0);
  
  // Pick auto-map state
  const [pickActiveAutoMap, setPickActiveAutoMap] = useState<{
    barcode: string;
    master_sku: string;
    product_id: string;
    remaining_auto_scans: number;
  } | null>(null);
  const [pickApplyToNextScans, setPickApplyToNextScans] = useState(false);

  // Pick UI state
  const [showPickConfirmation, setShowPickConfirmation] = useState(false);
  const [pickConfirmationProduct, setPickConfirmationProduct] = useState<Product | null>(null);
  const [showPickSKUSelector, setShowPickSKUSelector] = useState(false);
  const [pickCandidateProducts, setPickCandidateProducts] = useState<Product[]>([]);
  const [showPickUnmappedModal, setShowPickUnmappedModal] = useState(false);
  const [pickSessionScans, setPickSessionScans] = useState<Array<{sku: string, qty: number}>>([]);
  const [showPickQuantityEdit, setShowPickQuantityEdit] = useState(false);
  const [pickEditQuantity, setPickEditQuantity] = useState("1");
  const [showInsufficientStockModal, setShowInsufficientStockModal] = useState(false);
  const [insufficientStockProduct, setInsufficientStockProduct] = useState<Product | null>(null);

  const [receiveData, setReceiveData] = useState({
    barcode: "",
    quantity: "",
  });

  const [pickData, setPickData] = useState({
    barcode: "",
    quantity: "",
    platform: "",
    orderId: "",
    packetId: "",
    tagId: "",
  });

  const [damageData, setDamageData] = useState({
    barcode: "",
    quantity: "",
  });

  // Prevent double scans within 300ms
  const isDuplicateScan = (barcode: string): boolean => {
    const now = Date.now();
    if (barcode === lastBarcode && now - lastScanTimeRef.current < 300) {
      return true;
    }
    lastScanTimeRef.current = now;
    return false;
  };

  // Prevent double scans for Pick within 300ms
  const isPickDuplicateScan = (barcode: string): boolean => {
    const now = Date.now();
    if (barcode === pickScannedBarcode && now - pickLastScanTimeRef.current < 300) {
      return true;
    }
    pickLastScanTimeRef.current = now;
    return false;
  };

  // Resolve barcode to product(s)
  const resolveBarcodeToProducts = async (barcode: string): Promise<Product[]> => {
    // Check sku_aliases
    const { data: aliases } = await supabase
      .from("sku_aliases")
      .select("product_id")
      .eq("alias_type", "barcode")
      .eq("alias_value", barcode);

    // Check products table
    const { data: directProducts } = await supabase
      .from("products")
      .select("id, name, master_sku, color, brand_size, standard_size, available_units")
      .eq("barcode", barcode);

    const productIds = new Set<string>();
    aliases?.forEach(a => productIds.add(a.product_id));
    directProducts?.forEach(p => productIds.add(p.id));

    if (productIds.size === 0) return [];

    const { data: products } = await supabase
      .from("products")
      .select("id, name, master_sku, color, brand_size, standard_size, available_units")
      .in("id", Array.from(productIds));

    return products || [];
  };

  // Handle barcode scan for Receive
  const handleBarcodeScan = async (barcode: string) => {
    if (isDuplicateScan(barcode)) return;

    setScannedBarcode(barcode);

    // Check for active auto-map first
    if (activeAutoMap && barcode === activeAutoMap.barcode) {
      if (activeAutoMap.remaining_auto_scans > 0) {
        // Auto-add without modal
        await addStock(activeAutoMap.master_sku, 1);
        const newRemaining = activeAutoMap.remaining_auto_scans - 1;
        setActiveAutoMap({
          ...activeAutoMap,
          remaining_auto_scans: newRemaining
        });
        toast.success(`Auto-added +1 to ${activeAutoMap.master_sku} (remaining ${newRemaining})`);
        return;
      } else {
        // Remaining is 0, re-prompt
        setActiveAutoMap(null);
        const products = await resolveBarcodeToProducts(barcode);
        if (products.length > 0) {
          setCandidateProducts(products);
          setShowSKUSelector(true);
        }
        return;
      }
    }

    // Different barcode clears auto-map
    if (activeAutoMap && barcode !== activeAutoMap.barcode) {
      setActiveAutoMap(null);
      toast.info("Auto-add ended - different barcode");
    }

    // In session mode, auto-add if same barcode
    if (sessionMode && barcode === lastBarcode) {
      await addStock(lastSelectedMasterSKU, 1);
      setConsecutiveCount(prev => prev + 1);
      toast.success(`Auto-added +1 (${consecutiveCount + 1})`);
      return;
    }

    // Different barcode breaks session mode
    if (sessionMode && barcode !== lastBarcode) {
      setSessionMode(false);
      setConsecutiveCount(0);
      toast.info("Session mode ended - different barcode");
    }

    const products = await resolveBarcodeToProducts(barcode);

    if (products.length === 0) {
      // No match - show unmapped modal
      setShowUnmappedModal(true);
    } else if (products.length === 1) {
      // Exact match - show confirmation
      setConfirmationProduct(products[0]);
      setShowConfirmation(true);
    } else {
      // Multiple matches - show selector
      setCandidateProducts(products);
      setShowSKUSelector(true);
    }
  };

  // ===== PICK BARCODE SCAN HANDLER =====
  const handlePickBarcodeScan = async (barcode: string) => {
    if (isPickDuplicateScan(barcode)) return;

    setPickScannedBarcode(barcode);

    // Check for active auto-map first
    if (pickActiveAutoMap && barcode === pickActiveAutoMap.barcode) {
      if (pickActiveAutoMap.remaining_auto_scans > 0) {
        // Check stock before auto-pick
        const { data: product } = await supabase
          .from("products")
          .select("id, name, master_sku, available_units, color, brand_size, standard_size")
          .eq("id", pickActiveAutoMap.product_id)
          .single();

        if (product && product.available_units < 1) {
          setInsufficientStockProduct(product);
          setShowInsufficientStockModal(true);
          return;
        }

        // Auto-pick without modal
        await pickStock(pickActiveAutoMap.product_id, pickActiveAutoMap.master_sku, 1);
        const newRemaining = pickActiveAutoMap.remaining_auto_scans - 1;
        setPickActiveAutoMap({
          ...pickActiveAutoMap,
          remaining_auto_scans: newRemaining
        });
        toast.success(`Auto-picked -1 from ${pickActiveAutoMap.master_sku} (remaining ${newRemaining})`);
        return;
      } else {
        // Remaining is 0, re-prompt
        setPickActiveAutoMap(null);
        const products = await resolveBarcodeToProducts(barcode);
        if (products.length > 0) {
          setPickCandidateProducts(products);
          setShowPickSKUSelector(true);
        }
        return;
      }
    }

    // Different barcode clears auto-map
    if (pickActiveAutoMap && barcode !== pickActiveAutoMap.barcode) {
      setPickActiveAutoMap(null);
      toast.info("Auto-pick ended - different barcode");
    }

    const products = await resolveBarcodeToProducts(barcode);

    if (products.length === 0) {
      // No match - show unmapped modal
      setShowPickUnmappedModal(true);
    } else if (products.length === 1) {
      // Exact match - show confirmation
      setPickConfirmationProduct(products[0]);
      setShowPickConfirmation(true);
    } else {
      // Multiple matches - show selector
      setPickCandidateProducts(products);
      setShowPickSKUSelector(true);
    }
  };

  // Add stock to database (Receive)
  const addStock = async (masterSKU: string, qty: number) => {
    const { data: product } = await supabase
      .from("products")
      .select("id")
      .eq("master_sku", masterSKU)
      .single();

    if (!product) {
      toast.error("Product not found");
      return;
    }

    const { error } = await supabase.from("scan_logs").insert({
      product_id: product.id,
      scan_mode: "receive",
      quantity: qty,
    });

    if (error) {
      toast.error(getUserFriendlyError(error));
      return;
    }

    setSessionScans(prev => [...prev, { sku: masterSKU, qty }]);
    
    // Trigger refresh for products and scan_logs
    publishTableRefresh('products');
    publishTableRefresh('scan_logs');
  };

  // ===== PICK STOCK FUNCTION =====
  const pickStock = async (productId: string, masterSKU: string, qty: number) => {
    // Verify stock availability
    const { data: product } = await supabase
      .from("products")
      .select("available_units")
      .eq("id", productId)
      .single();

    if (!product) {
      toast.error("Product not found");
      return false;
    }

    if (product.available_units < qty) {
      toast.error(`Insufficient stock! Available: ${product.available_units} units`);
      return false;
    }

    const { error } = await supabase.from("scan_logs").insert({
      product_id: productId,
      scan_mode: "pick",
      quantity: qty,
      platform: pickData.platform || null,
      order_id: pickData.orderId || null,
      packet_id: pickData.packetId || null,
      tag_id: pickData.tagId || null,
    });

    if (error) {
      toast.error(getUserFriendlyError(error));
      return false;
    }

    // Create sales order if we have order info
    if (pickData.orderId && pickData.platform) {
      const { error: orderError } = await supabase.from("sales_orders").insert({
        order_id: pickData.orderId,
        packet_id: pickData.packetId || null,
        tag_id: pickData.tagId || null,
        platform: pickData.platform,
        product_id: productId,
        quantity: qty,
        marketplace_sku: masterSKU,
        master_sku: masterSKU,
      });

      if (orderError) {
        console.error("Error creating sales order:", orderError);
        // Don't fail the pick, just log the error
      }
    }

    setPickSessionScans(prev => [...prev, { sku: masterSKU, qty }]);
    
    // Trigger refresh for products and scan_logs
    publishTableRefresh('products');
    publishTableRefresh('scan_logs');
    publishTableRefresh('sales_orders');

    return true;
  };

  // Handle confirmation (single match) for Receive
  const handleConfirmSingle = async (customQty?: number) => {
    if (!confirmationProduct) return;

    const qty = customQty || 1;
    await addStock(confirmationProduct.master_sku, qty);

    setLastBarcode(scannedBarcode);
    setLastSelectedMasterSKU(confirmationProduct.master_sku);
    setConsecutiveCount(prev => prev + 1);

    // If "Apply to next scans" was checked, set active auto-map
    if (applyToNextScans) {
      setActiveAutoMap({
        barcode: scannedBarcode,
        master_sku: confirmationProduct.master_sku,
        remaining_auto_scans: Math.max(0, 5 - qty)
      });
      toast.success(`Auto-add enabled for ${confirmationProduct.master_sku} (${5 - qty} remaining)`);
    } else if (consecutiveCount + 1 >= 5 && !sessionMode) {
      setShowSessionModal(true);
    } else {
      toast.success(`Stock received: +${qty}`);
    }

    setShowConfirmation(false);
    setConfirmationProduct(null);
    setApplyToNextScans(false);
  };

  // ===== PICK CONFIRMATION HANDLER =====
  const handlePickConfirmSingle = async (customQty?: number) => {
    if (!pickConfirmationProduct) return;

    const qty = customQty || 1;

    // Check stock
    if (pickConfirmationProduct.available_units < qty) {
      setInsufficientStockProduct(pickConfirmationProduct);
      setShowInsufficientStockModal(true);
      setShowPickConfirmation(false);
      return;
    }

    const success = await pickStock(pickConfirmationProduct.id, pickConfirmationProduct.master_sku, qty);

    if (success) {
      // If "Apply to next scans" was checked, set active auto-map
      if (pickApplyToNextScans) {
        setPickActiveAutoMap({
          barcode: pickScannedBarcode,
          master_sku: pickConfirmationProduct.master_sku,
          product_id: pickConfirmationProduct.id,
          remaining_auto_scans: Math.max(0, 5 - qty)
        });
        toast.success(`Auto-pick enabled for ${pickConfirmationProduct.master_sku} (${5 - qty} remaining)`);
      } else {
        toast.success(`Stock picked: -${qty}`);
      }
    }

    setShowPickConfirmation(false);
    setPickConfirmationProduct(null);
    setPickApplyToNextScans(false);
  };

  // Handle SKU selection (multiple matches) for Receive
  const handleSKUSelect = async (product: Product, customQty?: number) => {
    const qty = customQty || 1;
    await addStock(product.master_sku, qty);

    setLastBarcode(scannedBarcode);
    setLastSelectedMasterSKU(product.master_sku);
    setConsecutiveCount(1);

    // If "Apply to next scans" was checked, set active auto-map
    if (applyToNextScans) {
      setActiveAutoMap({
        barcode: scannedBarcode,
        master_sku: product.master_sku,
        remaining_auto_scans: Math.max(0, 5 - qty) // Reduce by qty if custom
      });
      toast.success(`Auto-add enabled for ${product.master_sku} (${5 - qty} remaining)`);
    } else {
      toast.success(`Mapped to ${product.master_sku}`);
    }

    setShowSKUSelector(false);
    setCandidateProducts([]);
    setApplyToNextScans(false);
  };

  // ===== PICK SKU SELECTION HANDLER =====
  const handlePickSKUSelect = async (product: Product, customQty?: number) => {
    const qty = customQty || 1;

    // Check stock
    if (product.available_units < qty) {
      setInsufficientStockProduct(product);
      setShowInsufficientStockModal(true);
      setShowPickSKUSelector(false);
      return;
    }

    const success = await pickStock(product.id, product.master_sku, qty);

    if (success) {
      // If "Apply to next scans" was checked, set active auto-map
      if (pickApplyToNextScans) {
        setPickActiveAutoMap({
          barcode: pickScannedBarcode,
          master_sku: product.master_sku,
          product_id: product.id,
          remaining_auto_scans: Math.max(0, 5 - qty)
        });
        toast.success(`Auto-pick enabled for ${product.master_sku} (${5 - qty} remaining)`);
      } else {
        toast.success(`Picked from ${product.master_sku}`);
      }
    }

    setShowPickSKUSelector(false);
    setPickCandidateProducts([]);
    setPickApplyToNextScans(false);
  };

  // Enable session auto-add mode
  const enableSessionMode = () => {
    setSessionMode(true);
    setShowSessionModal(false);
    toast.success(`Auto-add enabled for ${lastSelectedMasterSKU}`);
  };

  // Stop session mode
  const stopSessionMode = () => {
    setSessionMode(false);
    setConsecutiveCount(0);
    setShowSessionModal(false);
    toast.info("Session stopped");
  };

  // Undo last scan (Receive)
  const handleUndo = () => {
    if (sessionScans.length === 0) {
      toast.error("No scans to undo");
      return;
    }
    // In real implementation, would delete last scan_log entry
    const last = sessionScans[sessionScans.length - 1];
    setSessionScans(prev => prev.slice(0, -1));
    setConsecutiveCount(prev => Math.max(0, prev - 1));
    toast.success(`Undone: ${last.sku} -${last.qty}`);
  };

  // Undo last scan (Pick)
  const handlePickUndo = () => {
    if (pickSessionScans.length === 0) {
      toast.error("No scans to undo");
      return;
    }
    const last = pickSessionScans[pickSessionScans.length - 1];
    setPickSessionScans(prev => prev.slice(0, -1));
    toast.success(`Undone: ${last.sku} +${last.qty} (stock restored)`);
  };

  const handleReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleBarcodeScan(receiveData.barcode);
    setReceiveData({ barcode: "", quantity: "" });
  };

  const handlePick = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!pickData.barcode.trim()) {
      toast.error("Barcode is required");
      return;
    }

    // Use the same disambiguation flow as the barcode scanner
    await handlePickBarcodeScan(pickData.barcode.trim());
    
    // Clear the barcode field after processing
    setPickData(prev => ({ ...prev, barcode: "" }));
  };

  const handleDamage = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const validation = scanSchema.safeParse({
        barcode: damageData.barcode,
        quantity: parseInt(damageData.quantity),
      });

      if (!validation.success) {
        toast.error(validation.error.issues[0].message);
        setLoading(false);
        return;
      }

      const { data: product, error: productError } = await supabase
        .from("products")
        .select("id")
        .eq("barcode", validation.data.barcode)
        .single();

      if (productError || !product) {
        toast.error("Product not found with this barcode");
        return;
      }

      const { error } = await supabase.from("scan_logs").insert({
        product_id: product.id,
        scan_mode: "damage",
        quantity: validation.data.quantity,
      });

      if (error) throw error;

      toast.success("Damage recorded successfully!");
      setDamageData({ barcode: "", quantity: "" });
    } catch (error: any) {
      console.error("Error recording damage:", error);
      toast.error(getUserFriendlyError(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Scan Log</h1>
        <p className="text-muted-foreground">Record stock movements through scanning</p>
      </div>

      <Tabs value={activeMode} onValueChange={(v) => setActiveMode(v as any)}>
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="receive">
            <PackagePlus className="mr-2 h-4 w-4" />
            Receive
          </TabsTrigger>
          <TabsTrigger value="pick">
            <Package className="mr-2 h-4 w-4" />
            Pick
          </TabsTrigger>
          <TabsTrigger value="damage">
            <AlertTriangle className="mr-2 h-4 w-4" />
            Damage
          </TabsTrigger>
        </TabsList>

        <TabsContent value="receive">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <QrCode className="h-5 w-5 text-success" />
                Receive Stock
              </CardTitle>
              <CardDescription>Scan products to add to available inventory</CardDescription>
            </CardHeader>
            <CardContent>
              {activeAutoMap && (
                <div className="mb-4 p-3 bg-primary/10 border border-primary rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                    <span className="font-medium">
                      Auto-add: {activeAutoMap.master_sku} (Remaining: {activeAutoMap.remaining_auto_scans})
                    </span>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => {
                      setActiveAutoMap(null);
                      toast.info("Auto-add stopped");
                    }}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Stop
                  </Button>
                </div>
              )}

              {sessionMode && (
                <div className="mb-4 p-3 bg-primary/10 border border-primary rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                    <span className="font-medium">Auto-Add Mode: {lastSelectedMasterSKU}</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={stopSessionMode}>
                    <X className="h-4 w-4 mr-1" />
                    Stop
                  </Button>
                </div>
              )}

              <div className="space-y-4">
                <BarcodeScanner onScan={handleBarcodeScan} />

                <form onSubmit={handleReceive} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="receive-barcode">Or Enter Barcode Manually</Label>
                    <Input
                      id="receive-barcode"
                      placeholder="Enter barcode"
                      value={receiveData.barcode}
                      onChange={(e) => setReceiveData({ ...receiveData, barcode: e.target.value })}
                    />
                  </div>
                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? "Processing..." : "Submit"}
                  </Button>
                </form>

                {sessionScans.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Session Scans ({sessionScans.length})</Label>
                      <Button variant="ghost" size="sm" onClick={handleUndo}>
                        <Undo2 className="h-4 w-4 mr-1" />
                        Undo
                      </Button>
                    </div>
                    <div className="max-h-32 overflow-y-auto space-y-1 text-sm">
                      {sessionScans.map((scan, i) => (
                        <div key={i} className="flex justify-between p-2 bg-muted/50 rounded">
                          <span>{scan.sku}</span>
                          <span>+{scan.qty}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Confirmation Modal - Single Match */}
          <Dialog open={showConfirmation} onOpenChange={setShowConfirmation}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm Product</DialogTitle>
                <DialogDescription>Verify this is the correct product</DialogDescription>
              </DialogHeader>
              
              {confirmationProduct && (
                <div className="space-y-4">
                  <div className="p-4 bg-muted rounded-lg space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Product:</span>
                      <span className="font-medium">{confirmationProduct.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Master SKU:</span>
                      <span className="font-mono font-bold">{confirmationProduct.master_sku}</span>
                    </div>
                    {confirmationProduct.brand_size && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Size:</span>
                        <span>{confirmationProduct.brand_size}</span>
                      </div>
                    )}
                    {confirmationProduct.color && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Color:</span>
                        <span>{confirmationProduct.color}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Available:</span>
                      <span className="font-medium">{confirmationProduct.available_units} units</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <Checkbox 
                        id="apply-to-next" 
                        checked={applyToNextScans}
                        onCheckedChange={(checked) => setApplyToNextScans(checked as boolean)}
                      />
                      <label htmlFor="apply-to-next" className="text-sm cursor-pointer font-medium">
                        Apply to next scans (up to 5)
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground ml-6">
                      If checked, this SKU will be auto-selected for the next scans of this barcode. You will be re-prompted after every 5 scans.
                    </p>
                  </div>
                </div>
              )}

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setShowConfirmation(false)}>
                  Cancel
                </Button>
                <Button variant="outline" onClick={() => {
                  setShowConfirmation(false);
                  setActiveAutoMap(null); // Clear auto-map when changing SKU
                  setShowSKUSelector(true);
                  setCandidateProducts(confirmationProduct ? [confirmationProduct] : []);
                }}>
                  Change SKU
                </Button>
                <Button variant="outline" onClick={() => {
                  setShowQuantityEdit(true);
                  setShowConfirmation(false);
                }}>
                  <Edit3 className="h-4 w-4 mr-1" />
                  Edit Qty
                </Button>
                <Button onClick={() => handleConfirmSingle()}>
                  Confirm (+1)
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Quantity Edit Modal */}
          <Dialog open={showQuantityEdit} onOpenChange={setShowQuantityEdit}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Quantity</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Quantity</Label>
                  <Input
                    type="number"
                    min="1"
                    value={editQuantity}
                    onChange={(e) => setEditQuantity(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowQuantityEdit(false)}>
                  Cancel
                </Button>
                <Button onClick={() => {
                  handleConfirmSingle(parseInt(editQuantity));
                  setShowQuantityEdit(false);
                  setEditQuantity("1");
                }}>
                  Confirm
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* SKU Selector Modal - Multiple Matches */}
          <Dialog open={showSKUSelector} onOpenChange={setShowSKUSelector}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Select Correct Master SKU</DialogTitle>
                <DialogDescription>Multiple products share this barcode</DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="apply-to-next-multi" 
                      checked={applyToNextScans}
                      onCheckedChange={(checked) => setApplyToNextScans(checked as boolean)}
                    />
                    <label htmlFor="apply-to-next-multi" className="text-sm cursor-pointer font-medium">
                      Apply to next scans (up to 5)
                    </label>
                    {applyToNextScans && (
                      <span className="text-xs text-primary font-medium ml-auto">
                        Remaining: 5
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground ml-6">
                    If checked, this SKU will be auto-selected for the next scans of this barcode. You will be re-prompted after every 5 scans.
                  </p>
                </div>

                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {candidateProducts.map((product) => (
                    <button
                      key={product.id}
                      onClick={() => handleSKUSelect(product)}
                      className="w-full p-4 border rounded-lg hover:bg-muted/50 text-left transition-colors"
                    >
                      <div className="space-y-2">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-medium">{product.name}</div>
                            <div className="font-mono text-sm text-primary">{product.master_sku}</div>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            Stock: {product.available_units}
                          </div>
                        </div>
                        <div className="flex gap-4 text-sm text-muted-foreground">
                          {product.brand_size && <span>Size: {product.brand_size}</span>}
                          {product.color && <span>Color: {product.color}</span>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowSKUSelector(false)}>
                  Cancel
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Unmapped Barcode Modal */}
          <Dialog open={showUnmappedModal} onOpenChange={setShowUnmappedModal}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Barcode Not Recognized</DialogTitle>
                <DialogDescription>
                  Barcode: <span className="font-mono font-bold">{scannedBarcode}</span>
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Search Existing Products</Label>
                  <Input
                    placeholder="Search by SKU or name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <div className="text-sm text-muted-foreground">
                  To create a new product, go to Product Management
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowUnmappedModal(false)}>
                  Skip
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Session Modal - 5 consecutive scans */}
          <Dialog open={showSessionModal} onOpenChange={setShowSessionModal}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Continue with Same SKU?</DialogTitle>
                <DialogDescription>
                  You've scanned 5 units of {lastSelectedMasterSKU}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <p className="text-sm text-muted-foreground">
                  Enable auto-add mode to automatically add +1 for each scan of the same barcode without confirmation.
                </p>
              </div>

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={stopSessionMode}>
                  Stop
                </Button>
                <Button variant="outline" onClick={() => {
                  setActiveAutoMap(null); // Clear auto-map when changing SKU
                  setShowSessionModal(false);
                  setShowSKUSelector(true);
                }}>
                  Change SKU
                </Button>
                <Button onClick={enableSessionMode}>
                  Yes — Continue Auto-Add
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="pick">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <QrCode className="h-5 w-5 text-primary" />
                Pick for Order
              </CardTitle>
              <CardDescription>Scan products to fulfill orders and reduce stock</CardDescription>
            </CardHeader>
            <CardContent>
              {/* Auto-pick indicator */}
              {pickActiveAutoMap && (
                <div className="mb-4 p-3 bg-destructive/10 border border-destructive rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
                    <span className="font-medium">
                      Auto-pick: {pickActiveAutoMap.master_sku} (Remaining: {pickActiveAutoMap.remaining_auto_scans})
                    </span>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => {
                      setPickActiveAutoMap(null);
                      toast.info("Auto-pick stopped");
                    }}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Stop
                  </Button>
                </div>
              )}

              <div className="space-y-4">
                {/* Order Info Section */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg">
                  <div className="space-y-2">
                    <Label htmlFor="pick-platform">Platform</Label>
                    <Select
                      value={pickData.platform}
                      onValueChange={(value) =>
                        setPickData({ ...pickData, platform: value })
                      }
                    >
                      <SelectTrigger id="pick-platform">
                        <SelectValue placeholder="Select platform" />
                      </SelectTrigger>
                      <SelectContent>
                        {platforms.map((platform) => (
                          <SelectItem key={platform} value={platform}>
                            {platform}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="pick-order-id">Order ID</Label>
                    <Input
                      id="pick-order-id"
                      placeholder="Enter order ID"
                      value={pickData.orderId}
                      onChange={(e) =>
                        setPickData({ ...pickData, orderId: e.target.value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="pick-packet-id">Packet ID</Label>
                    <Input
                      id="pick-packet-id"
                      placeholder="Enter packet ID"
                      value={pickData.packetId}
                      onChange={(e) =>
                        setPickData({ ...pickData, packetId: e.target.value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="pick-tag-id">Tag ID</Label>
                    <Input
                      id="pick-tag-id"
                      placeholder="Enter tag ID"
                      value={pickData.tagId}
                      onChange={(e) =>
                        setPickData({ ...pickData, tagId: e.target.value })
                      }
                    />
                  </div>
                </div>

                {/* Barcode Scanner */}
                <BarcodeScanner onScan={handlePickBarcodeScan} />

                {/* Manual Entry */}
                <form onSubmit={handlePick} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="pick-barcode">Or Enter Barcode Manually</Label>
                    <Input
                      id="pick-barcode"
                      placeholder="Enter barcode"
                      value={pickData.barcode}
                      onChange={(e) =>
                        setPickData({ ...pickData, barcode: e.target.value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="pick-quantity">Quantity</Label>
                    <Input
                      id="pick-quantity"
                      type="number"
                      min="1"
                      placeholder="1"
                      value={pickData.quantity}
                      onChange={(e) =>
                        setPickData({ ...pickData, quantity: e.target.value })
                      }
                    />
                  </div>

                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? "Processing..." : "Submit Pick"}
                  </Button>
                </form>

                {/* Session Scans */}
                {pickSessionScans.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Session Picks ({pickSessionScans.length})</Label>
                      <Button variant="ghost" size="sm" onClick={handlePickUndo}>
                        <Undo2 className="h-4 w-4 mr-1" />
                        Undo
                      </Button>
                    </div>
                    <div className="max-h-32 overflow-y-auto space-y-1 text-sm">
                      {pickSessionScans.map((scan, i) => (
                        <div key={i} className="flex justify-between p-2 bg-destructive/10 rounded">
                          <span>{scan.sku}</span>
                          <span className="text-destructive">-{scan.qty}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Pick Confirmation Modal - Single Match */}
          <Dialog open={showPickConfirmation} onOpenChange={setShowPickConfirmation}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm Pick</DialogTitle>
                <DialogDescription>Verify this is the correct product to pick</DialogDescription>
              </DialogHeader>
              
              {pickConfirmationProduct && (
                <div className="space-y-4">
                  <div className="p-4 bg-muted rounded-lg space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Product:</span>
                      <span className="font-medium">{pickConfirmationProduct.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Master SKU:</span>
                      <span className="font-mono font-bold">{pickConfirmationProduct.master_sku}</span>
                    </div>
                    {pickConfirmationProduct.brand_size && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Size:</span>
                        <span>{pickConfirmationProduct.brand_size}</span>
                      </div>
                    )}
                    {pickConfirmationProduct.color && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Color:</span>
                        <span>{pickConfirmationProduct.color}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Available:</span>
                      <span className={`font-medium ${pickConfirmationProduct.available_units < 5 ? 'text-destructive' : ''}`}>
                        {pickConfirmationProduct.available_units} units
                      </span>
                    </div>
                  </div>

                  {pickConfirmationProduct.available_units < 5 && (
                    <div className="flex items-center gap-2 p-2 bg-destructive/10 border border-destructive/30 rounded text-sm text-destructive">
                      <AlertTriangle className="h-4 w-4" />
                      Low stock warning!
                    </div>
                  )}

                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <Checkbox 
                        id="pick-apply-to-next" 
                        checked={pickApplyToNextScans}
                        onCheckedChange={(checked) => setPickApplyToNextScans(checked as boolean)}
                      />
                      <label htmlFor="pick-apply-to-next" className="text-sm cursor-pointer font-medium">
                        Apply to next scans (up to 5)
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground ml-6">
                      If checked, this SKU will be auto-selected for the next picks of this barcode.
                    </p>
                  </div>
                </div>
              )}

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setShowPickConfirmation(false)}>
                  Cancel
                </Button>
                <Button variant="outline" onClick={() => {
                  setShowPickConfirmation(false);
                  setPickActiveAutoMap(null);
                  setShowPickSKUSelector(true);
                  setPickCandidateProducts(pickConfirmationProduct ? [pickConfirmationProduct] : []);
                }}>
                  Change SKU
                </Button>
                <Button variant="outline" onClick={() => {
                  setShowPickQuantityEdit(true);
                  setShowPickConfirmation(false);
                }}>
                  <Edit3 className="h-4 w-4 mr-1" />
                  Edit Qty
                </Button>
                <Button variant="destructive" onClick={() => handlePickConfirmSingle()}>
                  Confirm (-1)
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Pick Quantity Edit Modal */}
          <Dialog open={showPickQuantityEdit} onOpenChange={setShowPickQuantityEdit}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Pick Quantity</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Quantity</Label>
                  <Input
                    type="number"
                    min="1"
                    value={pickEditQuantity}
                    onChange={(e) => setPickEditQuantity(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowPickQuantityEdit(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={() => {
                  handlePickConfirmSingle(parseInt(pickEditQuantity));
                  setShowPickQuantityEdit(false);
                  setPickEditQuantity("1");
                }}>
                  Confirm Pick
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Pick SKU Selector Modal - Multiple Matches */}
          <Dialog open={showPickSKUSelector} onOpenChange={setShowPickSKUSelector}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Select Correct Master SKU</DialogTitle>
                <DialogDescription>Multiple products share this barcode - select the one to pick from</DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="pick-apply-to-next-multi" 
                      checked={pickApplyToNextScans}
                      onCheckedChange={(checked) => setPickApplyToNextScans(checked as boolean)}
                    />
                    <label htmlFor="pick-apply-to-next-multi" className="text-sm cursor-pointer font-medium">
                      Apply to next scans (up to 5)
                    </label>
                    {pickApplyToNextScans && (
                      <span className="text-xs text-destructive font-medium ml-auto">
                        Remaining: 5
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground ml-6">
                    If checked, this SKU will be auto-selected for the next picks of this barcode.
                  </p>
                </div>

                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {pickCandidateProducts.map((product) => (
                    <button
                      key={product.id}
                      onClick={() => handlePickSKUSelect(product)}
                      className="w-full p-4 border rounded-lg hover:bg-muted/50 text-left transition-colors"
                    >
                      <div className="space-y-2">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-medium">{product.name}</div>
                            <div className="font-mono text-sm text-primary">{product.master_sku}</div>
                          </div>
                          <div className={`text-sm ${product.available_units < 5 ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                            Stock: {product.available_units}
                          </div>
                        </div>
                        <div className="flex gap-4 text-sm text-muted-foreground">
                          {product.brand_size && <span>Size: {product.brand_size}</span>}
                          {product.color && <span>Color: {product.color}</span>}
                        </div>
                        {product.available_units < 1 && (
                          <div className="text-xs text-destructive flex items-center gap-1">
                            <XCircle className="h-3 w-3" />
                            Out of stock
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowPickSKUSelector(false)}>
                  Cancel
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Pick Unmapped Barcode Modal */}
          <Dialog open={showPickUnmappedModal} onOpenChange={setShowPickUnmappedModal}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Barcode Not Recognized</DialogTitle>
                <DialogDescription>
                  Barcode: <span className="font-mono font-bold">{pickScannedBarcode}</span>
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  This barcode is not linked to any product. Please map it in Product Management first.
                </p>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowPickUnmappedModal(false)}>
                  Close
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Insufficient Stock Modal */}
          <Dialog open={showInsufficientStockModal} onOpenChange={setShowInsufficientStockModal}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                  Insufficient Stock
                </DialogTitle>
              </DialogHeader>

              {insufficientStockProduct && (
                <div className="space-y-4">
                  <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Product:</span>
                      <span className="font-medium">{insufficientStockProduct.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Master SKU:</span>
                      <span className="font-mono font-bold">{insufficientStockProduct.master_sku}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Available:</span>
                      <span className="font-medium text-destructive">{insufficientStockProduct.available_units} units</span>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Cannot pick from this product as there is insufficient stock available.
                  </p>
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowInsufficientStockModal(false)}>
                  Close
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="damage">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <QrCode className="h-5 w-5 text-destructive" />
                Record Damage
              </CardTitle>
              <CardDescription>Scan damaged products to track losses</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleDamage} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="damage-barcode">Product Barcode *</Label>
                  <Input
                    id="damage-barcode"
                    placeholder="Scan or enter barcode"
                    required
                    value={damageData.barcode}
                    onChange={(e) =>
                      setDamageData({ ...damageData, barcode: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="damage-quantity">Quantity *</Label>
                  <Input
                    id="damage-quantity"
                    type="number"
                    min="1"
                    required
                    value={damageData.quantity}
                    onChange={(e) =>
                      setDamageData({ ...damageData, quantity: e.target.value })
                    }
                  />
                </div>

                <Button type="submit" disabled={loading} className="w-full" variant="destructive">
                  {loading ? "Processing..." : "Record Damage"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
