import { useState } from "react";
import { ChevronDown, ChevronRight, Edit, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

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

interface GroupedData {
  [name: string]: {
    [color: string]: Product[];
  };
}

interface ProductGroupedViewProps {
  products: Product[];
  onEdit: (product: Product) => void;
  onDelete: (id: string, name: string) => void;
}

export default function ProductGroupedView({ products, onEdit, onDelete }: ProductGroupedViewProps) {
  const [expandedNames, setExpandedNames] = useState<Set<string>>(new Set());
  const [expandedColors, setExpandedColors] = useState<Set<string>>(new Set());

  // Group products by name, then by color
  const groupedProducts: GroupedData = products.reduce((acc, product) => {
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
  }, {} as GroupedData);

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

        return (
          <div key={name} className="border rounded-lg overflow-hidden">
            {/* Product Name Header */}
            <button
              onClick={() => toggleName(name)}
              className="w-full flex items-center justify-between p-4 bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                {isNameExpanded ? (
                  <ChevronDown className="h-5 w-5" />
                ) : (
                  <ChevronRight className="h-5 w-5" />
                )}
                <span className="font-semibold text-lg">{name}</span>
                <span className="text-sm text-muted-foreground">
                  ({Object.keys(colors).length} colors, {totalProducts} items)
                </span>
              </div>
            </button>

            {/* Colors Section */}
            {isNameExpanded && (
              <div className="animate-accordion-down">
                {Object.keys(colors).sort().map((color) => {
                  const colorKey = getColorKey(name, color);
                  const isColorExpanded = expandedColors.has(colorKey);
                  const items = colors[color];

                  return (
                    <div key={colorKey} className="border-t">
                      {/* Color Header */}
                      <button
                        onClick={() => toggleColor(colorKey)}
                        className="w-full flex items-center justify-between p-3 pl-12 bg-muted/10 hover:bg-muted/20 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          {isColorExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                          <span className="font-medium">{color}</span>
                          <span className="text-sm text-muted-foreground">
                            ({items.length} items)
                          </span>
                        </div>
                      </button>

                      {/* Individual Products */}
                      {isColorExpanded && (
                        <div className="animate-accordion-down">
                          {items.map((product) => (
                            <div
                              key={product.id}
                              className="flex items-center justify-between p-3 pl-20 border-t hover:bg-muted/5 transition-colors"
                            >
                              <div className="flex-1 grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
                                <div>
                                  <span className="text-muted-foreground">Sizes: </span>
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
                                <div>
                                  <span className="text-muted-foreground">Available: </span>
                                  <span className={product.available_units <= product.reorder_level ? "text-destructive font-medium" : ""}>
                                    {product.available_units}
                                  </span>
                                </div>
                              </div>
                              <div className="flex gap-2 ml-4">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => onEdit(product)}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => onDelete(product.id, `${product.name} - ${product.color} - ${product.brand_size || product.standard_size}`)}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
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
