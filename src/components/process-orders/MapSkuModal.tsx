import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

interface Product {
  id: string;
  master_sku: string;
  name: string;
  brand_size: string | null;
  color: string | null;
}

interface MapSkuModalProps {
  open: boolean;
  onClose: () => void;
  barcode: string;
  onComplete: (productId: string, masterSku: string) => void;
}

export function MapSkuModal({
  open,
  onClose,
  barcode,
  onComplete,
}: MapSkuModalProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [mode, setMode] = useState<'search' | 'create'>('search');

  // New product fields
  const [newProductName, setNewProductName] = useState("");
  const [newMasterSku, setNewMasterSku] = useState("");
  const [newSize, setNewSize] = useState("");
  const [newColor, setNewColor] = useState("");

  useEffect(() => {
    if (open) {
      fetchProducts();
    }
  }, [open]);

  const fetchProducts = async () => {
    const { data, error } = await supabase
      .from('products')
      .select('id, master_sku, name, brand_size, color')
      .order('name');

    if (error) {
      console.error('Error fetching products:', error);
      return;
    }

    setProducts(data || []);
  };

  const handleMapToExisting = async () => {
    if (!selectedProduct) return;

    try {
      // Create alias mapping
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from('sku_aliases')
        .insert({
          product_id: selectedProduct.id,
          marketplace: 'barcode',
          alias_type: 'barcode',
          alias_value: barcode,
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: `Mapped barcode to ${selectedProduct.master_sku}`,
      });

      onComplete(selectedProduct.id, selectedProduct.master_sku);
    } catch (error) {
      console.error('Error mapping SKU:', error);
      toast({
        title: "Error",
        description: "Failed to map barcode",
        variant: "destructive"
      });
    }
  };

  const handleCreateProduct = async () => {
    if (!newProductName || !newMasterSku) {
      toast({
        title: "Error",
        description: "Name and Master SKU are required",
        variant: "destructive"
      });
      return;
    }

    try {
      const { data: newProduct, error: createError } = await supabase
        .from('products')
        .insert({
          name: newProductName,
          master_sku: newMasterSku,
          brand_size: newSize || null,
          color: newColor || null,
          barcode: barcode,
          brand: 'Unknown',
          vendor_name: 'Unknown',
          mrp: 0,
          cost_price: 0,
          available_units: 0,
        })
        .select()
        .single();

      if (createError) throw createError;

      toast({
        title: "Success",
        description: `Created product ${newMasterSku}`,
      });

      onComplete(newProduct.id, newProduct.master_sku);
    } catch (error) {
      console.error('Error creating product:', error);
      toast({
        title: "Error",
        description: "Failed to create product",
        variant: "destructive"
      });
    }
  };

  const filteredProducts = products.filter(p =>
    p.master_sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Map Scanned Barcode</DialogTitle>
          <DialogDescription>
            No product found for this barcode. Map to existing product or create a new product.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-muted p-3 rounded">
            <p className="text-sm font-medium">Scanned Barcode:</p>
            <p className="font-mono">{barcode}</p>
          </div>

          <div className="flex gap-2">
            <Button
              variant={mode === 'search' ? 'default' : 'outline'}
              onClick={() => setMode('search')}
              className="flex-1"
            >
              Map to Product
            </Button>
            <Button
              variant={mode === 'create' ? 'default' : 'outline'}
              onClick={() => setMode('create')}
              className="flex-1"
            >
              Create Product
            </Button>
          </div>

          {mode === 'search' ? (
            <div className="space-y-4">
              <Command className="border rounded-lg">
                <CommandInput
                  placeholder="Search products..."
                  value={searchTerm}
                  onValueChange={setSearchTerm}
                />
                <CommandList className="max-h-64">
                  <CommandEmpty>No products found.</CommandEmpty>
                  <CommandGroup>
                    {filteredProducts.map((product) => (
                      <CommandItem
                        key={product.id}
                        onSelect={() => setSelectedProduct(product)}
                        className={selectedProduct?.id === product.id ? 'bg-accent' : ''}
                      >
                        <div>
                          <p className="font-medium">{product.master_sku}</p>
                          <p className="text-sm text-muted-foreground">
                            {product.name}
                            {product.brand_size && ` • ${product.brand_size}`}
                            {product.color && ` • ${product.color}`}
                          </p>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  onClick={handleMapToExisting}
                  disabled={!selectedProduct}
                >
                  Map to Product
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4">
                <div>
                  <Label htmlFor="name">Product Name *</Label>
                  <Input
                    id="name"
                    value={newProductName}
                    onChange={(e) => setNewProductName(e.target.value)}
                    placeholder="Enter product name"
                  />
                </div>
                <div>
                  <Label htmlFor="master_sku">Master SKU *</Label>
                  <Input
                    id="master_sku"
                    value={newMasterSku}
                    onChange={(e) => setNewMasterSku(e.target.value)}
                    placeholder="Enter master SKU"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="size">Size</Label>
                    <Input
                      id="size"
                      value={newSize}
                      onChange={(e) => setNewSize(e.target.value)}
                      placeholder="e.g., L, XL"
                    />
                  </div>
                  <div>
                    <Label htmlFor="color">Color</Label>
                    <Input
                      id="color"
                      value={newColor}
                      onChange={(e) => setNewColor(e.target.value)}
                      placeholder="e.g., Black"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button onClick={handleCreateProduct}>
                  Create Product
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
