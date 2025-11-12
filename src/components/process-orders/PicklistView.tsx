import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Package, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PicklistItem {
  masterSku: string;
  productName: string;
  totalQuantity: number;
  orderIds: string[];
  platform: string;
}

export const PicklistView = () => {
  const [picklist, setPicklist] = useState<PicklistItem[]>([]);
  const [loading, setLoading] = useState(true);
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

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchPicklist = async () => {
    try {
      const { data, error } = await supabase
        .from('process_orders')
        .select('*')
        .in('workflow_status', ['pending', 'picklist_generated'])
        .order('master_sku');

      if (error) throw error;

      // Group by master SKU
      const grouped = (data || []).reduce((acc, order) => {
        const key = order.master_sku || 'unmapped';
        if (!acc[key]) {
          acc[key] = {
            masterSku: order.master_sku || 'Unmapped SKU',
            productName: order.product_name || 'Unknown Product',
            totalQuantity: 0,
            orderIds: [],
            platform: order.platform
          };
        }
        acc[key].totalQuantity += order.quantity;
        acc[key].orderIds.push(order.order_id);
        return acc;
      }, {} as Record<string, PicklistItem>);

      setPicklist(Object.values(grouped));
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

  const handleExportPicklist = () => {
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
    a.download = `picklist-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    toast({
      title: "Success",
      description: "Picklist exported successfully"
    });
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
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Package className="h-5 w-5" />
              Generated Picklist
            </CardTitle>
            <CardDescription>
              Grouped by Master SKU - {picklist.length} unique SKUs
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleGeneratePicklist}
              variant="outline"
              size="sm"
              disabled={picklist.length === 0}
            >
              Regenerate
            </Button>
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
