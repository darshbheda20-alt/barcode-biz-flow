import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Package, Loader2, Download, Trash2, History, Archive } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { listenLocalEvent, publishRefreshAll } from "@/lib/eventBus";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DebugDownloader } from "./DebugDownloader";

interface OrderPackingItem {
  id: string;
  order_id: string;
  platform: string;
  marketplace_sku: string | null;
  master_sku: string | null;
  quantity_required: number;
  quantity_scanned: number;
  status: string;
  product_id: string | null;
  uploaded_file_path: string | null;
  label_file_path: string | null;
  invoice_file_path: string | null;
  created_at: string;
}

export function OrderPackingList() {
  const [orders, setOrders] = useState<OrderPackingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingCompleted, setViewingCompleted] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchOrders();
    
    // Subscribe to realtime changes
    const channel = supabase
      .channel('order-packing-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_packing'
        },
        () => {
          fetchOrders();
        }
      )
      .subscribe();

    // Listen for local refresh events
    const cleanup = listenLocalEvent('refresh-all', fetchOrders);
    const cleanupTable = listenLocalEvent('refresh-order_packing', fetchOrders);

    return () => {
      supabase.removeChannel(channel);
      cleanup();
      cleanupTable();
    };
  }, [viewingCompleted]);

  const fetchOrders = async () => {
    try {
      let query = supabase
        .from('order_packing')
        .select('*')
        .order('created_at', { ascending: false });

      // Filter by status based on view mode
      if (viewingCompleted) {
        query = query.eq('status', 'packed');
      } else {
        query = query.neq('status', 'packed');
      }

      const { data, error } = await query;

      if (error) throw error;
      setOrders(data || []);
    } catch (error) {
      console.error('Error fetching orders:', error);
      toast({
        title: "Error",
        description: "Failed to fetch packing orders",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClearAll = async () => {
    try {
      const { error } = await supabase
        .from('order_packing')
        .delete()
        .neq('status', 'packed');

      if (error) throw error;

      toast({
        title: "Success",
        description: "Cleared all pending packing orders"
      });

      // Trigger refresh event
      publishRefreshAll();
      
      fetchOrders();
    } catch (error) {
      console.error('Error clearing orders:', error);
      toast({
        title: "Error",
        description: "Failed to clear orders",
        variant: "destructive"
      });
    }
  };

  const handleExportCSV = () => {
    if (orders.length === 0) {
      toast({
        title: "No Data",
        description: "No orders to export"
      });
      return;
    }

    const csvContent = [
      ['Order ID', 'Platform', 'Marketplace SKU', 'Master SKU', 'Qty Required', 'Qty Scanned', 'Status', 'Created At'].join(','),
      ...orders.map(order => [
        order.order_id,
        order.platform,
        order.marketplace_sku || '',
        order.master_sku || '',
        order.quantity_required,
        order.quantity_scanned,
        order.status,
        format(new Date(order.created_at), 'yyyy-MM-dd HH:mm')
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `packing-orders-${viewingCompleted ? 'completed' : 'pending'}-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    toast({
      title: "Success",
      description: "CSV exported successfully"
    });
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      pending: "outline",
      packing: "secondary",
      packed: "default",
      dispatched: "default"
    };
    return <Badge variant={variants[status] || "outline"}>{status}</Badge>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            {viewingCompleted ? <Archive className="h-5 w-5" /> : <Package className="h-5 w-5" />}
            {viewingCompleted ? 'Completed Packing Orders' : 'Order Packing Queue'}
          </CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setViewingCompleted(!viewingCompleted)}
            >
              {viewingCompleted ? (
                <>
                  <Package className="h-4 w-4 mr-2" />
                  View Pending
                </>
              ) : (
                <>
                  <History className="h-4 w-4 mr-2" />
                  View Completed
                </>
              )}
            </Button>
            <DebugDownloader />
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              disabled={orders.length === 0}
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            {!viewingCompleted && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={orders.length === 0}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Clear All
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear All Pending Orders?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete all pending packing orders from the queue. 
                      Completed orders will not be affected. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleClearAll}>
                      Clear All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {viewingCompleted
                ? 'No completed packing orders yet.'
                : 'No orders in packing queue. Export a picklist to create packing orders.'}
            </p>
          ) : (
            orders.map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent cursor-pointer"
                onClick={() => !viewingCompleted && navigate(`/process-orders/pack/${order.id}`)}
              >
                <div className="flex items-center gap-4">
                  <Package className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{order.order_id}</p>
                    <p className="text-sm text-muted-foreground">
                      {order.platform} • {order.master_sku || order.marketplace_sku}
                    </p>
                    {viewingCompleted && (
                      <p className="text-xs text-muted-foreground">
                        Packed: {format(new Date(order.created_at), 'MMM dd, yyyy HH:mm')}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm">
                    {order.quantity_scanned} / {order.quantity_required}
                  </span>
                  {getStatusBadge(order.status)}
                  {!viewingCompleted && <Button size="sm">Pack</Button>}
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
