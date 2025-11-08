import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Download, Upload, Trash2, Edit } from "lucide-react";
import * as XLSX from "xlsx";

interface Product {
  id: string;
  master_sku: string;
  name: string;
  brand: string;
}

interface SkuAlias {
  id: string;
  product_id: string;
  marketplace: string;
  alias_type: string;
  alias_value: string;
  products?: Product;
}

const MARKETPLACES = ["flipkart", "amazon", "myntra"];
const ALIAS_TYPES = {
  flipkart: ["fsn", "listing_id"],
  amazon: ["asin", "fnsku"],
  myntra: ["seller_sku", "style_id"],
};

export default function MasterSkus() {
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingAlias, setEditingAlias] = useState<SkuAlias | null>(null);
  const [newAlias, setNewAlias] = useState({
    product_id: "",
    marketplace: "",
    alias_type: "",
    alias_value: "",
  });

  const queryClient = useQueryClient();

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

  // Fetch aliases
  const { data: aliases = [], isLoading } = useQuery({
    queryKey: ["sku-aliases"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sku_aliases")
        .select("*, products(id, master_sku, name, brand)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as SkuAlias[];
    },
  });

  // Add/Update mutation
  const saveMutation = useMutation({
    mutationFn: async (alias: Partial<SkuAlias>) => {
      if (alias.id) {
        const { error } = await supabase
          .from("sku_aliases")
          .update({
            marketplace: alias.marketplace,
            alias_type: alias.alias_type,
            alias_value: alias.alias_value,
          })
          .eq("id", alias.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("sku_aliases").insert([{
          product_id: alias.product_id!,
          marketplace: alias.marketplace!,
          alias_type: alias.alias_type!,
          alias_value: alias.alias_value!,
        }]);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sku-aliases"] });
      toast.success(editingAlias ? "Alias updated" : "Alias added");
      setIsAddDialogOpen(false);
      setEditingAlias(null);
      setNewAlias({ product_id: "", marketplace: "", alias_type: "", alias_value: "" });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to save alias");
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sku_aliases").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sku-aliases"] });
      toast.success("Alias deleted");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete alias");
    },
  });

  const handleSave = () => {
    if (editingAlias) {
      saveMutation.mutate(editingAlias);
    } else {
      if (!newAlias.product_id || !newAlias.marketplace || !newAlias.alias_type || !newAlias.alias_value) {
        toast.error("All fields are required");
        return;
      }
      saveMutation.mutate(newAlias);
    }
  };

  const handleEdit = (alias: SkuAlias) => {
    setEditingAlias(alias);
    setIsAddDialogOpen(true);
  };

  const handleExport = () => {
    const exportData = aliases.map((alias) => ({
      "Master SKU": alias.products?.master_sku || "",
      "Product Name": alias.products?.name || "",
      Brand: alias.products?.brand || "",
      Marketplace: alias.marketplace,
      "Alias Type": alias.alias_type,
      "Alias Value": alias.alias_value,
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "SKU Aliases");
    XLSX.writeFile(wb, `sku_aliases_${new Date().toISOString().split("T")[0]}.xlsx`);
    toast.success("Exported successfully");
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

      const aliasesToImport = [];
      for (const row of jsonData) {
        const masterSku = row["Master SKU"];
        const marketplace = row["Marketplace"]?.toLowerCase();
        const aliasType = row["Alias Type"]?.toLowerCase();
        const aliasValue = row["Alias Value"];

        if (!masterSku || !marketplace || !aliasType || !aliasValue) continue;

        // Find product by master_sku
        const product = products.find((p) => p.master_sku === masterSku);
        if (!product) {
          console.warn(`Product not found for master_sku: ${masterSku}`);
          continue;
        }

        aliasesToImport.push({
          product_id: product.id,
          marketplace,
          alias_type: aliasType,
          alias_value: aliasValue,
        });
      }

      if (aliasesToImport.length === 0) {
        toast.error("No valid aliases found in file");
        return;
      }

      const { error } = await supabase.from("sku_aliases").insert(aliasesToImport);
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["sku-aliases"] });
      toast.success(`Imported ${aliasesToImport.length} aliases`);
    } catch (error: any) {
      toast.error(error.message || "Import failed");
    }
    e.target.value = "";
  };

  const filteredAliases = aliases.filter((alias) => {
    const searchLower = searchTerm.toLowerCase();
    return (
      alias.products?.master_sku?.toLowerCase().includes(searchLower) ||
      alias.products?.name?.toLowerCase().includes(searchLower) ||
      alias.alias_value?.toLowerCase().includes(searchLower) ||
      alias.marketplace?.toLowerCase().includes(searchLower)
    );
  });

  const currentAlias = editingAlias || newAlias;
  const availableAliasTypes = currentAlias.marketplace
    ? ALIAS_TYPES[currentAlias.marketplace as keyof typeof ALIAS_TYPES] || []
    : [];

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Master SKU Mapping</h1>
          <p className="text-muted-foreground">
            Map marketplace identifiers to your internal master SKUs
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
          <Button variant="outline" asChild>
            <label>
              <Upload className="mr-2 h-4 w-4" />
              Import
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleImport}
              />
            </label>
          </Button>
          <Dialog
            open={isAddDialogOpen}
            onOpenChange={(open) => {
              setIsAddDialogOpen(open);
              if (!open) {
                setEditingAlias(null);
                setNewAlias({ product_id: "", marketplace: "", alias_type: "", alias_value: "" });
              }
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Alias
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingAlias ? "Edit Alias" : "Add New Alias"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Product</Label>
                  <Select
                    value={editingAlias?.product_id || newAlias.product_id}
                    onValueChange={(value) => {
                      if (editingAlias) {
                        setEditingAlias({ ...editingAlias, product_id: value });
                      } else {
                        setNewAlias({ ...newAlias, product_id: value });
                      }
                    }}
                    disabled={!!editingAlias}
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
                <div className="space-y-2">
                  <Label>Marketplace</Label>
                  <Select
                    value={currentAlias.marketplace}
                    onValueChange={(value) => {
                      if (editingAlias) {
                        setEditingAlias({ ...editingAlias, marketplace: value, alias_type: "" });
                      } else {
                        setNewAlias({ ...newAlias, marketplace: value, alias_type: "" });
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select marketplace" />
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
                <div className="space-y-2">
                  <Label>Alias Type</Label>
                  <Select
                    value={currentAlias.alias_type}
                    onValueChange={(value) => {
                      if (editingAlias) {
                        setEditingAlias({ ...editingAlias, alias_type: value });
                      } else {
                        setNewAlias({ ...newAlias, alias_type: value });
                      }
                    }}
                    disabled={!currentAlias.marketplace}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select alias type" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableAliasTypes.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type.toUpperCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Alias Value</Label>
                  <Input
                    placeholder="Enter marketplace SKU"
                    value={currentAlias.alias_value}
                    onChange={(e) => {
                      if (editingAlias) {
                        setEditingAlias({ ...editingAlias, alias_value: e.target.value });
                      } else {
                        setNewAlias({ ...newAlias, alias_value: e.target.value });
                      }
                    }}
                  />
                </div>
                <Button
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  className="w-full"
                >
                  {saveMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex gap-4">
        <Input
          placeholder="Search by master SKU, product name, alias..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-md"
        />
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Master SKU</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>Marketplace</TableHead>
              <TableHead>Alias Type</TableHead>
              <TableHead>Alias Value</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : filteredAliases.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No aliases found. Add your first marketplace mapping.
                </TableCell>
              </TableRow>
            ) : (
              filteredAliases.map((alias) => (
                <TableRow key={alias.id}>
                  <TableCell className="font-mono">{alias.products?.master_sku}</TableCell>
                  <TableCell>{alias.products?.name}</TableCell>
                  <TableCell>{alias.products?.brand}</TableCell>
                  <TableCell className="capitalize">{alias.marketplace}</TableCell>
                  <TableCell className="uppercase text-xs">{alias.alias_type}</TableCell>
                  <TableCell className="font-mono">{alias.alias_value}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
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
                        onClick={() => deleteMutation.mutate(alias.id)}
                        disabled={deleteMutation.isPending}
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
