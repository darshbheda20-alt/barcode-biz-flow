import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Loader2, Download } from "lucide-react";
import { cropFlipkartPdf } from "@/lib/pdfCropper";

interface CropQueueItem {
  id: string;
  source_file_path: string;
  platform: string;
  status: string;
  order_packing_ids: string[];
  crop_metadata: any;
  error_message: string | null;
  created_at: string;
}

export function CropAndPrintQueue() {
  const [queue, setQueue] = useState<CropQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    fetchQueue();

    const channel = supabase
      .channel('crop-queue-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'crop_queue'
        },
        () => {
          fetchQueue();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchQueue = async () => {
    try {
      const { data, error } = await supabase
        .from('crop_queue')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setQueue(data || []);
    } catch (error) {
      console.error('Error fetching queue:', error);
      toast({
        title: "Error",
        description: "Failed to fetch crop queue",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const processCropJob = async (item: CropQueueItem) => {
    if (item.platform !== 'flipkart') {
      toast({
        title: "Info",
        description: "Only Flipkart PDFs are auto-cropped",
      });
      return;
    }

    setProcessing(item.id);

    try {
      // Update status to processing
      await supabase
        .from('crop_queue')
        .update({ status: 'processing' })
        .eq('id', item.id);

      // Download the source PDF from storage
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('order-documents')
        .download(item.source_file_path);

      if (downloadError) throw downloadError;

      const arrayBuffer = await fileData.arrayBuffer();
      const pdfBytes = new Uint8Array(arrayBuffer);

      // Crop the PDF
      const cropResults = await cropFlipkartPdf(pdfBytes);

      // Upload cropped PDFs and update order_packing records
      const cropMetadata = [];

      for (let i = 0; i < cropResults.length; i++) {
        const { labelPdf, invoicePdf } = cropResults[i];
        
        // Generate file names
        const baseName = item.source_file_path.split('/').pop()?.replace('.pdf', '') || 'crop';
        const labelName = `${baseName}_page${i + 1}_label.pdf`;
        const invoiceName = `${baseName}_page${i + 1}_invoice.pdf`;

        // Upload label
        const { error: labelUploadError } = await supabase.storage
          .from('printed-labels')
          .upload(labelName, labelPdf, {
            contentType: 'application/pdf',
            upsert: true
          });

        if (labelUploadError) throw labelUploadError;

        // Upload invoice
        const { error: invoiceUploadError } = await supabase.storage
          .from('printed-invoices')
          .upload(invoiceName, invoicePdf, {
            contentType: 'application/pdf',
            upsert: true
          });

        if (invoiceUploadError) throw invoiceUploadError;

        cropMetadata.push({
          page_number: i + 1,
          label_path: `printed-labels/${labelName}`,
          invoice_path: `printed-invoices/${invoiceName}`,
          crop_type: 'flipkart_split'
        });

        // Update first order_packing record for this page if exists
        if (item.order_packing_ids && item.order_packing_ids[i]) {
          await supabase
            .from('order_packing')
            .update({
              label_file_path: `printed-labels/${labelName}`,
              invoice_file_path: `printed-invoices/${invoiceName}`
            })
            .eq('id', item.order_packing_ids[i]);
        }
      }

      // Mark as completed
      await supabase
        .from('crop_queue')
        .update({
          status: 'completed',
          crop_metadata: cropMetadata,
          completed_at: new Date().toISOString()
        })
        .eq('id', item.id);

      toast({
        title: "Success",
        description: `Cropped ${cropResults.length} pages successfully`,
      });
    } catch (error) {
      console.error('Error processing crop:', error);
      
      await supabase
        .from('crop_queue')
        .update({
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error'
        })
        .eq('id', item.id);

      toast({
        title: "Error",
        description: "Failed to process crop job",
        variant: "destructive"
      });
    } finally {
      setProcessing(null);
    }
  };

  const downloadDebugJson = (item: CropQueueItem) => {
    const debugData = {
      id: item.id,
      source_file_path: item.source_file_path,
      platform: item.platform,
      status: item.status,
      order_packing_ids: item.order_packing_ids,
      crop_metadata: item.crop_metadata,
      error_message: item.error_message,
      created_at: item.created_at
    };

    const blob = new Blob([JSON.stringify(debugData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crop_debug_${item.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      queued: "outline",
      processing: "secondary",
      completed: "default",
      failed: "destructive"
    };
    return <Badge variant={variants[status] || "outline"}>{status}</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Crop & Print Queue</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {queue.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No items in crop queue
            </p>
          ) : (
            queue.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-4 border rounded-lg"
              >
                <div>
                  <p className="font-medium">{item.platform.toUpperCase()}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.source_file_path.split('/').pop()}
                  </p>
                  {item.error_message && (
                    <p className="text-sm text-destructive mt-1">{item.error_message}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {getStatusBadge(item.status)}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => downloadDebugJson(item)}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  {item.status === 'queued' && (
                    <Button
                      size="sm"
                      onClick={() => processCropJob(item)}
                      disabled={processing === item.id}
                    >
                      {processing === item.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        'Process'
                      )}
                    </Button>
                  )}
                  {item.status === 'failed' && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => processCropJob(item)}
                      disabled={processing === item.id}
                    >
                      Retry
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
