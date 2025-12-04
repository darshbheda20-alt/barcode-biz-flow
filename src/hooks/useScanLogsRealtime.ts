import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listenLocalEvent, publishTableRefresh } from "@/lib/eventBus";
import { Tables } from "@/integrations/supabase/types";

type ScanLog = Tables<"scan_logs">;

export function useScanLogsRealtime(filters?: { scan_mode?: string }) {
  const [logs, setLogs] = useState<ScanLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    let query = supabase
      .from("scan_logs")
      .select("*")
      .order("created_at", { ascending: false });

    if (filters?.scan_mode) {
      query = query.eq("scan_mode", filters.scan_mode);
    }

    const { data, error } = await query;

    if (error) {
      setError(error.message);
    } else {
      setLogs(data || []);
    }
    setLoading(false);
  }, [filters?.scan_mode]);

  const refetch = useCallback(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    fetchLogs();

    const channel = supabase
      .channel('scan-logs-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'scan_logs' },
        () => {
          fetchLogs();
        }
      )
      .subscribe();

    const cleanup = listenLocalEvent('refresh-all', fetchLogs);
    const cleanupTable = listenLocalEvent('refresh-scan_logs', fetchLogs);

    return () => {
      supabase.removeChannel(channel);
      cleanup();
      cleanupTable();
    };
  }, [fetchLogs]);

  const mutate = useCallback(async (
    operation: 'insert' | 'update' | 'delete',
    data: Partial<ScanLog>,
    id?: string
  ) => {
    let result;
    if (operation === 'insert') {
      result = await supabase.from('scan_logs').insert(data as any);
    } else if (operation === 'update' && id) {
      result = await supabase.from('scan_logs').update(data).eq('id', id);
    } else if (operation === 'delete' && id) {
      result = await supabase.from('scan_logs').delete().eq('id', id);
    }

    if (!result?.error) {
      await fetchLogs();
      publishTableRefresh('scan_logs');
    }
    return result;
  }, [fetchLogs]);

  return { logs, loading, error, refetch, mutate };
}
