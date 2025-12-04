import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listenLocalEvent, publishTableRefresh } from "@/lib/eventBus";
import { Tables } from "@/integrations/supabase/types";

type SkuAlias = Tables<"sku_aliases">;

export function useSkuAliasesRealtime(filters?: { marketplace?: string }) {
  const [aliases, setAliases] = useState<SkuAlias[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAliases = useCallback(async () => {
    let query = supabase
      .from("sku_aliases")
      .select("*")
      .order("created_at", { ascending: false });

    if (filters?.marketplace) {
      query = query.eq("marketplace", filters.marketplace);
    }

    const { data, error } = await query;

    if (error) {
      setError(error.message);
    } else {
      setAliases(data || []);
    }
    setLoading(false);
  }, [filters?.marketplace]);

  const refetch = useCallback(() => {
    fetchAliases();
  }, [fetchAliases]);

  useEffect(() => {
    fetchAliases();

    const channel = supabase
      .channel('sku-aliases-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sku_aliases' },
        () => {
          fetchAliases();
        }
      )
      .subscribe();

    const cleanup = listenLocalEvent('refresh-all', fetchAliases);
    const cleanupTable = listenLocalEvent('refresh-sku_aliases', fetchAliases);

    return () => {
      supabase.removeChannel(channel);
      cleanup();
      cleanupTable();
    };
  }, [fetchAliases]);

  const mutate = useCallback(async (
    operation: 'insert' | 'update' | 'delete',
    data: Partial<SkuAlias>,
    id?: string
  ) => {
    let result;
    if (operation === 'insert') {
      result = await supabase.from('sku_aliases').insert(data as any);
    } else if (operation === 'update' && id) {
      result = await supabase.from('sku_aliases').update(data).eq('id', id);
    } else if (operation === 'delete' && id) {
      result = await supabase.from('sku_aliases').delete().eq('id', id);
    }

    if (!result?.error) {
      await fetchAliases();
      publishTableRefresh('sku_aliases');
    }
    return result;
  }, [fetchAliases]);

  return { aliases, loading, error, refetch, mutate };
}
