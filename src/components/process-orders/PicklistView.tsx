import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Package, Download, Calendar, History, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { DebugDownloader } from "./DebugDownloader";
import { listenLocalEvent, publishRefreshAll, publishTableRefresh } from "@/lib/eventBus";

interface PicklistItem {
  masterSku: string;
  productName: string;
  totalQuantity: number;
  orderIds: string[];
  platform: string;
  uploadedFiles: string[];
  fileTimestamps: Record<string, string>;
}

export const PicklistView = () => {
  const [picklist, setPicklist] = useState<PicklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [historicalDate, setHistoricalDate] = useState<Date | undefined>(undefined);
  const [viewingHistorical, setViewingHistorical] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchPicklist();

    // Subscribe to real-time updates
    const channel = supabase
      .channel('process_orders_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'process_orders'
        },
        () => {
          fetchPicklist();
        }
      )
      .subscribe();

    // Listen for local refresh events
    const cleanup = listenLocalEvent('refresh-all', () => fetchPicklist());
    const cleanupTable = listenLocalEvent('refresh-process_orders', () => fetchPicklist());

    return () => {
      supabase.removeChannel(channel);
      cleanup();
      cleanupTable();
    };
  }, []);

  const fetchPicklist = async (date?: Date) => {
    try {
      let query = supabase.from('process_orders').select('*');
      
      if (date) {
        // Fetch archived picklist for specific date
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);
        
        query = query
          .eq('workflow_status', 'archived')
          .gte('exported_at', startOfDay.toISOString())
          .lte('exported_at', endOfDay.toISOString());
      } else {
        // Fetch current active picklist
        query = query.in('workflow_status', ['pending', 'picklist_generated']);
      }
      
      const { data, error } = await query.order('master_sku');

      if (error) throw error;

      // Group by master SKU
      const grouped = (data || []).reduce((acc, order) => {
        // Use master_sku if available, otherwise create unique key for unmapped
        const key = order.master_sku || `unmapped_${order.marketplace_sku || order.id}`;
        const displaySku = order.master_sku || 'Unmapped SKU';
        
        if (!acc[key]) {
          acc[key] = {
            masterSku: displaySku,
            productName: order.product_name || 'Unknown Product',
            totalQuantity: 0,
            orderIds: [],
            platform: order.platform,
            uploadedFiles: [],
            fileTimestamps: {}
          };
        }
        
        // Only add quantity once per unique order_id to prevent duplicate counting
        if (!acc[key].orderIds.includes(order.order_id)) {
          acc[key].totalQuantity += order.quantity;
          acc[key].orderIds.push(order.order_id);
        }
        
        // Track unique uploaded files with timestamps
        if (order.uploaded_file_path) {
          const fileName = order.uploaded_file_path.split('/').pop() || order.uploaded_file_path;
          if (!acc[key].uploadedFiles.includes(fileName)) {
            acc[key].uploadedFiles.push(fileName);
            acc[key].fileTimestamps[fileName] = order.created_at;
          }
        }
        
        return acc;
      }, {} as Record<string, PicklistItem>);

      setPicklist(Object.values(grouped));
      setViewingHistorical(false);
    } catch (error) {
      console.error('Error fetching picklist:', error);
      toast({
        title: "Error",
        description: "Failed to fetch picklist",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchHistoricalPicklist = async (date: Date) => {
    try {
      setLoading(true);
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const { data, error } = await supabase
        .from('process_orders')
        .select('*')
        .eq('workflow_status', 'archived')
        .gte('exported_at', startOfDay.toISOString())
        .lte('exported_at', endOfDay.toISOString())
        .order('master_sku');

      if (error) throw error;

      // Group by master SKU
      const grouped = (data || []).reduce((acc, order) => {
        const key = order.master_sku || `unmapped_${order.marketplace_sku || order.id}`;
        const displaySku = order.master_sku || 'Unmapped SKU';
        
        if (!acc[key]) {
          acc[key] = {
            masterSku: displaySku,
            productName: order.product_name || 'Unknown Product',
            totalQuantity: 0,
            orderIds: [],
            platform: order.platform,
            uploadedFiles: [],
            fileTimestamps: {}
          };
        }
        
        if (!acc[key].orderIds.includes(order.order_id)) {
          acc[key].totalQuantity += order.quantity;
          acc[key].orderIds.push(order.order_id);
        }
        
        // Track unique uploaded files with timestamps
        if (order.uploaded_file_path) {
          const fileName = order.uploaded_file_path.split('/').pop() || order.uploaded_file_path;
          if (!acc[key].uploadedFiles.includes(fileName)) {
            acc[key].uploadedFiles.push(fileName);
            acc[key].fileTimestamps[fileName] = order.created_at;
          }
        }
        
        return acc;
      }, {} as Record<string, PicklistItem>);

      setPicklist(Object.values(grouped));
      setViewingHistorical(true);
    } catch (error) {
      console.error('Error fetching historical picklist:', error);
      toast({
        title: "Error",
        description: "Failed to fetch historical picklist",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleGeneratePicklist = async () => {
    try {
      // Update all pending orders to picklist_generated status
      const { error } = await supabase
        .from('process_orders')
        .update({ workflow_status: 'picklist_generated' })
        .eq('workflow_status', 'pending');

      if (error) throw error;

      toast({
        title: "Success",
        description: "Picklist generated successfully"
      });

      fetchPicklist();
    } catch (error) {
      console.error('Error generating picklist:', error);
      toast({
        title: "Error",
        description: "Failed to generate picklist",
        variant: "destructive"
      });
    }
  };

  const handleClearPicklist = async () => {
    try {
      const { error } = await supabase
        .from('process_orders')
        .update({ 
          workflow_status: 'archived',
          exported_at: new Date().toISOString()
        })
        .in('workflow_status', ['pending', 'picklist_generated']);

      if (error) throw error;

      setPicklist([]);
      
      toast({
        title: "Success",
        description: "Picklist cleared and archived"
      });
    } catch (error) {
      console.error('Error clearing picklist:', error);
      toast({
        title: "Error",
        description: "Failed to clear picklist",
        variant: "destructive"
      });
    }
  };

  const handleExportPicklist = async () => {
    if (picklist.length === 0) return;

    const csvContent = [
      ['Master SKU', 'Product Name', 'Total Quantity', 'Order IDs', 'Platform'].join(','),
      ...picklist.map(item => [
        item.masterSku,
        `"${item.productName}"`,
        item.totalQuantity,
        `"${item.orderIds.join(', ')}"`,
        item.platform
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fileName = viewingHistorical && historicalDate
      ? `picklist-${format(historicalDate, 'yyyy-MM-dd')}.csv`
      : `picklist-${new Date().toISOString().split('T')[0]}.csv`;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    // Archive current picklist orders (not for historical views)
    if (!viewingHistorical) {
      try {
        // Get all process_orders for current picklist
        const { data: processOrders, error: fetchError } = await supabase
          .from("process_orders")
          .select("*")
          .in("workflow_status", ["pending", "picklist_generated"]);

        if (fetchError) throw fetchError;

        // Create order-packing records
        const orderPackingRecords = processOrders?.map(order => ({
          order_id: order.order_id,
          platform: order.platform.toLowerCase(),
          marketplace_sku: order.marketplace_sku,
          master_sku: order.master_sku,
          product_id: order.product_id,
          quantity_required: order.quantity,
          uploaded_file_path: order.uploaded_file_path,
          status: 'pending'
        })).filter(r => r.platform) || [];

        let createdPackingRecords: any[] = [];
        if (orderPackingRecords.length > 0) {
          console.log('Creating order packing records:', orderPackingRecords);
          const { data: packingData, error: packingError } = await supabase
            .from('order_packing')
            .insert(orderPackingRecords)
            .select();

          if (packingError) {
            console.error('Error creating order_packing:', packingError);
            throw packingError;
          }
          console.log('Created order_packing records:', packingData);
          createdPackingRecords = packingData || [];
        }

        // Create sales_orders records from parsed data
        const salesOrderRecords = processOrders?.map(order => {
          // Extract parsed invoice data if available
          let invoiceData: any = {};
          
          // Try to parse stored JSON data if it exists
          if (order.uploaded_file_path) {
            // For now, use available fields from process_orders
            // In future, parsed JSON should be stored and retrieved
            invoiceData = {
              line_items: order.product_name ? [{
                description: order.product_name,
                sku: order.marketplace_sku || order.master_sku,
                qty: order.quantity,
                rate: order.amount ? order.amount / order.quantity : 0,
                taxable_value: order.amount || 0,
                gst_rate: 0,
                gst_amount: 0
              }] : [],
              subtotal: order.amount || 0,
              tax_total: 0,
              grand_total: order.amount || 0,
              currency: '₹'
            };
          }

          return {
            order_id: order.order_id,
            platform: order.platform,
            marketplace_sku: order.marketplace_sku,
            master_sku: order.master_sku,
            product_id: order.product_id,
            quantity: order.quantity,
            invoice_number: order.invoice_number,
            invoice_date: order.invoice_date,
            invoice_file_path: order.uploaded_file_path,
            line_items: invoiceData.line_items || null,
            total_invoice_value: order.amount,
            total_tax: 0,
            invoice_data_missing: !order.invoice_number || !order.invoice_date,
            packet_id: order.packet_id,
            tag_id: order.tag_id
          };
        }) || [];

        if (salesOrderRecords.length > 0) {
          console.log('Creating sales_orders records:', salesOrderRecords);
          const { data: salesData, error: salesError } = await supabase
            .from('sales_orders')
            .upsert(salesOrderRecords, { 
              onConflict: 'order_id,platform',
              ignoreDuplicates: false 
            })
            .select();

          if (salesError) {
            console.error('Error creating sales_orders:', salesError);
            // Don't throw - this is non-critical
          } else {
            console.log('Created sales_orders records:', salesData);
          }
        }

        // Queue Flipkart PDFs for cropping using the correct order_packing IDs
        const flipkartOrders = processOrders?.filter(o => o.platform.toLowerCase() === 'flipkart') || [];
        const uniqueFlipkartFiles = [...new Set(flipkartOrders.map(o => o.uploaded_file_path).filter(Boolean))];

        console.log('Flipkart files to crop:', uniqueFlipkartFiles);

        for (const filePath of uniqueFlipkartFiles) {
          // Get the order_packing IDs (not process_orders IDs) for this file
          const relatedPackingIds = createdPackingRecords
            .filter(p => {
              const matchingProcessOrder = flipkartOrders.find(o => o.order_id === p.order_id);
              return matchingProcessOrder?.uploaded_file_path === filePath;
            })
            .map(p => p.id);

          console.log('Queueing crop job for:', filePath, 'with order_packing IDs:', relatedPackingIds);

          const { data: cropData, error: cropError } = await supabase
            .from('crop_queue')
            .insert({
              source_file_path: filePath,
              platform: 'flipkart',
              status: 'queued',
              order_packing_ids: relatedPackingIds
            })
            .select();

          if (cropError) {
            console.error('Error creating crop_queue:', cropError);
            throw cropError;
          }
          console.log('Created crop_queue entry:', cropData);
        }

        const { error } = await supabase
          .from('process_orders')
          .update({ 
            workflow_status: 'archived',
            exported_at: new Date().toISOString()
          })
          .in('workflow_status', ['pending', 'picklist_generated']);

        if (error) throw error;

        // Clear the current view
        setPicklist([]);
        
        // Trigger refresh events for all related tables
        publishTableRefresh('process_orders');
        publishTableRefresh('order_packing');
        publishTableRefresh('crop_queue');
        publishTableRefresh('sales_orders');
        
        toast({
          title: "Success",
          description: `Picklist exported, ${orderPackingRecords.length} packing orders created`
        });
      } catch (error) {
        console.error('Error archiving picklist:', error);
        toast({
          title: "Warning",
          description: "Picklist exported but failed to archive",
          variant: "destructive"
        });
      }
    } else {
      toast({
        title: "Success",
        description: "Historical picklist downloaded"
      });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <CardTitle className="text-lg flex items-center gap-2">
              {viewingHistorical ? <History className="h-5 w-5" /> : <Package className="h-5 w-5" />}
              {viewingHistorical ? 'Historical Picklist' : 'Generated Picklist'}
            </CardTitle>
            <CardDescription>
              {viewingHistorical && historicalDate 
                ? `Viewing picklist from ${format(historicalDate, 'PPP')} - ${picklist.length} unique SKUs`
                : `Grouped by Master SKU - ${picklist.length} unique SKUs`
              }
            </CardDescription>
            {viewingHistorical && picklist.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {Array.from(new Set(picklist.flatMap(item => item.uploadedFiles))).map((fileName, idx) => {
                  // Get timestamp from first item that has this file
                  const timestamp = picklist.find(item => item.uploadedFiles.includes(fileName))?.fileTimestamps[fileName];
                  return (
                    <Badge key={idx} variant="secondary" className="text-xs">
                      📄 {fileName}
                      {timestamp && (
                        <span className="ml-1 opacity-70">
                          • {format(new Date(timestamp), 'h:mm a')}
                        </span>
                      )}
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <DebugDownloader />
            {viewingHistorical && (
              <Button
                onClick={() => {
                  setHistoricalDate(undefined);
                  fetchPicklist();
                }}
                variant="outline"
                size="sm"
              >
                Back to Current
              </Button>
            )}
            {!viewingHistorical && (
              <>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Calendar className="h-4 w-4 mr-2" />
                      View Past
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <CalendarComponent
                      mode="single"
                      selected={historicalDate}
                      onSelect={(date) => {
                        if (date) {
                          setHistoricalDate(date);
                          fetchHistoricalPicklist(date);
                        }
                      }}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                      disabled={(date) => date > new Date()}
                    />
                  </PopoverContent>
                </Popover>
                <Button
                  onClick={handleGeneratePicklist}
                  variant="outline"
                  size="sm"
                  disabled={picklist.length === 0}
                >
                  Regenerate
                </Button>
                <Button
                  onClick={handleClearPicklist}
                  variant="outline"
                  size="sm"
                  disabled={picklist.length === 0}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear Picklist
                </Button>
              </>
            )}
            <Button
              onClick={handleExportPicklist}
              variant="outline"
              size="sm"
              disabled={picklist.length === 0}
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {picklist.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No orders ready for picklist</p>
            <p className="text-sm mt-1">Upload order files to generate a picklist</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {viewingHistorical && <TableHead className="w-16">S.No</TableHead>}
                  <TableHead>Master SKU</TableHead>
                  <TableHead>Product Name</TableHead>
                  <TableHead className="text-center">Total Qty</TableHead>
                  <TableHead className="text-center">Orders</TableHead>
                  <TableHead>Platform</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {picklist.map((item, idx) => (
                  <TableRow key={idx}>
                    {viewingHistorical && (
                      <TableCell className="font-medium text-muted-foreground">
                        {idx + 1}
                      </TableCell>
                    )}
                    <TableCell className="font-mono font-semibold">
                      {item.masterSku}
                    </TableCell>
                    <TableCell>{item.productName}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary" className="font-semibold">
                        {item.totalQuantity}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline">
                        {item.orderIds.length} orders
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className="capitalize">{item.platform}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
