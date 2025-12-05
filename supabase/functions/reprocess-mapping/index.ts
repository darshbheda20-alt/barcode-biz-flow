import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const normalizeSku = (raw: string | null): string => {
  if (!raw) return '';
  let s = raw.toUpperCase();
  // Remove punctuation except spaces and hyphens
  s = s.replace(/[^A-Z0-9\- ]+/g, '');
  // Collapse multiple spaces/hyphens to a single hyphen
  s = s.replace(/[\s\-]+/g, '-');
  // Trim leading/trailing hyphens
  s = s.replace(/^-+|-+$/g, '');
  return s;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify JWT authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('[Reprocess Mapping] Missing Authorization header');
      return new Response(
        JSON.stringify({ error: 'Unauthorized - missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create client with anon key first to verify the user token
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await anonClient.auth.getUser(token);

    if (authError || !user) {
      console.error('[Reprocess Mapping] Invalid token:', authError?.message);
      return new Response(
        JSON.stringify({ error: 'Unauthorized - invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Reprocess Mapping] Authenticated user: ${user.id}`);

    // Now create service role client for actual operations (bypasses RLS)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { uploaded_file_path } = await req.json();

    console.log(`[Reprocess Mapping] Starting for file: ${uploaded_file_path}`);

    // Fetch all unmapped orders for this file
    const { data: unmappedOrders, error: fetchError } = await supabase
      .from('process_orders')
      .select('*')
      .eq('uploaded_file_path', uploaded_file_path)
      .or('product_id.is.null,master_sku.is.null')
      .not('marketplace_sku', 'is', null);

    if (fetchError) {
      console.error('[Reprocess Mapping] Fetch error:', fetchError);
      throw fetchError;
    }

    console.log(`[Reprocess Mapping] Found ${unmappedOrders?.length || 0} unmapped orders`);

    if (!unmappedOrders || unmappedOrders.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No unmapped orders found',
          remapped_count: 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Preload aliases and products for normalized, case-insensitive matching
    const { data: aliasRows, error: aliasError } = await supabase
      .from('sku_aliases')
      .select('id, product_id, alias_value, marketplace');

    if (aliasError) {
      console.error('[Reprocess Mapping] Alias fetch error:', aliasError);
    }

    const { data: productRows, error: productError } = await supabase
      .from('products')
      .select('id, master_sku, barcode');

    if (productError) {
      console.error('[Reprocess Mapping] Product fetch error:', productError);
    }

    let remappedCount = 0;
    const remappedOrders: Array<{
      order_id: string;
      marketplace_sku: string | null;
      master_sku: string | null;
      mapping_source: string;
    }> = [];

    for (const order of unmappedOrders) {
      const rawSku = order.marketplace_sku as string | null;
      const normalizedSku = normalizeSku(rawSku);

      if (!normalizedSku) {
        console.log(`[Reprocess Mapping] Skipping order ${order.id} with empty marketplace_sku`);
        continue;
      }

      console.log(
        `[Reprocess Mapping] Attempting normalized mapping for order ${order.id}: ${rawSku} → ${normalizedSku}`
      );

      let productId: string | null = null;
      let masterSku: string | null = null;
      let mappingSource = '';

      // Step 1: Try normalized match in sku_aliases (by marketplace)
      const aliasCandidates = (aliasRows || []).filter((row: any) =>
        row.marketplace === order.platform &&
        normalizeSku(row.alias_value as string | null) === normalizedSku
      );

      if (aliasCandidates.length === 1) {
        const match = aliasCandidates[0];
        productId = match.product_id as string | null;
        const productFromAlias = (productRows || []).find(
          (p: any) => p.id === productId
        );
        masterSku = productFromAlias ? (productFromAlias.master_sku as string) : null;
        mappingSource = 'alias_normalized_exact';
        console.log(
          `[Reprocess Mapping] Alias match found for ${normalizedSku}: ${masterSku} (product ${productId})`
        );
      } else if (aliasCandidates.length > 1) {
        console.log(
          `[Reprocess Mapping] Multiple alias matches for ${normalizedSku}; leaving unmapped to avoid ambiguity`
        );
      }

      // Step 2: Try normalized master_sku match
      if (!productId) {
        const masterCandidates = (productRows || []).filter(
          (row: any) => normalizeSku(row.master_sku as string | null) === normalizedSku
        );

        if (masterCandidates.length === 1) {
          const match = masterCandidates[0];
          productId = match.id as string;
          masterSku = match.master_sku as string;
          mappingSource = 'master_sku_normalized_exact';
          console.log(
            `[Reprocess Mapping] Master SKU match found for ${normalizedSku}: ${masterSku} (product ${productId})`
          );
        } else if (masterCandidates.length > 1) {
          console.log(
            `[Reprocess Mapping] Multiple master_sku matches for ${normalizedSku}; leaving unmapped`
          );
        }
      }

      // Step 3: Try normalized barcode match (fallback)
      if (!productId) {
        const barcodeCandidates = (productRows || []).filter(
          (row: any) => normalizeSku(row.barcode as string | null) === normalizedSku
        );

        if (barcodeCandidates.length === 1) {
          const match = barcodeCandidates[0];
          productId = match.id as string;
          masterSku = match.master_sku as string;
          mappingSource = 'barcode_normalized_exact';
          console.log(
            `[Reprocess Mapping] Barcode match found for ${normalizedSku}: ${masterSku} (product ${productId})`
          );
        } else if (barcodeCandidates.length > 1) {
          console.log(
            `[Reprocess Mapping] Multiple barcode matches for ${normalizedSku}; leaving unmapped`
          );
        }
      }

      // Update the order if we found a single unambiguous match
      if (productId && masterSku) {
        const { error: updateError } = await supabase
          .from('process_orders')
          .update({
            product_id: productId,
            master_sku: masterSku,
            updated_at: new Date().toISOString(),
          })
          .eq('id', order.id);

        if (updateError) {
          console.error(`[Reprocess Mapping] Update error for ${order.id}:`, updateError);
        } else {
          remappedCount++;
          remappedOrders.push({
            order_id: order.order_id,
            marketplace_sku: rawSku,
            master_sku: masterSku,
            mapping_source: 'reprocess_retry',
          });
          console.log(
            `[Reprocess Mapping] ✓ Remapped ${rawSku} → ${masterSku} (source=${mappingSource})`
          );
        }
      } else {
        console.log(
          `[Reprocess Mapping] ✗ No normalized match found for ${rawSku} (${normalizedSku}); remains unmapped`
        );
      }
    }

    console.log(
      `[Reprocess Mapping] Complete. Remapped ${remappedCount} of ${unmappedOrders.length} orders`
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully remapped ${remappedCount} orders`,
        remapped_count: remappedCount,
        total_unmapped: unmappedOrders.length,
        remapped_orders: remappedOrders,
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[Reprocess Mapping] Error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
