import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Navigation } from "./components/Navigation";
import { ProtectedRoute } from "./components/ProtectedRoute";
import Inventory from "./pages/Inventory";
import Products from "./pages/Products";
import ScanLog from "./pages/ScanLog";
import ProcessOrders from "./pages/ProcessOrders";
import SalesOrders from "./pages/SalesOrders";
import PurchaseOrders from "./pages/PurchaseOrders";
import Users from "./pages/Users";
import MasterSKUs from "./pages/MasterSKUs";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import { PackingInterface } from "./components/process-orders/PackingInterface";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Navigation />
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
          <Route path="/products" element={<ProtectedRoute><Products /></ProtectedRoute>} />
          <Route path="/scan" element={<ProtectedRoute><ScanLog /></ProtectedRoute>} />
          <Route path="/process-orders" element={<ProtectedRoute><ProcessOrders /></ProtectedRoute>} />
          <Route path="/process-orders/pack/:id" element={<ProtectedRoute><PackingInterface /></ProtectedRoute>} />
          <Route path="/sales-orders" element={<ProtectedRoute><SalesOrders /></ProtectedRoute>} />
          <Route path="/purchase-orders" element={<ProtectedRoute><PurchaseOrders /></ProtectedRoute>} />
          <Route path="/users" element={<ProtectedRoute><Users /></ProtectedRoute>} />
          <Route path="/master-skus" element={<ProtectedRoute><MasterSKUs /></ProtectedRoute>} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
