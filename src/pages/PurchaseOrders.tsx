import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClipboardList, AlertCircle, ShoppingCart, Package, Check, List, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ReorderGroupedView, OrderedGroupedView } from "@/components/purchase-orders/PurchaseOrderGroupedView";

interface LowStockProduct {
  id: string;
  name: string;
  brand: string;
  master_sku: string;
  barcode: string;
  available_units: number;
  reorder_level: number;
  vendor_name: string;
  mrp: number;
  cost_price: number;
  color?: string;
  standard_size?: string;
}

interface PurchaseOrder {
  id: string;
  product_id: string;
  quantity_ordered: number;
  quantity_received: number;
  status: string;
  ordered_at: string;
  received_at: string | null;
  notes: string | null;
  products: LowStockProduct;
}

export default function PurchaseOrders() {
  const [lowStockProducts, setLowStockProducts] = useState<LowStockProduct[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [orderQuantities, setOrderQuantities] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [reorderViewMode, setReorderViewMode] = useState<"list" | "grouped">("list");
  const [orderedViewMode, setOrderedViewMode] = useState<"list" | "grouped">("list");

  useEffect(() => {
    fetchData();

    const productsChannel = supabase
      .channel("low-stock-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products" },
        () => fetchData()
      )
      .subscribe();

    const ordersChannel = supabase
      .channel("purchase-orders-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "purchase_orders" },
        () => fetchData()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(productsChannel);
      supabase.removeChannel(ordersChannel);
    };
  }, []);

  const fetchData = async () => {
    try {
      const [productsRes, ordersRes] = await Promise.all([
        supabase.from("products").select("*").order("name"),
        supabase
          .from("purchase_orders")
          .select("*, products(*)")
          .in("status", ["ordered", "partially_received"])
          .order("ordered_at", { ascending: false }),
      ]);

      if (productsRes.error) throw productsRes.error;
      if (ordersRes.error) throw ordersRes.error;

      const lowStock = (productsRes.data || []).filter(
        (product) => product.available_units < product.reorder_level
      );

      // Filter out products that already have pending orders
      const orderedProductIds = new Set(
        (ordersRes.data || []).map((o) => o.product_id)
      );
      const filteredLowStock = lowStock.filter(
        (p) => !orderedProductIds.has(p.id)
      );

      setLowStockProducts(filteredLowStock);
      setPurchaseOrders(ordersRes.data || []);

      // Initialize order quantities
      const quantities: Record<string, number> = {};
      filteredLowStock.forEach((p) => {
        quantities[p.id] = p.reorder_level - p.available_units;
      });
      setOrderQuantities(quantities);
    } catch (error) {
      console.error("Error fetching data:", error);
      toast.error("Failed to fetch data");
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAsOrdered = async (product: LowStockProduct) => {
    const quantity = orderQuantities[product.id];
    if (!quantity || quantity <= 0) {
      toast.error("Please enter a valid quantity");
      return;
    }

    setSubmitting(product.id);
    try {
      const { data: userData } = await supabase.auth.getUser();
      
      const { error } = await supabase.from("purchase_orders").insert({
        product_id: product.id,
        quantity_ordered: quantity,
        ordered_by: userData.user?.id,
        status: "ordered",
      });

      if (error) throw error;

      toast.success(`Marked ${product.name} as ordered (${quantity} units)`);
    } catch (error) {
      console.error("Error creating purchase order:", error);
      toast.error("Failed to create purchase order");
    } finally {
      setSubmitting(null);
    }
  };

  const handleMarkAsReceived = async (order: PurchaseOrder, receivedQty?: number) => {
    const qty = receivedQty ?? order.quantity_ordered;
    
    setSubmitting(order.id);
    try {
      const newReceived = order.quantity_received + qty;
      const isFullyReceived = newReceived >= order.quantity_ordered;

      // Update purchase order
      const { error: orderError } = await supabase
        .from("purchase_orders")
        .update({
          quantity_received: newReceived,
          status: isFullyReceived ? "received" : "partially_received",
          received_at: isFullyReceived ? new Date().toISOString() : null,
        })
        .eq("id", order.id);

      if (orderError) throw orderError;

      // Update product inventory
      const { error: productError } = await supabase
        .from("products")
        .update({
          available_units: order.products.available_units + qty,
        })
        .eq("id", order.product_id);

      if (productError) throw productError;

      toast.success(
        isFullyReceived
          ? `Received all ${qty} units of ${order.products.name}`
          : `Received ${qty} units of ${order.products.name}`
      );
    } catch (error) {
      console.error("Error marking as received:", error);
      toast.error("Failed to mark as received");
    } finally {
      setSubmitting(null);
    }
  };

  const totalLowStock = lowStockProducts.length;
  const uniqueVendors = new Set(lowStockProducts.map((p) => p.vendor_name)).size;
  const totalUnitsNeeded = lowStockProducts.reduce(
    (sum, p) => sum + (p.reorder_level - p.available_units),
    0
  );
  const pendingOrders = purchaseOrders.length;
  const totalUnitsOrdered = purchaseOrders.reduce(
    (sum, o) => sum + (o.quantity_ordered - o.quantity_received),
    0
  );

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Purchase Orders</h1>
        <p className="text-muted-foreground">
          Manage reorder list and track ordered inventory
        </p>
      </div>

      <Tabs defaultValue="reorder" className="space-y-6">
        <TabsList>
          <TabsTrigger value="reorder" className="gap-2">
            <AlertCircle className="h-4 w-4" />
            Reorder List
            {totalLowStock > 0 && (
              <Badge variant="secondary" className="ml-1">
                {totalLowStock}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="ordered" className="gap-2">
            <ShoppingCart className="h-4 w-4" />
            Ordered
            {pendingOrders > 0 && (
              <Badge variant="secondary" className="ml-1">
                {pendingOrders}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="reorder" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Items to Reorder</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-warning">{totalLowStock}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Vendors Involved</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{uniqueVendors}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Total Units Needed</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalUnitsNeeded}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Low Stock Products</CardTitle>
                <CardDescription>
                  Products below reorder level requiring restocking
                </CardDescription>
              </div>
              <div className="flex gap-1">
                <Button
                  variant={reorderViewMode === "list" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setReorderViewMode("list")}
                >
                  <List className="h-4 w-4" />
                </Button>
                <Button
                  variant={reorderViewMode === "grouped" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setReorderViewMode("grouped")}
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">Loading products...</div>
              ) : lowStockProducts.length === 0 ? (
                <div className="text-center py-8">
                  <ClipboardList className="mx-auto h-12 w-12 text-muted-foreground mb-2" />
                  <p className="text-muted-foreground">All products are well stocked or already ordered!</p>
                </div>
              ) : reorderViewMode === "grouped" ? (
                <ReorderGroupedView
                  products={lowStockProducts}
                  orderQuantities={orderQuantities}
                  onQuantityChange={(id, qty) =>
                    setOrderQuantities((prev) => ({ ...prev, [id]: qty }))
                  }
                  onMarkAsOrdered={handleMarkAsOrdered}
                  submitting={submitting}
                />
              ) : (
                <div className="space-y-3">
                  {lowStockProducts.map((product) => {
                    const unitsNeeded = product.reorder_level - product.available_units;
                    return (
                      <div
                        key={product.id}
                        className="p-4 rounded-lg border border-warning/30 bg-warning/5 hover:bg-warning/10 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <AlertCircle className="h-5 w-5 text-warning shrink-0" />
                              <h3 className="font-semibold truncate">{product.name}</h3>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                              <div>
                                <span className="text-muted-foreground">Brand:</span>{" "}
                                <span className="font-medium">{product.brand}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">SKU:</span>{" "}
                                <span className="font-medium">{product.master_sku}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Vendor:</span>{" "}
                                <span className="font-medium">{product.vendor_name}</span>
                              </div>
                              {product.color && (
                                <div>
                                  <span className="text-muted-foreground">Color:</span>{" "}
                                  <span className="font-medium">{product.color}</span>
                                </div>
                              )}
                              {product.standard_size && (
                                <div>
                                  <span className="text-muted-foreground">Size:</span>{" "}
                                  <span className="font-medium">{product.standard_size}</span>
                                </div>
                              )}
                              <div>
                                <span className="text-muted-foreground">Cost:</span>{" "}
                                <span className="font-medium">₹{product.cost_price}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 shrink-0">
                            <Badge variant="outline" className="bg-warning/20 text-warning border-warning/30">
                              Available: {product.available_units}
                            </Badge>
                            <Badge variant="outline" className="bg-destructive/20 text-destructive border-destructive/30">
                              Need: {unitsNeeded} units
                            </Badge>
                            <div className="flex items-center gap-2 mt-2">
                              <Input
                                type="number"
                                min={1}
                                value={orderQuantities[product.id] || unitsNeeded}
                                onChange={(e) =>
                                  setOrderQuantities((prev) => ({
                                    ...prev,
                                    [product.id]: parseInt(e.target.value) || 0,
                                  }))
                                }
                                className="w-20 h-8"
                              />
                              <Button
                                size="sm"
                                onClick={() => handleMarkAsOrdered(product)}
                                disabled={submitting === product.id}
                              >
                                <ShoppingCart className="h-4 w-4 mr-1" />
                                Order
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ordered" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Pending Orders</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">{pendingOrders}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Units Awaiting Delivery</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalUnitsOrdered}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Ordered Products</CardTitle>
                <CardDescription>
                  Track orders and mark items as received when they arrive
                </CardDescription>
              </div>
              <div className="flex gap-1">
                <Button
                  variant={orderedViewMode === "list" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setOrderedViewMode("list")}
                >
                  <List className="h-4 w-4" />
                </Button>
                <Button
                  variant={orderedViewMode === "grouped" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setOrderedViewMode("grouped")}
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">Loading orders...</div>
              ) : purchaseOrders.length === 0 ? (
                <div className="text-center py-8">
                  <Package className="mx-auto h-12 w-12 text-muted-foreground mb-2" />
                  <p className="text-muted-foreground">No pending orders</p>
                </div>
              ) : orderedViewMode === "grouped" ? (
                <OrderedGroupedView
                  orders={purchaseOrders}
                  onMarkAsReceived={handleMarkAsReceived}
                  submitting={submitting}
                />
              ) : (
                <div className="space-y-3">
                  {purchaseOrders.map((order) => {
                    const remaining = order.quantity_ordered - order.quantity_received;
                    return (
                      <div
                        key={order.id}
                        className="p-4 rounded-lg border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <ShoppingCart className="h-5 w-5 text-primary shrink-0" />
                              <h3 className="font-semibold truncate">{order.products.name}</h3>
                              {order.status === "partially_received" && (
                                <Badge variant="outline" className="bg-orange-500/20 text-orange-600 border-orange-500/30">
                                  Partial
                                </Badge>
                              )}
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                              <div>
                                <span className="text-muted-foreground">SKU:</span>{" "}
                                <span className="font-medium">{order.products.master_sku}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Vendor:</span>{" "}
                                <span className="font-medium">{order.products.vendor_name}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Ordered:</span>{" "}
                                <span className="font-medium">
                                  {format(new Date(order.ordered_at), "dd MMM yyyy")}
                                </span>
                              </div>
                              {order.products.color && (
                                <div>
                                  <span className="text-muted-foreground">Color:</span>{" "}
                                  <span className="font-medium">{order.products.color}</span>
                                </div>
                              )}
                              {order.products.standard_size && (
                                <div>
                                  <span className="text-muted-foreground">Size:</span>{" "}
                                  <span className="font-medium">{order.products.standard_size}</span>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 shrink-0">
                            <Badge variant="outline" className="bg-primary/20 text-primary border-primary/30">
                              Ordered: {order.quantity_ordered}
                            </Badge>
                            {order.quantity_received > 0 && (
                              <Badge variant="outline" className="bg-green-500/20 text-green-600 border-green-500/30">
                                Received: {order.quantity_received}
                              </Badge>
                            )}
                            <Badge variant="outline" className="bg-muted text-muted-foreground">
                              Remaining: {remaining}
                            </Badge>
                            <Button
                              size="sm"
                              onClick={() => handleMarkAsReceived(order)}
                              disabled={submitting === order.id}
                              className="mt-2"
                            >
                              <Check className="h-4 w-4 mr-1" />
                              Receive All
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
