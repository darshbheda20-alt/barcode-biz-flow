import { Link, useLocation } from "react-router-dom";
import { Package, PackagePlus, QrCode, ShoppingCart, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { path: "/", label: "Inventory", icon: Package },
  { path: "/add-product", label: "Add Product", icon: PackagePlus },
  { path: "/scan", label: "Scan Log", icon: QrCode },
  { path: "/sales-orders", label: "Sales Orders", icon: ShoppingCart },
  { path: "/purchase-orders", label: "Purchase Orders", icon: ClipboardList },
];

export const Navigation = () => {
  const location = useLocation();

  return (
    <nav className="border-b bg-card">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold">Inventory Manager</span>
          </div>
          <div className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="text-sm font-medium">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
};
