import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart } from "lucide-react";
import { format } from "date-fns";

interface SalesOrder {
  id: string;
  order_id: string;
  packet_id: string | null;
  tag_id: string | null;
  platform: string;
  quantity: number;
  created_at: string;
  products: {
    name: string;
    brand: string;
    master_sku: string;
    barcode: string;
  };
}

export default function SalesOrders() {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);

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
    } finally {
      setLoading(false);
    }
  };

  const totalOrders = orders.length;
  const platformCount = new Set(orders.map((o) => o.platform)).size;
  const totalQuantity = orders.reduce((sum, o) => sum + o.quantity, 0);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Sales Orders</h1>
        <p className="text-muted-foreground">
          Auto-populated from pick scans - track all fulfilled orders
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
          <CardTitle>All Sales Orders</CardTitle>
          <CardDescription>Complete order history from pick operations</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading orders...</div>
          ) : orders.length === 0 ? (
            <div className="text-center py-8">
              <ShoppingCart className="mx-auto h-12 w-12 text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No sales orders yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Orders will appear here when you pick items in Scan Log
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map((order) => (
                <div
                  key={order.id}
                  className="p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold">Order #{order.order_id}</h3>
                        <Badge>{order.platform}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {format(new Date(order.created_at), "PPp")}
                      </div>
                    </div>
                    <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                      Qty: {order.quantity}
                    </Badge>
                  </div>

                  <div className="mt-3 pt-3 border-t">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Product:</span>{" "}
                        <span className="font-medium">{order.products.name}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Brand:</span>{" "}
                        <span className="font-medium">{order.products.brand}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">SKU:</span>{" "}
                        <span className="font-medium">{order.products.master_sku}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Barcode:</span>{" "}
                        <span className="font-medium">{order.products.barcode}</span>
                      </div>
                      {order.packet_id && (
                        <div>
                          <span className="text-muted-foreground">Packet ID:</span>{" "}
                          <span className="font-medium">{order.packet_id}</span>
                        </div>
                      )}
                      {order.tag_id && (
                        <div>
                          <span className="text-muted-foreground">Tag ID:</span>{" "}
                          <span className="font-medium">{order.tag_id}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
