import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listenLocalEvent, publishTableRefresh } from "@/lib/eventBus";
import { Tables } from "@/integrations/supabase/types";

type SalesOrder = Tables<"sales_orders">;

export function useSalesOrdersRealtime() {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from("sales_orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setError(error.message);
    } else {
      setOrders(data || []);
    }
    setLoading(false);
  }, []);

  const refetch = useCallback(() => {
    fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    fetchOrders();

    const channel = supabase
      .channel('sales-orders-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sales_orders' },
        () => {
          fetchOrders();
        }
      )
      .subscribe();

    const cleanup = listenLocalEvent('refresh-all', fetchOrders);
    const cleanupTable = listenLocalEvent('refresh-sales_orders', fetchOrders);

    return () => {
      supabase.removeChannel(channel);
      cleanup();
      cleanupTable();
    };
  }, [fetchOrders]);

  const mutate = useCallback(async (
    operation: 'insert' | 'update' | 'delete',
    data: Partial<SalesOrder> | Partial<SalesOrder>[],
    id?: string
  ) => {
    let result;
    if (operation === 'insert') {
      result = await supabase.from('sales_orders').insert(data as any);
    } else if (operation === 'update' && id) {
      result = await supabase.from('sales_orders').update(data as Partial<SalesOrder>).eq('id', id);
    } else if (operation === 'delete' && id) {
      result = await supabase.from('sales_orders').delete().eq('id', id);
    }

    if (!result?.error) {
      await fetchOrders();
      publishTableRefresh('sales_orders');
    }
    return result;
  }, [fetchOrders]);

  return { orders, loading, error, refetch, mutate };
}
