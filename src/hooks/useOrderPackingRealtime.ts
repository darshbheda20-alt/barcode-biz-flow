import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listenLocalEvent, publishTableRefresh } from "@/lib/eventBus";
import { Tables } from "@/integrations/supabase/types";

type OrderPacking = Tables<"order_packing">;

export function useOrderPackingRealtime(filters?: { status?: string }) {
  const [orders, setOrders] = useState<OrderPacking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    let query = supabase
      .from("order_packing")
      .select("*")
      .order("created_at", { ascending: false });

    if (filters?.status) {
      query = query.eq("status", filters.status);
    }

    const { data, error } = await query;

    if (error) {
      setError(error.message);
    } else {
      setOrders(data || []);
    }
    setLoading(false);
  }, [filters?.status]);

  const refetch = useCallback(() => {
    fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    fetchOrders();

    const channel = supabase
      .channel('order-packing-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_packing' },
        () => {
          fetchOrders();
        }
      )
      .subscribe();

    const cleanup = listenLocalEvent('refresh-all', fetchOrders);
    const cleanupTable = listenLocalEvent('refresh-order_packing', fetchOrders);

    return () => {
      supabase.removeChannel(channel);
      cleanup();
      cleanupTable();
    };
  }, [fetchOrders]);

  const mutate = useCallback(async (
    operation: 'insert' | 'update' | 'delete',
    data: Partial<OrderPacking> | Partial<OrderPacking>[],
    id?: string
  ) => {
    let result;
    if (operation === 'insert') {
      result = await supabase.from('order_packing').insert(data as any);
    } else if (operation === 'update' && id) {
      result = await supabase.from('order_packing').update(data as Partial<OrderPacking>).eq('id', id);
    } else if (operation === 'delete' && id) {
      result = await supabase.from('order_packing').delete().eq('id', id);
    }

    if (!result?.error) {
      await fetchOrders();
      publishTableRefresh('order_packing');
    }
    return result;
  }, [fetchOrders]);

  return { orders, loading, error, refetch, mutate };
}
