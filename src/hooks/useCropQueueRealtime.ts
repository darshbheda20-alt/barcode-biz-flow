import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listenLocalEvent, publishTableRefresh } from "@/lib/eventBus";
import { Tables } from "@/integrations/supabase/types";

type CropQueue = Tables<"crop_queue">;

export function useCropQueueRealtime(filters?: { status?: string }) {
  const [items, setItems] = useState<CropQueue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    let query = supabase
      .from("crop_queue")
      .select("*")
      .order("created_at", { ascending: false });

    if (filters?.status) {
      query = query.eq("status", filters.status);
    }

    const { data, error } = await query;

    if (error) {
      setError(error.message);
    } else {
      setItems(data || []);
    }
    setLoading(false);
  }, [filters?.status]);

  const refetch = useCallback(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    fetchItems();

    const channel = supabase
      .channel('crop-queue-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'crop_queue' },
        () => {
          fetchItems();
        }
      )
      .subscribe();

    const cleanup = listenLocalEvent('refresh-all', fetchItems);
    const cleanupTable = listenLocalEvent('refresh-crop_queue', fetchItems);

    return () => {
      supabase.removeChannel(channel);
      cleanup();
      cleanupTable();
    };
  }, [fetchItems]);

  const mutate = useCallback(async (
    operation: 'insert' | 'update' | 'delete',
    data: Partial<CropQueue>,
    id?: string
  ) => {
    let result;
    if (operation === 'insert') {
      result = await supabase.from('crop_queue').insert(data as any);
    } else if (operation === 'update' && id) {
      result = await supabase.from('crop_queue').update(data).eq('id', id);
    } else if (operation === 'delete' && id) {
      result = await supabase.from('crop_queue').delete().eq('id', id);
    }

    if (!result?.error) {
      await fetchItems();
      publishTableRefresh('crop_queue');
    }
    return result;
  }, [fetchItems]);

  return { items, loading, error, refetch, mutate };
}
