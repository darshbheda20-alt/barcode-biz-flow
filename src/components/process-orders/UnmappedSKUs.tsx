import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, Link2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

interface UnmappedSKU {
  marketplace_sku: string;
  platform: string;
  product_name: string | null;
  order_count: number;
  order_ids: string[];
}

interface Product {
  id: string;
  master_sku: string;
  name: string;
  brand: string;
  color: string | null;
}

export const UnmappedSKUs = () => {
  const [unmappedSKUs, setUnmappedSKUs] = useState<UnmappedSKU[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapping, setMapping] = useState(false);
  const [selectedSKU, setSelectedSKU] = useState<UnmappedSKU | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchUnmappedSKUs();
    fetchProducts();

    // Subscribe to changes
    const channel = supabase
      .channel('unmapped_skus_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'process_orders' },
        () => {
          fetchUnmappedSKUs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchUnmappedSKUs = async () => {
    try {
      const { data, error } = await supabase
        .from('process_orders')
        .select('marketplace_sku, platform, product_name, order_id, id')
        .is('product_id', null)
        .not('marketplace_sku', 'is', null)
        .order('marketplace_sku');

      if (error) throw error;

      // Group by marketplace_sku and platform
      const grouped = data.reduce((acc, order) => {
        const key = `${order.marketplace_sku}-${order.platform}`;
        if (!acc[key]) {
          acc[key] = {
            marketplace_sku: order.marketplace_sku!,
            platform: order.platform,
            product_name: order.product_name,
            order_count: 0,
            order_ids: []
          };
        }
        acc[key].order_count++;
        acc[key].order_ids.push(order.id);
        return acc;
      }, {} as Record<string, UnmappedSKU>);

      setUnmappedSKUs(Object.values(grouped));
    } catch (error) {
      console.error('Error fetching unmapped SKUs:', error);
      toast({
        title: "Error",
        description: "Failed to load unmapped SKUs",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, master_sku, name, brand, color')
        .order('name');

      if (error) throw error;
      setProducts(data || []);
    } catch (error) {
      console.error('Error fetching products:', error);
    }
  };

  const handleMapSKU = async () => {
    if (!selectedSKU || !selectedProduct) return;

    setMapping(true);
    try {
      // Insert into sku_aliases
      const { error: aliasError } = await supabase
        .from('sku_aliases')
        .insert({
          product_id: selectedProduct.id,
          marketplace: selectedSKU.platform,
          marketplace_sku: selectedSKU.marketplace_sku,
          alias_type: 'marketplace_sku',
          alias_value: selectedSKU.marketplace_sku
        });

      if (aliasError) throw aliasError;

      // Update all process_orders with this SKU
      const { error: updateError } = await supabase
        .from('process_orders')
        .update({
          product_id: selectedProduct.id,
          master_sku: selectedProduct.master_sku,
          product_name: selectedProduct.name
        })
        .in('id', selectedSKU.order_ids);

      if (updateError) throw updateError;

      toast({
        title: "Success",
        description: `Mapped ${selectedSKU.marketplace_sku} to ${selectedProduct.master_sku}`
      });

      setSelectedSKU(null);
      setSelectedProduct(null);
      fetchUnmappedSKUs();
    } catch (error: any) {
      console.error('Error mapping SKU:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to map SKU",
        variant: "destructive"
      });
    } finally {
      setMapping(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-6">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (unmappedSKUs.length === 0) {
    return null;
  }

  return (
    <>
      <Card className="border-warning">
        <CardHeader>
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-warning mt-0.5" />
            <div className="flex-1">
              <CardTitle className="text-lg">Unmapped SKUs</CardTitle>
              <CardDescription>
                {unmappedSKUs.length} SKU{unmappedSKUs.length !== 1 ? 's' : ''} need{unmappedSKUs.length === 1 ? 's' : ''} to be mapped to products
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Marketplace SKU</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Product Name</TableHead>
                <TableHead className="text-center">Orders</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unmappedSKUs.map((sku, idx) => (
                <TableRow key={idx}>
                  <TableCell className="font-mono font-semibold">
                    {sku.marketplace_sku}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {sku.platform}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {sku.product_name || 'N/A'}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary">{sku.order_count}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedSKU(sku)}
                    >
                      <Link2 className="h-4 w-4 mr-2" />
                      Map to Product
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selectedSKU} onOpenChange={(open) => !open && setSelectedSKU(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Map SKU to Product</DialogTitle>
            <DialogDescription>
              Select a product to map <span className="font-mono font-semibold">{selectedSKU?.marketplace_sku}</span> to
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <Command className="border rounded-lg">
              <CommandInput placeholder="Search products by SKU, name, or brand..." />
              <CommandList>
                <CommandEmpty>No products found.</CommandEmpty>
                <CommandGroup>
                  {products.map((product) => (
                    <CommandItem
                      key={product.id}
                      onSelect={() => setSelectedProduct(product)}
                      className="cursor-pointer"
                    >
                      <div className="flex items-center justify-between w-full">
                        <div>
                          <div className="font-mono font-semibold">{product.master_sku}</div>
                          <div className="text-sm text-muted-foreground">
                            {product.name} - {product.brand}
                            {product.color && ` (${product.color})`}
                          </div>
                        </div>
                        {selectedProduct?.id === product.id && (
                          <Badge variant="default">Selected</Badge>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>

            {selectedProduct && (
              <div className="rounded-lg border bg-muted/50 p-4">
                <div className="text-sm font-medium mb-2">Selected Product:</div>
                <div className="font-mono font-semibold text-lg">{selectedProduct.master_sku}</div>
                <div className="text-sm text-muted-foreground">
                  {selectedProduct.name} - {selectedProduct.brand}
                  {selectedProduct.color && ` (${selectedProduct.color})`}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedSKU(null);
                  setSelectedProduct(null);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleMapSKU}
                disabled={!selectedProduct || mapping}
              >
                {mapping ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Mapping...
                  </>
                ) : (
                  <>
                    <Link2 className="h-4 w-4 mr-2" />
                    Map SKU
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
