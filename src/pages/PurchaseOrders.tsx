import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, AlertCircle } from "lucide-react";

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
}

export default function PurchaseOrders() {
  const [lowStockProducts, setLowStockProducts] = useState<LowStockProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLowStockProducts();

    const channel = supabase
      .channel("low-stock-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "products",
        },
        () => {
          fetchLowStockProducts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchLowStockProducts = async () => {
    try {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .order("name");

      if (error) throw error;

      const lowStock = (data || []).filter(
        (product) => product.available_units < product.reorder_level
      );

      setLowStockProducts(lowStock);
    } catch (error) {
      console.error("Error fetching low stock products:", error);
    } finally {
      setLoading(false);
    }
  };

  const totalLowStock = lowStockProducts.length;
  const uniqueVendors = new Set(lowStockProducts.map((p) => p.vendor_name)).size;
  const totalUnitsNeeded = lowStockProducts.reduce(
    (sum, p) => sum + (p.reorder_level - p.available_units),
    0
  );

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Purchase Orders</h1>
        <p className="text-muted-foreground">
          Auto-generated reorder list for low stock items
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
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
        <CardHeader>
          <CardTitle>Low Stock Products</CardTitle>
          <CardDescription>
            Products below reorder level requiring restocking
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading products...</div>
          ) : lowStockProducts.length === 0 ? (
            <div className="text-center py-8">
              <ClipboardList className="mx-auto h-12 w-12 text-muted-foreground mb-2" />
              <p className="text-muted-foreground">All products are well stocked!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {lowStockProducts.map((product) => {
                const unitsNeeded = product.reorder_level - product.available_units;
                return (
                  <div
                    key={product.id}
                    className="p-4 rounded-lg border border-warning/30 bg-warning/5 hover:bg-warning/10 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <AlertCircle className="h-5 w-5 text-warning" />
                          <h3 className="font-semibold">{product.name}</h3>
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
                            <span className="text-muted-foreground">Barcode:</span>{" "}
                            <span className="font-medium">{product.barcode}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Vendor:</span>{" "}
                            <span className="font-medium">{product.vendor_name}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Cost Price:</span>{" "}
                            <span className="font-medium">₹{product.cost_price}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">MRP:</span>{" "}
                            <span className="font-medium">₹{product.mrp}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 ml-4">
                        <Badge variant="outline" className="bg-warning/20 text-warning border-warning/30">
                          Available: {product.available_units}
                        </Badge>
                        <Badge variant="outline" className="bg-destructive/20 text-destructive border-destructive/30">
                          Need: {unitsNeeded} units
                        </Badge>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
