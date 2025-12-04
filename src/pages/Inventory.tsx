import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Package, AlertCircle, List, LayoutGrid, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { listenLocalEvent, publishRefreshAll, publishTableRefresh } from "@/lib/eventBus";

interface Product {
  id: string;
  name: string;
  brand: string;
  master_sku: string;
  color: string | null;
  brand_size: string | null;
  standard_size: string | null;
  barcode: string;
  mrp: number;
  available_units: number;
  damaged_units: number;
  reorder_level: number;
  cost_price: number;
  vendor_name: string;
}

type ViewMode = "list" | "grouped";

export default function Inventory() {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => {
    const templateData = [
      {
        "Master SKU": "EXAMPLE-SKU-001",
        "Available Units": 0,
        "Damaged Units": 0
      }
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory Template");
    XLSX.writeFile(wb, "inventory_import_template.xlsx");
    toast.success("Template downloaded");
  };

  const exportToExcel = () => {
    const exportData = products.map(p => ({
      "Product Name": p.name,
      "Brand": p.brand,
      "Master SKU": p.master_sku,
      "Barcode": p.barcode || "",
      "Color": p.color || "",
      "Brand Size": p.brand_size || "",
      "Standard Size": p.standard_size || "",
      "MRP": p.mrp,
      "Cost Price": p.cost_price,
      "Available Units": p.available_units,
      "Damaged Units": p.damaged_units,
      "Reorder Level": p.reorder_level,
      "Vendor": p.vendor_name
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    XLSX.writeFile(wb, `inventory_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success("Inventory exported successfully");
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];

      let updated = 0;
      for (const row of rows) {
        const masterSku = row["Master SKU"] as string;
        const availableUnits = Number(row["Available Units"]);
        const damagedUnits = Number(row["Damaged Units"]);

        if (masterSku && !isNaN(availableUnits)) {
          const { error } = await supabase
            .from("products")
            .update({ 
              available_units: availableUnits,
              damaged_units: isNaN(damagedUnits) ? undefined : damagedUnits
            })
            .eq("master_sku", masterSku);

          if (!error) updated++;
        }
      }

      toast.success(`Updated ${updated} products`);
      
      // Trigger refresh events
      publishTableRefresh('products');
      
      fetchProducts();
    } catch (error) {
      console.error("Import error:", error);
      toast.error("Failed to import file");
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

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

    // Listen for local refresh events
    const cleanup = listenLocalEvent('refresh-all', fetchProducts);
    const cleanupTable = listenLocalEvent('refresh-products', fetchProducts);

    return () => {
      supabase.removeChannel(channel);
      cleanup();
      cleanupTable();
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
      <div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">Inventory Dashboard</h1>
          <p className="text-muted-foreground">Real-time stock levels and product overview</p>
        </div>
        <div className="flex gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImport}
            accept=".xlsx,.xls,.csv"
            className="hidden"
          />
          <Button variant="ghost" size="sm" onClick={downloadTemplate}>
            <Download className="h-4 w-4 mr-1" />
            Template
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1" />
            Import
          </Button>
          <Button variant="outline" size="sm" onClick={exportToExcel}>
            <Download className="h-4 w-4 mr-1" />
            Export
          </Button>
        </div>
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
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <CardTitle>All Products</CardTitle>
              <CardDescription>Search and view all inventory items</CardDescription>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
              <div className="flex border rounded-lg overflow-hidden">
                <Button
                  variant={viewMode === "list" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("list")}
                  className="rounded-none"
                >
                  <List className="h-4 w-4 mr-1" />
                  List
                </Button>
                <Button
                  variant={viewMode === "grouped" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("grouped")}
                  className="rounded-none"
                >
                  <LayoutGrid className="h-4 w-4 mr-1" />
                  Grouped
                </Button>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search products..."
                  className="pl-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
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
          ) : viewMode === "grouped" ? (
            <InventoryGroupedView products={filteredProducts} />
          ) : (
            <div className="space-y-2">
              {filteredProducts.map((product) => (
                <div
                  key={product.id}
                  className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors gap-3"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold">{product.name}</h3>
                      {product.available_units < product.reorder_level && (
                        <AlertCircle className="h-4 w-4 text-warning" />
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 text-sm text-muted-foreground">
                      <span>{product.brand}</span>
                      <span>SKU: {product.master_sku}</span>
                      <span>Barcode: {product.barcode}</span>
                      {product.color && <span>Color: {product.color}</span>}
                      {(product.brand_size || product.standard_size) && (
                        <span>Size: {product.brand_size || product.standard_size}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-3 flex-wrap">
                    <Badge variant="outline" className="bg-success/10 text-success border-success/20">
                      Available: {product.available_units}
                    </Badge>
                    {product.damaged_units > 0 && (
                      <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
                        Damaged: {product.damaged_units}
                      </Badge>
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

// Grouped View Component for Inventory
function InventoryGroupedView({ products }: { products: Product[] }) {
  const [expandedNames, setExpandedNames] = useState<Set<string>>(new Set());
  const [expandedColors, setExpandedColors] = useState<Set<string>>(new Set());

  // Group products by name, then by color
  const groupedProducts = products.reduce((acc, product) => {
    const name = product.name;
    const color = product.color || "No Color";

    if (!acc[name]) {
      acc[name] = {};
    }
    if (!acc[name][color]) {
      acc[name][color] = [];
    }
    acc[name][color].push(product);
    return acc;
  }, {} as Record<string, Record<string, Product[]>>);

  const toggleName = (name: string) => {
    const newSet = new Set(expandedNames);
    if (newSet.has(name)) {
      newSet.delete(name);
    } else {
      newSet.add(name);
    }
    setExpandedNames(newSet);
  };

  const toggleColor = (key: string) => {
    const newSet = new Set(expandedColors);
    if (newSet.has(key)) {
      newSet.delete(key);
    } else {
      newSet.add(key);
    }
    setExpandedColors(newSet);
  };

  const getColorKey = (name: string, color: string) => `${name}-${color}`;

  return (
    <div className="space-y-2">
      {Object.keys(groupedProducts).sort().map((name) => {
        const isNameExpanded = expandedNames.has(name);
        const colors = groupedProducts[name];
        const totalProducts = Object.values(colors).reduce((sum, items) => sum + items.length, 0);
        const totalAvailable = Object.values(colors).reduce(
          (sum, items) => sum + items.reduce((s, p) => s + p.available_units, 0), 0
        );

        return (
          <div key={name} className="border rounded-lg overflow-hidden">
            <button
              onClick={() => toggleName(name)}
              className="w-full flex items-center justify-between p-4 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                {isNameExpanded ? (
                  <span className="text-muted-foreground">▼</span>
                ) : (
                  <span className="text-muted-foreground">▶</span>
                )}
                <span className="font-semibold text-lg">{name}</span>
                <span className="text-sm text-muted-foreground">
                  ({Object.keys(colors).length} colors, {totalProducts} variants)
                </span>
              </div>
              <Badge variant="outline" className="bg-success/10 text-success border-success/20">
                Total: {totalAvailable}
              </Badge>
            </button>

            {isNameExpanded && (
              <div>
                {Object.keys(colors).sort().map((color) => {
                  const colorKey = getColorKey(name, color);
                  const isColorExpanded = expandedColors.has(colorKey);
                  const items = colors[color];
                  const colorTotal = items.reduce((s, p) => s + p.available_units, 0);

                  return (
                    <div key={colorKey} className="border-t">
                      <button
                        onClick={() => toggleColor(colorKey)}
                        className="w-full flex items-center justify-between p-3 pl-10 bg-muted/10 hover:bg-muted/20 transition-colors text-left"
                      >
                        <div className="flex items-center gap-2">
                          {isColorExpanded ? (
                            <span className="text-muted-foreground text-sm">▼</span>
                          ) : (
                            <span className="text-muted-foreground text-sm">▶</span>
                          )}
                          <span className="font-medium">{color}</span>
                          <span className="text-sm text-muted-foreground">
                            ({items.length} sizes)
                          </span>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {colorTotal} units
                        </Badge>
                      </button>

                      {isColorExpanded && (
                        <div>
                          {items.map((product) => (
                            <div
                              key={product.id}
                              className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 pl-16 border-t hover:bg-muted/5 transition-colors gap-2"
                            >
                              <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 md:grid-cols-5 gap-2 text-sm">
                                <div>
                                  <span className="text-muted-foreground">Size: </span>
                                  <span className="font-medium">
                                    {product.brand_size && product.standard_size
                                      ? `${product.brand_size} (${product.standard_size})`
                                      : product.brand_size || product.standard_size || "N/A"}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">SKU: </span>
                                  <span>{product.master_sku}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Barcode: </span>
                                  <span>{product.barcode || "N/A"}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">MRP: </span>
                                  <span>₹{product.mrp}</span>
                                </div>
                                <div className="flex gap-2">
                                  <Badge 
                                    variant="outline" 
                                    className={product.available_units <= product.reorder_level 
                                      ? "bg-destructive/10 text-destructive border-destructive/20" 
                                      : "bg-success/10 text-success border-success/20"
                                    }
                                  >
                                    {product.available_units}
                                  </Badge>
                                  {product.damaged_units > 0 && (
                                    <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
                                      {product.damaged_units} dmg
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
