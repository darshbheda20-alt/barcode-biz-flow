import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface DebugDownloaderProps {
  orderId?: string;
  filePath?: string;
}

export function DebugDownloader({ orderId, filePath }: DebugDownloaderProps) {
  const handleDownloadDebug = async () => {
    try {
      // Fetch all related data for debugging
      const debugData: any = {
        timestamp: new Date().toISOString(),
        filters: { orderId, filePath }
      };

      if (orderId) {
        // Fetch process_orders
        const { data: processOrders } = await supabase
          .from('process_orders')
          .select('*')
          .eq('order_id', orderId);
        debugData.process_orders = processOrders;

        // Fetch order_packing
        const { data: orderPacking } = await supabase
          .from('order_packing')
          .select('*')
          .eq('order_id', orderId);
        debugData.order_packing = orderPacking;

        // Fetch packing_scan_audit
        if (orderPacking && orderPacking.length > 0) {
          const { data: scanAudit } = await supabase
            .from('packing_scan_audit')
            .select('*')
            .in('order_packing_id', orderPacking.map(o => o.id));
          debugData.packing_scan_audit = scanAudit;
        }

        // Fetch sales_orders
        const { data: salesOrders } = await supabase
          .from('sales_orders')
          .select('*')
          .eq('order_id', orderId);
        debugData.sales_orders = salesOrders;
      }

      if (filePath) {
        // Fetch crop_queue for this file
        const { data: cropQueue } = await supabase
          .from('crop_queue')
          .select('*')
          .eq('source_file_path', filePath);
        debugData.crop_queue = cropQueue;
      }

      // Create and download JSON
      const blob = new Blob([JSON.stringify(debugData, null, 2)], { 
        type: 'application/json' 
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `debug_${orderId || 'export'}_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Success",
        description: "Debug data downloaded"
      });
    } catch (error) {
      console.error('Error downloading debug data:', error);
      toast({
        title: "Error",
        description: "Failed to download debug data",
        variant: "destructive"
      });
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownloadDebug}
    >
      <Download className="h-4 w-4 mr-2" />
      Download Debug JSON
    </Button>
  );
}
