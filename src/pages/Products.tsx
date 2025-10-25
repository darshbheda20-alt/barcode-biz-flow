import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, Edit, Trash2, Package, Plus, Upload, Download, List, Grid3x3 } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from 'xlsx';
import BarcodeScanner from "@/components/BarcodeScanner";
import ProductGroupedView from "@/components/ProductGroupedView";

interface Product {
  id: string;
  name: string;
  brand: string;
  master_sku: string;
  color: string | null;
  brand_size: string | null;
  standard_size: string | null;
  barcode: string | null;
  mrp: number;
  cost_price: number;
  reorder_level: number;
  vendor_name: string;
  available_units: number;
  damaged_units: number;
}

export default function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isAddMode, setIsAddMode] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "grouped">("list");
  const [newProduct, setNewProduct] = useState({
    name: "",
    brand: "",
    master_sku: "",
    color: "",
    brand_size: "",
    standard_size: "",
    barcode: "",
    mrp: "",
    cost_price: "",
    reorder_level: "10",
    vendor_name: "",
  });

  useEffect(() => {
    fetchProducts();

    const channel = supabase
      .channel("products-changes")
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

  const handleEdit = (product: Product) => {
    setIsAddMode(false);
    setEditingProduct(product);
    setIsDialogOpen(true);
  };

  const handleAddNew = () => {
    setIsAddMode(true);
    setNewProduct({
      name: "",
      brand: "",
      master_sku: "",
      color: "",
      brand_size: "",
      standard_size: "",
      barcode: "",
      mrp: "",
      cost_price: "",
      reorder_level: "10",
      vendor_name: "",
    });
    setIsDialogOpen(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const { error } = await supabase.from("products").insert({
        name: newProduct.name,
        brand: newProduct.brand,
        master_sku: newProduct.master_sku,
        color: newProduct.color || null,
        brand_size: newProduct.brand_size || null,
        standard_size: newProduct.standard_size || null,
        barcode: newProduct.barcode || null,
        mrp: parseFloat(newProduct.mrp),
        cost_price: parseFloat(newProduct.cost_price),
        reorder_level: parseInt(newProduct.reorder_level),
        vendor_name: newProduct.vendor_name,
      });

      if (error) throw error;

      toast.success("Product added successfully!");
      setIsDialogOpen(false);
    } catch (error: any) {
      toast.error(error.message || "Failed to add product");
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;

    try {
      const { error } = await supabase
        .from("products")
        .update({
          name: editingProduct.name,
          brand: editingProduct.brand,
          master_sku: editingProduct.master_sku,
          color: editingProduct.color,
          brand_size: editingProduct.brand_size,
          standard_size: editingProduct.standard_size,
          barcode: editingProduct.barcode,
          mrp: editingProduct.mrp,
          cost_price: editingProduct.cost_price,
          reorder_level: editingProduct.reorder_level,
          vendor_name: editingProduct.vendor_name,
        })
        .eq("id", editingProduct.id);

      if (error) throw error;

      toast.success("Product updated successfully!");
      setIsDialogOpen(false);
      setEditingProduct(null);
    } catch (error: any) {
      toast.error(error.message || "Failed to update product");
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"? This will also delete all related scan logs and sales orders.`)) {
      return;
    }

    try {
      const { error } = await supabase.from("products").delete().eq("id", id);

      if (error) throw error;

      toast.success("Product deleted successfully!");
    } catch (error: any) {
      toast.error(error.message || "Failed to delete product");
    }
  };

  const handleDownloadTemplate = () => {
    const template = [
      {
        'Name': 'Sample Product',
        'Brand': 'Sample Brand',
        'Master SKU': 'SKU001',
        'Color': 'Red',
        'Brand Size': 'M',
        'Standard Size': 'Medium',
        'Barcode': '1234567890',
        'MRP': 999.99,
        'Cost Price': 599.99,
        'Reorder Level': 10,
        'Vendor Name': 'Sample Vendor'
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(template);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Products Template');
    XLSX.writeFile(workbook, 'products_import_template.xlsx');
    toast.success('Template downloaded successfully!');
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (jsonData.length === 0) {
        toast.error("Excel file is empty");
        return;
      }

      const productsToInsert = jsonData
        .map((row: any, index: number) => {
          const product = {
            name: row.name || row.Name,
            brand: row.brand || row.Brand,
            master_sku: row.master_sku || row['Master SKU'],
            color: row.color || row.Color || null,
            brand_size: row.brand_size || row['Brand Size'] || null,
            standard_size: row.standard_size || row['Standard Size'] || null,
            barcode: row.barcode || row.Barcode || null,
            mrp: parseFloat(row.mrp || row.MRP),
            cost_price: parseFloat(row.cost_price || row['Cost Price']),
            reorder_level: parseInt(row.reorder_level || row['Reorder Level'] || '10'),
            vendor_name: row.vendor_name || row['Vendor Name'],
          };

          // Validate required fields (barcode is now optional)
          const requiredFields = ['name', 'brand', 'master_sku', 'vendor_name'];
          const missingFields = requiredFields.filter(field => !product[field as keyof typeof product]);
          
          if (missingFields.length > 0) {
            throw new Error(`Row ${index + 2}: Missing required fields: ${missingFields.join(', ')}`);
          }

          if (isNaN(product.mrp)) {
            throw new Error(`Row ${index + 2}: Invalid MRP value`);
          }

          if (isNaN(product.cost_price)) {
            throw new Error(`Row ${index + 2}: Invalid Cost Price value`);
          }

          return product;
        });

      const { error } = await supabase.from("products").insert(productsToInsert);

      if (error) throw error;

      toast.success(`Successfully imported ${productsToInsert.length} products!`);
      e.target.value = '';
    } catch (error: any) {
      console.error("Import error:", error);
      toast.error(error.message || "Failed to import products");
      e.target.value = '';
    }
  };

  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.barcode?.toLowerCase() || '').includes(search.toLowerCase()) ||
      p.master_sku.toLowerCase().includes(search.toLowerCase()) ||
      p.brand.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Product Management</h1>
        <p className="text-muted-foreground">View and edit product details</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>All Products</CardTitle>
              <CardDescription>Manage your product catalog</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-64">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search products..."
                  className="pl-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="flex border rounded-md">
                <Button
                  variant={viewMode === "list" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("list")}
                  className="rounded-r-none"
                >
                  <List className="h-4 w-4 mr-2" />
                  List
                </Button>
                <Button
                  variant={viewMode === "grouped" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("grouped")}
                  className="rounded-l-none"
                >
                  <Grid3x3 className="h-4 w-4 mr-2" />
                  Grouped
                </Button>
              </div>
              <Button variant="outline" onClick={handleDownloadTemplate}>
                <Download className="mr-2 h-4 w-4" />
                Download Template
              </Button>
              <Button variant="outline" onClick={() => document.getElementById('excel-upload')?.click()}>
                <Upload className="mr-2 h-4 w-4" />
                Import Excel
              </Button>
              <input
                id="excel-upload"
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleFileImport}
              />
              <Button onClick={handleAddNew}>
                <Plus className="mr-2 h-4 w-4" />
                Add Product
              </Button>
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
            <ProductGroupedView
              products={filteredProducts}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ) : (
            <div className="space-y-2">
              {filteredProducts.map((product) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1">
                    <h3 className="font-semibold mb-1">{product.name}</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm text-muted-foreground">
                      <span>Brand: {product.brand}</span>
                      <span>SKU: {product.master_sku}</span>
                      <span>Barcode: {product.barcode || 'N/A'}</span>
                      <span>Vendor: {product.vendor_name}</span>
                      <span>MRP: ₹{product.mrp}</span>
                      <span>Cost: ₹{product.cost_price}</span>
                      <span>Available: {product.available_units}</span>
                      <span>Reorder: {product.reorder_level}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(product)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(product.id, product.name)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isAddMode ? "Add New Product" : "Edit Product"}</DialogTitle>
            <DialogDescription>
              {isAddMode ? "Enter product details to add to inventory" : "Update product information"}
            </DialogDescription>
          </DialogHeader>
          {isAddMode ? (
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="new-name">Product Name *</Label>
                  <Input
                    id="new-name"
                    required
                    value={newProduct.name}
                    onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new-brand">Brand *</Label>
                  <Input
                    id="new-brand"
                    required
                    value={newProduct.brand}
                    onChange={(e) => setNewProduct({ ...newProduct, brand: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new-master-sku">Master SKU *</Label>
                  <Input
                    id="new-master-sku"
                    required
                    value={newProduct.master_sku}
                    onChange={(e) => setNewProduct({ ...newProduct, master_sku: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new-barcode">Barcode</Label>
                  <div className="flex gap-2">
                    <Input
                      id="new-barcode"
                      value={newProduct.barcode}
                      onChange={(e) => setNewProduct({ ...newProduct, barcode: e.target.value })}
                    />
                    <BarcodeScanner onScan={(code) => setNewProduct({ ...newProduct, barcode: code })} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new-color">Color</Label>
                  <Input
                    id="new-color"
                    value={newProduct.color}
                    onChange={(e) => setNewProduct({ ...newProduct, color: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new-brand-size">Brand Size</Label>
                  <Input
                    id="new-brand-size"
                    value={newProduct.brand_size}
                    onChange={(e) => setNewProduct({ ...newProduct, brand_size: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new-standard-size">Standard Size</Label>
                  <Input
                    id="new-standard-size"
                    value={newProduct.standard_size}
                    onChange={(e) => setNewProduct({ ...newProduct, standard_size: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new-mrp">MRP *</Label>
                  <Input
                    id="new-mrp"
                    type="number"
                    step="0.01"
                    required
                    value={newProduct.mrp}
                    onChange={(e) => setNewProduct({ ...newProduct, mrp: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new-cost-price">Cost Price *</Label>
                  <Input
                    id="new-cost-price"
                    type="number"
                    step="0.01"
                    required
                    value={newProduct.cost_price}
                    onChange={(e) => setNewProduct({ ...newProduct, cost_price: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new-reorder-level">Reorder Level *</Label>
                  <Input
                    id="new-reorder-level"
                    type="number"
                    required
                    value={newProduct.reorder_level}
                    onChange={(e) => setNewProduct({ ...newProduct, reorder_level: e.target.value })}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="new-vendor-name">Vendor Name *</Label>
                  <Input
                    id="new-vendor-name"
                    required
                    value={newProduct.vendor_name}
                    onChange={(e) => setNewProduct({ ...newProduct, vendor_name: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="submit" className="flex-1">
                  Add Product
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsDialogOpen(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : editingProduct && (
            <form onSubmit={handleUpdate} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-name">Product Name *</Label>
                  <Input
                    id="edit-name"
                    required
                    value={editingProduct.name}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, name: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-brand">Brand *</Label>
                  <Input
                    id="edit-brand"
                    required
                    value={editingProduct.brand}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, brand: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-master-sku">Master SKU *</Label>
                  <Input
                    id="edit-master-sku"
                    required
                    value={editingProduct.master_sku}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, master_sku: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-barcode">Barcode</Label>
                  <div className="flex gap-2">
                    <Input
                      id="edit-barcode"
                      value={editingProduct.barcode || ""}
                      onChange={(e) =>
                        setEditingProduct({ ...editingProduct, barcode: e.target.value })
                      }
                    />
                    <BarcodeScanner onScan={(code) => setEditingProduct({ ...editingProduct, barcode: code })} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-color">Color</Label>
                  <Input
                    id="edit-color"
                    value={editingProduct.color || ""}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, color: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-brand-size">Brand Size</Label>
                  <Input
                    id="edit-brand-size"
                    value={editingProduct.brand_size || ""}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, brand_size: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-standard-size">Standard Size</Label>
                  <Input
                    id="edit-standard-size"
                    value={editingProduct.standard_size || ""}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, standard_size: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-mrp">MRP *</Label>
                  <Input
                    id="edit-mrp"
                    type="number"
                    step="0.01"
                    required
                    value={editingProduct.mrp}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, mrp: parseFloat(e.target.value) })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-cost-price">Cost Price *</Label>
                  <Input
                    id="edit-cost-price"
                    type="number"
                    step="0.01"
                    required
                    value={editingProduct.cost_price}
                    onChange={(e) =>
                      setEditingProduct({
                        ...editingProduct,
                        cost_price: parseFloat(e.target.value),
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-reorder-level">Reorder Level *</Label>
                  <Input
                    id="edit-reorder-level"
                    type="number"
                    required
                    value={editingProduct.reorder_level}
                    onChange={(e) =>
                      setEditingProduct({
                        ...editingProduct,
                        reorder_level: parseInt(e.target.value),
                      })
                    }
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="edit-vendor-name">Vendor Name *</Label>
                  <Input
                    id="edit-vendor-name"
                    required
                    value={editingProduct.vendor_name}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, vendor_name: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="submit" className="flex-1">
                  Update Product
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsDialogOpen(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
