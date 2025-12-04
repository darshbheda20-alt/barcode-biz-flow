import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listenLocalEvent, publishTableRefresh } from "@/lib/eventBus";

export interface Product {
  id: string;
  name: string;
  brand: string;
  master_sku: string;
  color: string | null;
  brand_size: string | null;
  standard_size: string | null;
  barcode: string | null;
  mrp: number;
  cost_price: number;
  available_units: number;
  damaged_units: number;
  reorder_level: number;
  vendor_name: string;
  created_at: string;
  updated_at: string;
}

export function useProductsRealtime() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      setError(error.message);
    } else {
      setProducts(data || []);
    }
    setLoading(false);
  }, []);

  const refetch = useCallback(() => {
    fetchProducts();
  }, [fetchProducts]);

  useEffect(() => {
    fetchProducts();

    // Realtime subscription
    const channel = supabase
      .channel('products-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'products' },
        () => {
          fetchProducts();
        }
      )
      .subscribe();

    // Listen for local events
    const cleanup = listenLocalEvent('refresh-all', fetchProducts);
    const cleanupTable = listenLocalEvent('refresh-products', fetchProducts);

    return () => {
      supabase.removeChannel(channel);
      cleanup();
      cleanupTable();
    };
  }, [fetchProducts]);

  const mutate = useCallback(async (
    operation: 'insert' | 'update' | 'delete',
    data: Partial<Product>,
    id?: string
  ) => {
    let result;
    if (operation === 'insert') {
      result = await supabase.from('products').insert(data as any);
    } else if (operation === 'update' && id) {
      result = await supabase.from('products').update(data).eq('id', id);
    } else if (operation === 'delete' && id) {
      result = await supabase.from('products').delete().eq('id', id);
    }

    if (!result?.error) {
      await fetchProducts();
      publishTableRefresh('products');
    }
    return result;
  }, [fetchProducts]);

  return { products, loading, error, refetch, mutate };
}
