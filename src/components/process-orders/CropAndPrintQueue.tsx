import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Loader2, Download, FileText, Printer } from "lucide-react";
import { cropFlipkartPdf, combineLabels, combineInvoices } from "@/lib/pdfCropper";
import { DebugDownloader } from "./DebugDownloader";
import { listenLocalEvent, publishRefreshAll } from "@/lib/eventBus";

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

    // Listen for local refresh events
    const cleanup = listenLocalEvent('refresh-all', fetchQueue);
    const cleanupTable = listenLocalEvent('refresh-crop_queue', fetchQueue);

    return () => {
      supabase.removeChannel(channel);
      cleanup();
      cleanupTable();
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
      const filePath = item.source_file_path.replace(/^order-documents\//, '');
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('order-documents')
        .download(filePath);

      if (downloadError) throw downloadError;

      const arrayBuffer = await fileData.arrayBuffer();
      const pdfBytes = new Uint8Array(arrayBuffer);

      // Crop the PDF
      const cropResults = await cropFlipkartPdf(pdfBytes);

      // Generate file names
      const baseName = item.source_file_path.split('/').pop()?.replace('.pdf', '') || 'crop';
      const timestamp = Date.now();
      
      // Create combined PDFs
      const combinedLabels = await combineLabels(cropResults);
      const combinedInvoices = await combineInvoices(cropResults);
      
      // Upload combined labels PDF
      const labelsFileName = `${baseName}_labels_${timestamp}.pdf`;
      const { error: labelsUploadError } = await supabase.storage
        .from('printed-labels')
        .upload(labelsFileName, combinedLabels, {
          contentType: 'application/pdf',
          upsert: true
        });

      if (labelsUploadError) throw labelsUploadError;

      // Upload combined invoices PDF
      const invoicesFileName = `${baseName}_invoices_${timestamp}.pdf`;
      const { error: invoicesUploadError } = await supabase.storage
        .from('printed-invoices')
        .upload(invoicesFileName, combinedInvoices, {
          contentType: 'application/pdf',
          upsert: true
        });

      if (invoicesUploadError) throw invoicesUploadError;

      // Also upload individual page PDFs and update order_packing records
      const cropMetadata = [];

      for (let i = 0; i < cropResults.length; i++) {
        const { labelPdf, invoicePdf, pageNumber } = cropResults[i];
        
        const labelName = `${baseName}_page${pageNumber}_label.pdf`;
        const invoiceName = `${baseName}_page${pageNumber}_invoice.pdf`;

        // Upload individual label
        await supabase.storage
          .from('printed-labels')
          .upload(labelName, labelPdf, {
            contentType: 'application/pdf',
            upsert: true
          });

        // Upload individual invoice
        await supabase.storage
          .from('printed-invoices')
          .upload(invoiceName, invoicePdf, {
            contentType: 'application/pdf',
            upsert: true
          });

        cropMetadata.push({
          page_number: pageNumber,
          label_path: `printed-labels/${labelName}`,
          invoice_path: `printed-invoices/${invoiceName}`,
          crop_type: 'flipkart_split'
        });

        // Update order_packing record for this page if exists
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
      
      // Add combined file paths to metadata
      const finalMetadata = {
        pages: cropMetadata,
        combined_labels_path: `printed-labels/${labelsFileName}`,
        combined_invoices_path: `printed-invoices/${invoicesFileName}`,
        total_pages: cropResults.length
      };

      // Mark as completed
      await supabase
        .from('crop_queue')
        .update({
          status: 'completed',
          crop_metadata: finalMetadata,
          completed_at: new Date().toISOString()
        })
        .eq('id', item.id);

      // Trigger refresh events
      publishRefreshAll();

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

  const downloadCroppedPdfs = async (item: CropQueueItem, type: 'labels' | 'invoices' | 'both') => {
    const metadata = item.crop_metadata as any;
    
    if (!metadata) {
      toast({
        title: "No cropped files",
        description: "This item hasn't been processed yet",
        variant: "destructive"
      });
      return;
    }

    try {
      // Download combined labels PDF
      if ((type === 'labels' || type === 'both') && metadata.combined_labels_path) {
        const labelsPath = metadata.combined_labels_path.replace(/^printed-labels\//, '');
        const { data: labelsData, error: labelsError } = await supabase.storage
          .from('printed-labels')
          .download(labelsPath);
        
        if (!labelsError && labelsData) {
          const url = URL.createObjectURL(labelsData);
          const a = document.createElement('a');
          a.href = url;
          a.download = labelsPath;
          a.click();
          URL.revokeObjectURL(url);
        }
      }

      // Download combined invoices PDF
      if ((type === 'invoices' || type === 'both') && metadata.combined_invoices_path) {
        const invoicesPath = metadata.combined_invoices_path.replace(/^printed-invoices\//, '');
        const { data: invoicesData, error: invoicesError } = await supabase.storage
          .from('printed-invoices')
          .download(invoicesPath);
        
        if (!invoicesError && invoicesData) {
          const url = URL.createObjectURL(invoicesData);
          const a = document.createElement('a');
          a.href = url;
          a.download = invoicesPath;
          a.click();
          URL.revokeObjectURL(url);
        }
      }

      toast({
        title: "Success",
        description: `${type === 'both' ? 'PDFs' : type.charAt(0).toUpperCase() + type.slice(1)} downloaded successfully`,
      });
    } catch (error) {
      console.error('Error downloading PDFs:', error);
      toast({
        title: "Error",
        description: "Failed to download PDFs",
        variant: "destructive"
      });
    }
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
        <div className="flex items-center justify-between">
          <CardTitle>Crop & Print Queue</CardTitle>
          <DebugDownloader />
        </div>
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
                  {item.status === 'completed' && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => downloadCroppedPdfs(item, 'labels')}
                        title="Download Labels PDF"
                      >
                        <Printer className="h-4 w-4 mr-1" />
                        Labels
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => downloadCroppedPdfs(item, 'invoices')}
                        title="Download Invoices PDF"
                      >
                        <FileText className="h-4 w-4 mr-1" />
                        Invoices
                      </Button>
                    </>
                  )}
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
