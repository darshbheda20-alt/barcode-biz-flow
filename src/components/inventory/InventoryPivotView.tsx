import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { publishTableRefresh } from "@/lib/eventBus";
import { Pencil, Check, X } from "lucide-react";

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
  available_units: number;
  damaged_units: number;
  reorder_level: number;
  cost_price: number;
  vendor_name: string;
}

interface InventoryPivotViewProps {
  products: Product[];
  onRefresh: () => void;
}

interface EditingCell {
  productId: string;
  field: 'available_units' | 'damaged_units';
}

export function InventoryPivotView({ products, onRefresh }: InventoryPivotViewProps) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    checkAdminStatus();
  }, []);

  const checkAdminStatus = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    setIsAdmin(!!roleData);
  };

  // Group products by name, then by color, collect all sizes
  const groupedData = products.reduce((acc, product) => {
    const name = product.name;
    const color = product.color || "No Color";
    const size = product.brand_size || product.standard_size || "N/A";

    if (!acc[name]) {
      acc[name] = { colors: {}, allSizes: new Set<string>() };
    }
    if (!acc[name].colors[color]) {
      acc[name].colors[color] = {};
    }
    acc[name].colors[color][size] = product;
    acc[name].allSizes.add(size);

    return acc;
  }, {} as Record<string, { colors: Record<string, Record<string, Product>>, allSizes: Set<string> }>);

  const handleStartEdit = (productId: string, field: 'available_units' | 'damaged_units', currentValue: number) => {
    if (!isAdmin) return;
    setEditingCell({ productId, field });
    setEditValue(String(currentValue));
  };

  const handleCancelEdit = () => {
    setEditingCell(null);
    setEditValue("");
  };

  const handleSaveEdit = async () => {
    if (!editingCell) return;

    const newValue = parseInt(editValue);
    if (isNaN(newValue) || newValue < 0) {
      toast.error("Please enter a valid number");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("products")
        .update({ [editingCell.field]: newValue })
        .eq("id", editingCell.productId);

      if (error) throw error;

      toast.success("Updated successfully");
      publishTableRefresh('products');
      onRefresh();
    } catch (error: any) {
      toast.error("Failed to update: " + error.message);
    } finally {
      setSaving(false);
      setEditingCell(null);
      setEditValue("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSaveEdit();
    } else if (e.key === "Escape") {
      handleCancelEdit();
    }
  };

  const renderCell = (product: Product | undefined, size: string, color: string, name: string) => {
    if (!product) {
      return <td key={`${name}-${color}-${size}`} className="border border-border px-2 py-1 text-center text-muted-foreground bg-muted/20">-</td>;
    }

    const isEditing = editingCell?.productId === product.id && editingCell?.field === 'available_units';

    return (
      <td 
        key={`${name}-${color}-${size}`} 
        className={`border border-border px-2 py-1 text-center ${isAdmin ? 'cursor-pointer hover:bg-muted/50' : ''} ${product.available_units <= product.reorder_level ? 'bg-destructive/10' : ''}`}
        onClick={() => !isEditing && handleStartEdit(product.id, 'available_units', product.available_units)}
      >
        {isEditing ? (
          <div className="flex items-center gap-1">
            <Input
              type="number"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-6 w-14 text-center p-1 text-sm"
              autoFocus
              min={0}
            />
            <button onClick={handleSaveEdit} disabled={saving} className="text-success hover:text-success/80">
              <Check className="h-3 w-3" />
            </button>
            <button onClick={handleCancelEdit} className="text-destructive hover:text-destructive/80">
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <span className={`font-medium ${product.available_units <= product.reorder_level ? 'text-destructive' : ''}`}>
            {product.available_units}
          </span>
        )}
      </td>
    );
  };

  const sortSizes = (sizes: string[]): string[] => {
    return sizes.sort((a, b) => {
      const numA = parseInt(a);
      const numB = parseInt(b);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });
  };

  return (
    <div className="space-y-6 overflow-x-auto">
      {!isAdmin && (
        <div className="text-sm text-muted-foreground bg-muted/30 p-2 rounded">
          View only - Admin access required to edit quantities
        </div>
      )}
      
      {Object.entries(groupedData).sort(([a], [b]) => a.localeCompare(b)).map(([name, data]) => {
        const sizes = sortSizes(Array.from(data.allSizes));
        const colors = Object.keys(data.colors).sort();

        // Calculate totals per size
        const sizeTotals: Record<string, number> = {};
        sizes.forEach(size => {
          sizeTotals[size] = Object.values(data.colors).reduce((sum, colorProducts) => {
            return sum + (colorProducts[size]?.available_units || 0);
          }, 0);
        });

        // Calculate grand total
        const grandTotal = Object.values(sizeTotals).reduce((sum, val) => sum + val, 0);

        return (
          <div key={name} className="border rounded-lg overflow-hidden">
            <div className="bg-primary/10 px-4 py-2 font-bold text-lg border-b">
              {name}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="border border-border px-3 py-2 text-left font-semibold min-w-[120px]">Color\Size</th>
                    {sizes.map(size => (
                      <th key={size} className="border border-border px-3 py-2 text-center font-semibold min-w-[60px]">
                        {size}
                      </th>
                    ))}
                    <th className="border border-border px-3 py-2 text-center font-semibold bg-muted min-w-[70px]">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {colors.map(color => {
                    const colorProducts = data.colors[color];
                    const rowTotal = sizes.reduce((sum, size) => {
                      return sum + (colorProducts[size]?.available_units || 0);
                    }, 0);

                    return (
                      <tr key={color} className="hover:bg-muted/20">
                        <td className="border border-border px-3 py-2 font-medium">{color}</td>
                        {sizes.map(size => renderCell(colorProducts[size], size, color, name))}
                        <td className="border border-border px-3 py-2 text-center font-bold bg-muted/30">
                          {rowTotal}
                        </td>
                      </tr>
                    );
                  })}
                  {/* Totals row */}
                  <tr className="bg-muted/50 font-bold">
                    <td className="border border-border px-3 py-2">Total</td>
                    {sizes.map(size => (
                      <td key={size} className="border border-border px-3 py-2 text-center">
                        {sizeTotals[size]}
                      </td>
                    ))}
                    <td className="border border-border px-3 py-2 text-center bg-primary/20">
                      {grandTotal}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
