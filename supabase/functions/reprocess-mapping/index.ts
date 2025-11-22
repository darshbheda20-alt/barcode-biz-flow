import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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
          remapped_count: 0 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let remappedCount = 0;
    const remappedOrders = [];

    for (const order of unmappedOrders) {
      const marketplaceSku = order.marketplace_sku;
      console.log(`[Reprocess Mapping] Attempting to map: ${marketplaceSku}`);

      let productId = null;
      let masterSku = null;
      let mappingSource = null;

      // Step 1: Try exact alias match
      const { data: aliasMatch } = await supabase
        .from('sku_aliases')
        .select('product_id, products(master_sku)')
        .eq('alias_value', marketplaceSku)
        .eq('marketplace', order.platform)
        .single();

      if (aliasMatch) {
        productId = aliasMatch.product_id;
        masterSku = (aliasMatch.products as any)?.master_sku;
        mappingSource = 'alias_exact';
        console.log(`[Reprocess Mapping] Alias match found: ${masterSku}`);
      }

      // Step 2: Try exact master_sku match
      if (!productId) {
        const { data: productMatch } = await supabase
          .from('products')
          .select('id, master_sku')
          .eq('master_sku', marketplaceSku)
          .single();

        if (productMatch) {
          productId = productMatch.id;
          masterSku = productMatch.master_sku;
          mappingSource = 'master_sku_exact';
          console.log(`[Reprocess Mapping] Master SKU match found: ${masterSku}`);
        }
      }

      // Step 3: Try barcode match (fallback)
      if (!productId) {
        const { data: barcodeMatch } = await supabase
          .from('products')
          .select('id, master_sku')
          .eq('barcode', marketplaceSku)
          .single();

        if (barcodeMatch) {
          productId = barcodeMatch.id;
          masterSku = barcodeMatch.master_sku;
          mappingSource = 'barcode_exact';
          console.log(`[Reprocess Mapping] Barcode match found: ${masterSku}`);
        }
      }

      // Update the order if we found a match
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
            marketplace_sku: marketplaceSku,
            master_sku: masterSku,
            mapping_source: mappingSource,
          });
          console.log(`[Reprocess Mapping] ✓ Remapped ${marketplaceSku} → ${masterSku} (${mappingSource})`);
        }
      } else {
        console.log(`[Reprocess Mapping] ✗ No match found for ${marketplaceSku}`);
      }
    }

    console.log(`[Reprocess Mapping] Complete. Remapped ${remappedCount} of ${unmappedOrders.length} orders`);

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
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
