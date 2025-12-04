import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listenLocalEvent, publishTableRefresh } from "@/lib/eventBus";
import { Tables } from "@/integrations/supabase/types";

type ProcessOrder = Tables<"process_orders">;

export function useProcessOrdersRealtime(filters?: { workflow_status?: string; uploaded_file_path?: string }) {
  const [orders, setOrders] = useState<ProcessOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    let query = supabase
      .from("process_orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (filters?.workflow_status) {
      query = query.eq("workflow_status", filters.workflow_status);
    }
    if (filters?.uploaded_file_path) {
      query = query.eq("uploaded_file_path", filters.uploaded_file_path);
    }

    const { data, error } = await query;

    if (error) {
      setError(error.message);
    } else {
      setOrders(data || []);
    }
    setLoading(false);
  }, [filters?.workflow_status, filters?.uploaded_file_path]);

  const refetch = useCallback(() => {
    fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    fetchOrders();

    const channel = supabase
      .channel('process-orders-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'process_orders' },
        () => {
          fetchOrders();
        }
      )
      .subscribe();

    const cleanup = listenLocalEvent('refresh-all', fetchOrders);
    const cleanupTable = listenLocalEvent('refresh-process_orders', fetchOrders);

    return () => {
      supabase.removeChannel(channel);
      cleanup();
      cleanupTable();
    };
  }, [fetchOrders]);

  const mutate = useCallback(async (
    operation: 'insert' | 'update' | 'delete',
    data: Partial<ProcessOrder> | Partial<ProcessOrder>[],
    id?: string
  ) => {
    let result;
    if (operation === 'insert') {
      result = await supabase.from('process_orders').insert(data as any);
    } else if (operation === 'update' && id) {
      result = await supabase.from('process_orders').update(data as Partial<ProcessOrder>).eq('id', id);
    } else if (operation === 'delete' && id) {
      result = await supabase.from('process_orders').delete().eq('id', id);
    }

    if (!result?.error) {
      await fetchOrders();
      publishTableRefresh('process_orders');
    }
    return result;
  }, [fetchOrders]);

  return { orders, loading, error, refetch, mutate };
}
