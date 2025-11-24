import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingCart, Download, Eye, FileArchive, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { InvoiceTemplate } from "@/components/InvoiceTemplate";
import JSZip from 'jszip';

interface SalesOrder {
  id: string;
  order_id: string;
  packet_id: string | null;
  tag_id: string | null;
  platform: string;
  quantity: number;
  created_at: string;
  invoice_number: string | null;
  invoice_date: string | null;
  buyer_name: string | null;
  billing_address: string | null;
  line_items: any;
  total_invoice_value: number | null;
  total_tax: number | null;
  invoice_file_path: string | null;
  invoice_data_missing: boolean | null;
  marketplace_sku: string | null;
  master_sku: string | null;
  products: {
    name: string;
    brand: string;
    master_sku: string;
    barcode: string;
  };
}

export default function SalesOrders() {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [viewingOrder, setViewingOrder] = useState<SalesOrder | null>(null);
  const [downloading, setDownloading] = useState(false);
  
  // Filters
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  
  const { toast } = useToast();

  useEffect(() => {
    fetchOrders();

    const channel = supabase
      .channel("sales-orders-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sales_orders",
        },
        () => {
          fetchOrders();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    applyFilters();
  }, [orders, platformFilter, searchQuery]);

  const fetchOrders = async () => {
    try {
      const { data, error } = await supabase
        .from("sales_orders")
        .select("*, products(name, brand, master_sku, barcode)")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setOrders(data || []);
    } catch (error) {
      console.error("Error fetching sales orders:", error);
      toast({
        title: "Error",
        description: "Failed to fetch sales orders",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...orders];

    if (platformFilter !== "all") {
      filtered = filtered.filter(o => o.platform.toLowerCase() === platformFilter.toLowerCase());
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(o => 
        o.order_id.toLowerCase().includes(query) ||
        o.invoice_number?.toLowerCase().includes(query) ||
        o.products?.name.toLowerCase().includes(query)
      );
    }

    setFilteredOrders(filtered);
  };

  const toggleOrderSelection = (orderId: string) => {
    const newSelected = new Set(selectedOrders);
    if (newSelected.has(orderId)) {
      newSelected.delete(orderId);
    } else {
      newSelected.add(orderId);
    }
    setSelectedOrders(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedOrders.size === filteredOrders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(filteredOrders.map(o => o.id)));
    }
  };

  const handleViewInvoice = (order: SalesOrder) => {
    setViewingOrder(order);
  };

  const handleDownloadInvoice = async (order: SalesOrder) => {
    setDownloading(true);
    try {
      if (!order.invoice_file_path) {
        toast({
          title: "Error",
          description: "No invoice file attached",
          variant: "destructive"
        });
        return;
      }

      // Determine bucket based on path prefix
      const invoicePath = order.invoice_file_path;
      const bucket = invoicePath.startsWith('printed-invoices/') 
        ? 'printed-invoices' 
        : 'order-documents';
      
      // Remove bucket prefix if present
      const filePath = invoicePath.replace(/^(printed-invoices|order-documents)\//, '');

      const { data, error } = await supabase.storage
        .from(bucket)
        .download(filePath);
        
      if (error) throw error;

      const url = window.URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-${order.order_id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      toast({ title: "Success", description: "Invoice downloaded" });
    } catch (error) {
      console.error('Error downloading invoice:', error);
      toast({
        title: "Error",
        description: "Failed to download invoice",
        variant: "destructive"
      });
    } finally {
      setDownloading(false);
    }
  };

  const handleBulkDownload = async () => {
    if (selectedOrders.size === 0) {
      toast({ title: "Warning", description: "No orders selected" });
      return;
    }

    setDownloading(true);
    try {
      const selectedOrdersList = orders.filter(o => selectedOrders.has(o.id));
      const invoiceBlobs: Array<{ orderId: string; blob: Blob }> = [];

      for (const order of selectedOrdersList) {
        try {
          if (order.invoice_file_path) {
            const invoicePath = order.invoice_file_path;
            const bucket = invoicePath.startsWith('printed-invoices/') 
              ? 'printed-invoices' 
              : 'order-documents';
            const filePath = invoicePath.replace(/^(printed-invoices|order-documents)\//, '');

            const { data, error } = await supabase.storage
              .from(bucket)
              .download(filePath);
            
            if (!error && data) {
              invoiceBlobs.push({ orderId: order.order_id, blob: data });
            }
          }
        } catch (err) {
          console.error(`Error processing invoice for ${order.order_id}:`, err);
        }
      }

      if (invoiceBlobs.length === 0) {
        toast({
          title: "No Files",
          description: "No invoice files available for selected orders",
          variant: "destructive"
        });
        return;
      }

      const zip = new JSZip();
      invoiceBlobs.forEach(({ orderId, blob }) => {
        zip.file(`invoice-${orderId}.pdf`, blob);
      });
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      
      const url = window.URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoices-${format(new Date(), 'yyyy-MM-dd')}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast({ 
        title: "Success", 
        description: `Downloaded ${invoiceBlobs.length} invoices` 
      });
    } catch (error) {
      console.error('Error bulk downloading:', error);
      toast({
        title: "Error",
        description: "Failed to download invoices",
        variant: "destructive"
      });
    } finally {
      setDownloading(false);
    }
  };

  const totalOrders = filteredOrders.length;
  const platformCount = new Set(filteredOrders.map((o) => o.platform)).size;
  const totalQuantity = filteredOrders.reduce((sum, o) => sum + o.quantity, 0);

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Sales Orders</h1>
        <p className="text-muted-foreground">
          View and manage invoices for completed orders
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalOrders}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Active Platforms</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{platformCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total Units Shipped</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalQuantity}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <CardTitle>Sales Orders</CardTitle>
              <CardDescription>Select orders to download invoices</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleBulkDownload}
                disabled={selectedOrders.size === 0 || downloading}
                size="sm"
              >
                {downloading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileArchive className="h-4 w-4 mr-2" />
                )}
                Bulk Download ({selectedOrders.size})
              </Button>
            </div>
          </div>
          
          <div className="flex gap-4 mt-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <Input
                placeholder="Search by Order ID, Invoice #, Product..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Select value={platformFilter} onValueChange={setPlatformFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Platforms</SelectItem>
                <SelectItem value="flipkart">Flipkart</SelectItem>
                <SelectItem value="amazon">Amazon</SelectItem>
                <SelectItem value="myntra">Myntra</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {filteredOrders.length === 0 ? (
            <div className="text-center py-8">
              <ShoppingCart className="mx-auto h-12 w-12 text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No sales orders found</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-2 border-b">
                <Checkbox
                  checked={selectedOrders.size === filteredOrders.length && filteredOrders.length > 0}
                  onCheckedChange={toggleSelectAll}
                />
                <span className="text-sm font-medium">Select All</span>
              </div>
              {filteredOrders.map((order) => (
                <div
                  key={order.id}
                  className="p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={selectedOrders.has(order.id)}
                      onCheckedChange={() => toggleOrderSelection(order.id)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">Order #{order.order_id}</h3>
                          <Badge>{order.platform}</Badge>
                          {order.invoice_data_missing && (
                            <Badge variant="destructive">Data Missing</Badge>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleViewInvoice(order)}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleDownloadInvoice(order)}
                            disabled={downloading}
                          >
                            <Download className="h-4 w-4 mr-1" />
                            Download
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">Product:</span>{" "}
                          <span className="font-medium">{order.products?.name || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Quantity:</span>{" "}
                          <span className="font-medium">{order.quantity}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Invoice #:</span>{" "}
                          <span className="font-medium">{order.invoice_number || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Date:</span>{" "}
                          <span className="font-medium">
                            {order.invoice_date ? format(new Date(order.invoice_date), 'dd-MMM-yyyy') : 'N/A'}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Value:</span>{" "}
                          <span className="font-medium">
                            ₹{order.total_invoice_value?.toFixed(2) || '0.00'}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">SKU:</span>{" "}
                          <span className="font-medium">{order.master_sku || 'N/A'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!viewingOrder} onOpenChange={() => setViewingOrder(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invoice - Order #{viewingOrder?.order_id}</DialogTitle>
          </DialogHeader>
          {viewingOrder && (
            <InvoiceTemplate
              data={{
                order_id: viewingOrder.order_id,
                platform: viewingOrder.platform,
                invoice_number: viewingOrder.invoice_number,
                invoice_date: viewingOrder.invoice_date,
                billing_name: viewingOrder.buyer_name,
                billing_address: viewingOrder.billing_address,
                line_items: viewingOrder.line_items || [{
                  description: viewingOrder.products?.name || 'Product',
                  sku: viewingOrder.marketplace_sku || viewingOrder.master_sku,
                  qty: viewingOrder.quantity,
                  rate: viewingOrder.total_invoice_value ? viewingOrder.total_invoice_value / viewingOrder.quantity : 0,
                  taxable_value: viewingOrder.total_invoice_value || 0,
                  gst_rate: 0,
                  gst_amount: viewingOrder.total_tax || 0
                }],
                subtotal: viewingOrder.total_invoice_value,
                tax_total: viewingOrder.total_tax,
                grand_total: (viewingOrder.total_invoice_value || 0) + (viewingOrder.total_tax || 0)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
