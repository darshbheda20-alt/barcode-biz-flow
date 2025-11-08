import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Download, Upload, Trash2, Edit, Search } from "lucide-react";
import * as XLSX from "xlsx";

type Product = {
  id: string;
  master_sku: string;
  name: string;
  brand: string;
};

type SKUAlias = {
  id: string;
  product_id: string;
  marketplace: string;
  alias_type: string;
  alias_value: string;
  master_sku?: string;
  product_name?: string;
};

const MARKETPLACES = ["flipkart", "amazon", "myntra"];
const ALIAS_TYPES = {
  flipkart: ["fsn", "listing_id"],
  amazon: ["asin", "sku"],
  myntra: ["seller_sku", "style_id"],
};

export default function MasterSKUs() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingAlias, setEditingAlias] = useState<SKUAlias | null>(null);
  const [formData, setFormData] = useState({
    product_id: "",
    marketplace: "flipkart",
    alias_type: "fsn",
    alias_value: "",
  });

  // Fetch products
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, master_sku, name, brand")
        .order("master_sku");
      if (error) throw error;
      return data as Product[];
    },
  });

  // Fetch aliases with product details
  const { data: aliases = [], isLoading } = useQuery({
    queryKey: ["sku_aliases"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sku_aliases")
        .select(`
          id,
          product_id,
          marketplace,
          alias_type,
          alias_value,
          products!inner(master_sku, name)
        `)
        .order("marketplace");
      if (error) throw error;
      return (data as any[]).map(item => ({
        ...item,
        master_sku: item.products.master_sku,
        product_name: item.products.name,
      })) as SKUAlias[];
    },
  });

  // Create alias mutation
  const createAlias = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { error } = await supabase.from("sku_aliases").insert([data]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sku_aliases"] });
      toast({ title: "Alias created successfully" });
      setShowAddDialog(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        title: "Error creating alias",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update alias mutation
  const updateAlias = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof formData> }) => {
      const { error } = await supabase.from("sku_aliases").update(data).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sku_aliases"] });
      toast({ title: "Alias updated successfully" });
      setEditingAlias(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        title: "Error updating alias",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete alias mutation
  const deleteAlias = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sku_aliases").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sku_aliases"] });
      toast({ title: "Alias deleted successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Error deleting alias",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormData({
      product_id: "",
      marketplace: "flipkart",
      alias_type: "fsn",
      alias_value: "",
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingAlias) {
      updateAlias.mutate({ id: editingAlias.id, data: formData });
    } else {
      createAlias.mutate(formData);
    }
  };

  const handleEdit = (alias: SKUAlias) => {
    setEditingAlias(alias);
    setFormData({
      product_id: alias.product_id,
      marketplace: alias.marketplace,
      alias_type: alias.alias_type,
      alias_value: alias.alias_value,
    });
    setShowAddDialog(true);
  };

  // Excel Export
  const handleExport = () => {
    const exportData = aliases.map(alias => ({
      "Master SKU": alias.master_sku,
      "Product Name": alias.product_name,
      "Marketplace": alias.marketplace,
      "Alias Type": alias.alias_type,
      "Alias Value": alias.alias_value,
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "SKU Aliases");
    XLSX.writeFile(wb, `sku_aliases_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast({ title: "Export successful" });
  };

  // Excel Import
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = event.target?.result;
        const workbook = XLSX.read(data, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet) as any[];

        const aliasesToInsert = [];
        for (const row of jsonData) {
          const masterSku = row["Master SKU"] || row["master_sku"];
          const marketplace = row["Marketplace"] || row["marketplace"];
          const aliasType = row["Alias Type"] || row["alias_type"];
          const aliasValue = row["Alias Value"] || row["alias_value"];

          if (!masterSku || !marketplace || !aliasType || !aliasValue) continue;

          // Find product by master_sku
          const product = products.find(p => p.master_sku === masterSku);
          if (!product) {
            console.warn(`Product not found for master_sku: ${masterSku}`);
            continue;
          }

          aliasesToInsert.push({
            product_id: product.id,
            marketplace: marketplace.toLowerCase(),
            alias_type: aliasType.toLowerCase(),
            alias_value: aliasValue,
          });
        }

        if (aliasesToInsert.length === 0) {
          toast({
            title: "No valid data to import",
            variant: "destructive",
          });
          return;
        }

        const { error } = await supabase.from("sku_aliases").insert(aliasesToInsert);
        if (error) throw error;

        queryClient.invalidateQueries({ queryKey: ["sku_aliases"] });
        toast({
          title: "Import successful",
          description: `Imported ${aliasesToInsert.length} aliases`,
        });
      } catch (error: any) {
        toast({
          title: "Import failed",
          description: error.message,
          variant: "destructive",
        });
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = "";
  };

  const filteredAliases = aliases.filter(alias =>
    alias.master_sku?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    alias.product_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    alias.alias_value.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Master SKU Mapping</h1>
          <p className="text-muted-foreground mt-1">
            Map marketplace identifiers to internal Master SKUs
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleExport} variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
          <label htmlFor="import-file">
            <Button asChild variant="outline">
              <span>
                <Upload className="mr-2 h-4 w-4" />
                Import
              </span>
            </Button>
          </label>
          <input
            id="import-file"
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleImport}
          />
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button onClick={resetForm}>
                <Plus className="mr-2 h-4 w-4" />
                Add Alias
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingAlias ? "Edit Alias" : "Add New Alias"}
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="product">Product</Label>
                  <Select
                    value={formData.product_id}
                    onValueChange={(value) =>
                      setFormData({ ...formData, product_id: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select product" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.master_sku} - {product.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="marketplace">Marketplace</Label>
                  <Select
                    value={formData.marketplace}
                    onValueChange={(value) =>
                      setFormData({
                        ...formData,
                        marketplace: value,
                        alias_type: ALIAS_TYPES[value as keyof typeof ALIAS_TYPES][0],
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MARKETPLACES.map((mp) => (
                        <SelectItem key={mp} value={mp}>
                          {mp.charAt(0).toUpperCase() + mp.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="alias_type">Alias Type</Label>
                  <Select
                    value={formData.alias_type}
                    onValueChange={(value) =>
                      setFormData({ ...formData, alias_type: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ALIAS_TYPES[formData.marketplace as keyof typeof ALIAS_TYPES].map((type) => (
                        <SelectItem key={type} value={type}>
                          {type.toUpperCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="alias_value">Alias Value</Label>
                  <Input
                    id="alias_value"
                    value={formData.alias_value}
                    onChange={(e) =>
                      setFormData({ ...formData, alias_value: e.target.value })
                    }
                    placeholder="e.g., SHOF123ABC"
                    required
                  />
                </div>

                <div className="flex gap-2 justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowAddDialog(false);
                      setEditingAlias(null);
                      resetForm();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit">
                    {editingAlias ? "Update" : "Create"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by Master SKU, Product Name, or Alias Value..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Master SKU</TableHead>
              <TableHead>Product Name</TableHead>
              <TableHead>Marketplace</TableHead>
              <TableHead>Alias Type</TableHead>
              <TableHead>Alias Value</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : filteredAliases.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No aliases found. Add your first marketplace mapping.
                </TableCell>
              </TableRow>
            ) : (
              filteredAliases.map((alias) => (
                <TableRow key={alias.id}>
                  <TableCell className="font-mono">{alias.master_sku}</TableCell>
                  <TableCell>{alias.product_name}</TableCell>
                  <TableCell className="capitalize">{alias.marketplace}</TableCell>
                  <TableCell className="uppercase">{alias.alias_type}</TableCell>
                  <TableCell className="font-mono">{alias.alias_value}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(alias)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteAlias.mutate(alias.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
