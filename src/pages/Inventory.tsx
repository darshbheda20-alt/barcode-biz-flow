import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, Package, AlertCircle } from "lucide-react";

interface Product {
  id: string;
  name: string;
  brand: string;
  master_sku: string;
  barcode: string;
  available_units: number;
  damaged_units: number;
  reorder_level: number;
  cost_price: number;
}

export default function Inventory() {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProducts();

    const channel = supabase
      .channel("inventory-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "products",
        },
        () => {
          fetchProducts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchProducts = async () => {
    try {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .order("name");

      if (error) throw error;
      setProducts(data || []);
    } catch (error) {
      console.error("Error fetching products:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.barcode.toLowerCase().includes(search.toLowerCase()) ||
      p.master_sku.toLowerCase().includes(search.toLowerCase())
  );

  const totalProducts = products.length;
  const lowStock = products.filter((p) => p.available_units < p.reorder_level).length;
  const totalAvailable = products.reduce((sum, p) => sum + p.available_units, 0);
  const totalDamaged = products.reduce((sum, p) => sum + p.damaged_units, 0);
  const inventoryValue = products.reduce((sum, p) => sum + (p.available_units * Number(p.cost_price)), 0);
  const totalCostValue = products.reduce((sum, p) => sum + ((p.available_units + p.damaged_units) * Number(p.cost_price)), 0);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Inventory Dashboard</h1>
        <p className="text-muted-foreground">Real-time stock levels and product overview</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total Products</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalProducts}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Available Units</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">{totalAvailable}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Damaged Units</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{totalDamaged}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Low Stock Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{lowStock}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Available Inventory Value</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">₹{inventoryValue.toFixed(2)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total Investment (CP)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{totalCostValue.toFixed(2)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>All Products</CardTitle>
              <CardDescription>Search and view all inventory items</CardDescription>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search products..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading products...</div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-8">
              <Package className="mx-auto h-12 w-12 text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No products found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredProducts.map((product) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold">{product.name}</h3>
                      {product.available_units < product.reorder_level && (
                        <AlertCircle className="h-4 w-4 text-warning" />
                      )}
                    </div>
                    <div className="flex gap-4 text-sm text-muted-foreground">
                      <span>{product.brand}</span>
                      <span>SKU: {product.master_sku}</span>
                      <span>Barcode: {product.barcode}</span>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="text-center">
                      <Badge variant="outline" className="bg-success/10 text-success border-success/20">
                        Available: {product.available_units}
                      </Badge>
                    </div>
                    {product.damaged_units > 0 && (
                      <div className="text-center">
                        <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
                          Damaged: {product.damaged_units}
                        </Badge>
                      </div>
                    )}
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
