import { useState } from "react";
import { ChevronDown, ChevronRight, AlertCircle, ShoppingCart, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";

interface Product {
  id: string;
  name: string;
  brand: string;
  master_sku: string;
  color?: string;
  brand_size?: string;
  standard_size?: string;
  barcode: string;
  mrp: number;
  cost_price: number;
  reorder_level: number;
  vendor_name: string;
  available_units: number;
  damaged_units?: number;
}

interface PurchaseOrder {
  id: string;
  product_id: string;
  quantity_ordered: number;
  quantity_received: number;
  status: string;
  ordered_at: string;
  received_at: string | null;
  notes: string | null;
  products: Product;
}

interface GroupedData<T> {
  [name: string]: {
    [color: string]: T[];
  };
}

interface ReorderGroupedViewProps {
  products: Product[];
  orderQuantities: Record<string, number>;
  onQuantityChange: (id: string, qty: number) => void;
  onMarkAsOrdered: (product: Product) => void;
  submitting: string | null;
}

interface OrderedGroupedViewProps {
  orders: PurchaseOrder[];
  onMarkAsReceived: (order: PurchaseOrder) => void;
  submitting: string | null;
  isHistory?: boolean;
}

export function ReorderGroupedView({
  products,
  orderQuantities,
  onQuantityChange,
  onMarkAsOrdered,
  submitting,
}: ReorderGroupedViewProps) {
  const [expandedNames, setExpandedNames] = useState<Set<string>>(new Set());
  const [expandedColors, setExpandedColors] = useState<Set<string>>(new Set());

  const groupedProducts: GroupedData<Product> = products.reduce((acc, product) => {
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
  }, {} as GroupedData<Product>);

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
        const totalUnitsNeeded = Object.values(colors)
          .flat()
          .reduce((sum, p) => sum + (p.reorder_level - p.available_units), 0);

        return (
          <div key={name} className="border border-warning/30 rounded-lg overflow-hidden bg-warning/5">
            <button
              onClick={() => toggleName(name)}
              className="w-full flex items-center justify-between p-4 hover:bg-warning/10 transition-colors"
            >
              <div className="flex items-center gap-2">
                {isNameExpanded ? (
                  <ChevronDown className="h-5 w-5 text-warning" />
                ) : (
                  <ChevronRight className="h-5 w-5 text-warning" />
                )}
                <AlertCircle className="h-5 w-5 text-warning" />
                <span className="font-semibold text-lg">{name}</span>
                <span className="text-sm text-muted-foreground">
                  ({Object.keys(colors).length} colors, {totalProducts} items)
                </span>
              </div>
              <Badge variant="outline" className="bg-destructive/20 text-destructive border-destructive/30">
                Need: {totalUnitsNeeded} units
              </Badge>
            </button>

            {isNameExpanded && (
              <div className="animate-accordion-down">
                {Object.keys(colors).sort().map((color) => {
                  const colorKey = getColorKey(name, color);
                  const isColorExpanded = expandedColors.has(colorKey);
                  const items = colors[color];
                  const colorUnitsNeeded = items.reduce((sum, p) => sum + (p.reorder_level - p.available_units), 0);

                  return (
                    <div key={colorKey} className="border-t border-warning/20">
                      <button
                        onClick={() => toggleColor(colorKey)}
                        className="w-full flex items-center justify-between p-3 pl-12 hover:bg-warning/10 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          {isColorExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                          <span className="font-medium">{color}</span>
                          <span className="text-sm text-muted-foreground">
                            ({items.length} items, need {colorUnitsNeeded} units)
                          </span>
                        </div>
                      </button>

                      {isColorExpanded && (
                        <div className="animate-accordion-down">
                          {items.map((product) => {
                            const unitsNeeded = product.reorder_level - product.available_units;
                            return (
                              <div
                                key={product.id}
                                className="flex items-center justify-between p-3 pl-20 border-t border-warning/10 hover:bg-warning/5 transition-colors"
                              >
                                <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                                  <div>
                                    <span className="text-muted-foreground">Size: </span>
                                    <span className="font-medium">
                                      {product.brand_size || product.standard_size || "N/A"}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">SKU: </span>
                                    <span>{product.master_sku}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Vendor: </span>
                                    <span>{product.vendor_name}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Available: </span>
                                    <span className="text-warning font-medium">{product.available_units}</span>
                                    <span className="text-muted-foreground"> / {product.reorder_level}</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 ml-4">
                                  <Badge variant="outline" className="bg-destructive/20 text-destructive border-destructive/30">
                                    -{unitsNeeded}
                                  </Badge>
                                  <Input
                                    type="number"
                                    min={1}
                                    value={orderQuantities[product.id] || unitsNeeded}
                                    onChange={(e) =>
                                      onQuantityChange(product.id, parseInt(e.target.value) || 0)
                                    }
                                    className="w-16 h-8"
                                  />
                                  <Button
                                    size="sm"
                                    onClick={() => onMarkAsOrdered(product)}
                                    disabled={submitting === product.id}
                                  >
                                    <ShoppingCart className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
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

export function OrderedGroupedView({
  orders,
  onMarkAsReceived,
  submitting,
  isHistory = false,
}: OrderedGroupedViewProps) {
  const [expandedNames, setExpandedNames] = useState<Set<string>>(new Set());
  const [expandedColors, setExpandedColors] = useState<Set<string>>(new Set());

  const groupedOrders: GroupedData<PurchaseOrder> = orders.reduce((acc, order) => {
    const name = order.products.name;
    const color = order.products.color || "No Color";

    if (!acc[name]) {
      acc[name] = {};
    }
    if (!acc[name][color]) {
      acc[name][color] = [];
    }
    acc[name][color].push(order);
    return acc;
  }, {} as GroupedData<PurchaseOrder>);

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
      {Object.keys(groupedOrders).sort().map((name) => {
        const isNameExpanded = expandedNames.has(name);
        const colors = groupedOrders[name];
        const totalOrders = Object.values(colors).reduce((sum, items) => sum + items.length, 0);
        const totalUnitsOrdered = isHistory
          ? Object.values(colors).flat().reduce((sum, o) => sum + o.quantity_received, 0)
          : Object.values(colors).flat().reduce((sum, o) => sum + (o.quantity_ordered - o.quantity_received), 0);

        return (
          <div key={name} className={`border rounded-lg overflow-hidden ${isHistory ? 'border-green-500/30 bg-green-500/5' : 'border-primary/30 bg-primary/5'}`}>
            <button
              onClick={() => toggleName(name)}
              className={`w-full flex items-center justify-between p-4 transition-colors ${isHistory ? 'hover:bg-green-500/10' : 'hover:bg-primary/10'}`}
            >
              <div className="flex items-center gap-2">
                {isNameExpanded ? (
                  <ChevronDown className={`h-5 w-5 ${isHistory ? 'text-green-600' : 'text-primary'}`} />
                ) : (
                  <ChevronRight className={`h-5 w-5 ${isHistory ? 'text-green-600' : 'text-primary'}`} />
                )}
                {isHistory ? (
                  <Check className="h-5 w-5 text-green-600" />
                ) : (
                  <ShoppingCart className="h-5 w-5 text-primary" />
                )}
                <span className="font-semibold text-lg">{name}</span>
                <span className="text-sm text-muted-foreground">
                  ({Object.keys(colors).length} colors, {totalOrders} orders)
                </span>
              </div>
              <Badge variant="outline" className={isHistory ? 'bg-green-500/20 text-green-600 border-green-500/30' : 'bg-primary/20 text-primary border-primary/30'}>
                {isHistory ? `Received: ${totalUnitsOrdered} units` : `Awaiting: ${totalUnitsOrdered} units`}
              </Badge>
            </button>

            {isNameExpanded && (
              <div className="animate-accordion-down">
                {Object.keys(colors).sort().map((color) => {
                  const colorKey = getColorKey(name, color);
                  const isColorExpanded = expandedColors.has(colorKey);
                  const items = colors[color];
                  const colorUnitsOrdered = isHistory
                    ? items.reduce((sum, o) => sum + o.quantity_received, 0)
                    : items.reduce((sum, o) => sum + (o.quantity_ordered - o.quantity_received), 0);

                  return (
                    <div key={colorKey} className={`border-t ${isHistory ? 'border-green-500/20' : 'border-primary/20'}`}>
                      <button
                        onClick={() => toggleColor(colorKey)}
                        className={`w-full flex items-center justify-between p-3 pl-12 transition-colors ${isHistory ? 'hover:bg-green-500/10' : 'hover:bg-primary/10'}`}
                      >
                        <div className="flex items-center gap-2">
                          {isColorExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                          <span className="font-medium">{color}</span>
                          <span className="text-sm text-muted-foreground">
                            ({items.length} orders, {colorUnitsOrdered} units {isHistory ? 'received' : 'awaiting'})
                          </span>
                        </div>
                      </button>

                      {isColorExpanded && (
                        <div className="animate-accordion-down">
                          {items.map((order) => {
                            const remaining = order.quantity_ordered - order.quantity_received;
                            return (
                              <div
                                key={order.id}
                                className={`flex items-center justify-between p-3 pl-20 border-t transition-colors ${isHistory ? 'border-green-500/10 hover:bg-green-500/5' : 'border-primary/10 hover:bg-primary/5'}`}
                              >
                                <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                                  <div>
                                    <span className="text-muted-foreground">Size: </span>
                                    <span className="font-medium">
                                      {order.products.brand_size || order.products.standard_size || "N/A"}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">SKU: </span>
                                    <span>{order.products.master_sku}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Ordered: </span>
                                    <span>{format(new Date(order.ordered_at), "dd MMM")}</span>
                                  </div>
                                  {isHistory && order.received_at ? (
                                    <div>
                                      <span className="text-muted-foreground">Received: </span>
                                      <span>{format(new Date(order.received_at), "dd MMM")}</span>
                                    </div>
                                  ) : (
                                    <div>
                                      <span className="text-muted-foreground">Vendor: </span>
                                      <span>{order.products.vendor_name}</span>
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 ml-4">
                                  {isHistory ? (
                                    <Badge variant="outline" className="bg-green-500/20 text-green-600 border-green-500/30">
                                      Received: {order.quantity_received}
                                    </Badge>
                                  ) : (
                                    <>
                                      <Badge variant="outline" className="bg-primary/20 text-primary border-primary/30">
                                        {order.quantity_ordered}
                                      </Badge>
                                      {order.quantity_received > 0 && (
                                        <Badge variant="outline" className="bg-green-500/20 text-green-600 border-green-500/30">
                                          +{order.quantity_received}
                                        </Badge>
                                      )}
                                      {order.status === "partially_received" && (
                                        <Badge variant="outline" className="bg-orange-500/20 text-orange-600 border-orange-500/30">
                                          Partial
                                        </Badge>
                                      )}
                                      <Button
                                        size="sm"
                                        onClick={() => onMarkAsReceived(order)}
                                        disabled={submitting === order.id}
                                      >
                                        <Check className="h-4 w-4" />
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
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
