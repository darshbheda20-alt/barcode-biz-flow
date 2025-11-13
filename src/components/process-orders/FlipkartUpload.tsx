import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileText, Loader2, CheckCircle, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import * as pdfjsLib from "pdfjs-dist";

// Configure PDF.js worker - use unpkg for better Vite compatibility
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface ParsedOrder {
  orderId: string;
  invoiceNumber: string;
  invoiceDate: string;
  trackingId: string;
  sku: string;
  productName: string;
  quantity: number;
  amount: number;
  paymentType: string;
}

interface FlipkartUploadProps {
  onOrdersParsed: (orders: ParsedOrder[]) => void;
}

export const FlipkartUpload = ({ onOrdersParsed }: FlipkartUploadProps) => {
  const [files, setFiles] = useState<FileList | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ file: string; status: 'success' | 'error'; message: string }[]>([]);
  const { toast } = useToast();

  const extractTextFromPDF = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      fullText += pageText + '\n';
    }

    return fullText;
  };

  const parseFlipkartOrder = (text: string, fileName: string): ParsedOrder | null => {
    try {
      // Flipkart Order ID pattern - OD followed by numbers
      const orderIdMatch = text.match(/Order\s*Id[:\s]+(OD\d{15,})/i) || text.match(/OD\d{15,}/i);
      const orderId = orderIdMatch ? (orderIdMatch[1] || orderIdMatch[0]) : '';

      // Invoice Number pattern - FATTN followed by numbers
      const invoiceMatch = text.match(/Invoice\s*No[:\s]+([A-Z0-9]+)/i);
      const invoiceNumber = invoiceMatch ? invoiceMatch[1] : '';

      // Invoice Date pattern - DD-MM-YYYY format
      const dateMatch = text.match(/Invoice\s*Date[:\s]+(\d{1,2}-\d{1,2}-\d{4})/i);
      const invoiceDate = dateMatch ? dateMatch[1] : '';

      // AWB Number pattern - typically FMPC followed by numbers
      const trackingMatch = text.match(/AWB\s*No\.?\s*\(N\)[:\s]+([A-Z0-9]+)/i) || 
                           text.match(/AWB[:\s]+([A-Z0-9]+)/i);
      const trackingId = trackingMatch ? trackingMatch[1] : '';

      // SKU ID pattern - from the table
      const skuMatch = text.match(/SKU\s*ID[:\s]+([A-Z0-9\-]+)/i);
      const sku = skuMatch ? skuMatch[1] : '';

      // Product Name - description from SKU table
      const productMatch = text.match(/SKU\s*ID.*?Description\s+QTY\s+([A-Z0-9\-]+)\s+(.+?)\s+\d+/is) ||
                          text.match(/Description\s+(.+?)(?:\s+Qty|\s+HSN)/is);
      const productName = productMatch ? (productMatch[2] || productMatch[1]).trim() : '';

      // Quantity - TOTAL QTY line is most reliable
      const qtyMatch = text.match(/TOTAL\s*QTY[:\s]+(\d+)/i) || 
                      text.match(/QTY[:\s]+(\d+)/i);
      const quantity = qtyMatch ? parseInt(qtyMatch[1]) : 1;

      // Amount - TOTAL PRICE is most reliable
      const amountMatch = text.match(/TOTAL\s*PRICE[:\s]+(\d+(?:\.\d{2})?)/i) ||
                         text.match(/Total\s+(\d+\.\d{2})/i);
      const amount = amountMatch ? parseFloat(amountMatch[1]) : 0;

      // Payment type - check for COD keywords
      const paymentType = text.match(/COD|Cash\s+on\s+Delivery/i) ? 'COD' : 'Prepaid';

      if (!orderId && !trackingId && !invoiceNumber) {
        console.warn(`Could not extract essential data from ${fileName}`);
        return null;
      }

      return {
        orderId: orderId || `FLP-${Date.now()}`,
        invoiceNumber: invoiceNumber || `INV-${Date.now()}`,
        invoiceDate: invoiceDate || new Date().toISOString().split('T')[0],
        trackingId: trackingId || '',
        sku: sku || '',
        productName: productName || 'Unknown Product',
        quantity,
        amount,
        paymentType
      };
    } catch (error) {
      console.error('Error parsing order:', error);
      return null;
    }
  };

  const mapSKUToMasterSKU = async (marketplaceSku: string): Promise<{ productId: string; masterSku: string; productName: string } | null> => {
    if (!marketplaceSku) return null;

    try {
      // First, try to find via sku_aliases
      const { data: aliasData, error: aliasError } = await supabase
        .from('sku_aliases')
        .select('product_id, products!inner(id, master_sku, name)')
        .eq('marketplace', 'flipkart')
        .or(`alias_value.eq.${marketplaceSku},marketplace_sku.eq.${marketplaceSku}`)
        .single();

      if (!aliasError && aliasData) {
        return {
          productId: aliasData.product_id,
          masterSku: (aliasData.products as any).master_sku,
          productName: (aliasData.products as any).name
        };
      }

      // If not found in aliases, try direct product lookup by barcode or master_sku
      const { data: productData, error: productError } = await supabase
        .from('products')
        .select('id, master_sku, name')
        .or(`barcode.eq.${marketplaceSku},master_sku.ilike.%${marketplaceSku}%`)
        .single();

      if (!productError && productData) {
        return {
          productId: productData.id,
          masterSku: productData.master_sku,
          productName: productData.name
        };
      }

      return null;
    } catch (error) {
      console.error('Error mapping SKU:', error);
      return null;
    }
  };

  const uploadToStorage = async (file: File): Promise<string | null> => {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `flipkart/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('order-documents')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      return fileName;
    } catch (error) {
      console.error('Storage upload error:', error);
      return null;
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(e.target.files);
      setUploadStatus([]);
    }
  };

  const handleUpload = async () => {
    if (!files || files.length === 0) {
      toast({
        title: "No files selected",
        description: "Please select PDF files to upload",
        variant: "destructive"
      });
      return;
    }

    setUploading(true);
    const allParsedOrders: ParsedOrder[] = [];
    const statusUpdates: typeof uploadStatus = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      try {
        // Extract text from PDF
        const text = await extractTextFromPDF(file);
        
        // Parse order details
        const parsedOrder = parseFlipkartOrder(text, file.name);
        
        if (!parsedOrder) {
          statusUpdates.push({
            file: file.name,
            status: 'error',
            message: 'Could not extract order data'
          });
          continue;
        }

        // Map to Master SKU
        const mapping = await mapSKUToMasterSKU(parsedOrder.sku);
        
        // Upload file to storage
        const storagePath = await uploadToStorage(file);

        // Insert into database
        const { error: insertError } = await supabase
          .from('process_orders')
          .insert({
            platform: 'flipkart',
            order_id: parsedOrder.orderId,
            invoice_number: parsedOrder.invoiceNumber,
            invoice_date: parsedOrder.invoiceDate,
            tracking_id: parsedOrder.trackingId,
            marketplace_sku: parsedOrder.sku,
            product_id: mapping?.productId || null,
            master_sku: mapping?.masterSku || parsedOrder.sku,
            product_name: mapping?.productName || parsedOrder.productName,
            quantity: parsedOrder.quantity,
            amount: parsedOrder.amount,
            payment_type: parsedOrder.paymentType,
            workflow_status: 'pending',
            uploaded_file_path: storagePath
          });

        if (insertError) throw insertError;

        allParsedOrders.push(parsedOrder);
        statusUpdates.push({
          file: file.name,
          status: 'success',
          message: mapping ? `Mapped to ${mapping.masterSku}` : 'Uploaded (SKU not mapped)'
        });

      } catch (error) {
        console.error(`Error processing ${file.name}:`, error);
        statusUpdates.push({
          file: file.name,
          status: 'error',
          message: error instanceof Error ? error.message : 'Processing failed'
        });
      }
    }

    setUploadStatus(statusUpdates);
    setUploading(false);

    if (allParsedOrders.length > 0) {
      onOrdersParsed(allParsedOrders);
      toast({
        title: "Upload Complete",
        description: `Successfully processed ${allParsedOrders.length} of ${files.length} files`
      });
    } else {
      toast({
        title: "Upload Failed",
        description: "Could not process any files",
        variant: "destructive"
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Flipkart Order Upload
        </CardTitle>
        <CardDescription>
          Upload combined label + invoice PDFs from Flipkart
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Input
            type="file"
            accept=".pdf"
            multiple
            onChange={handleFileChange}
            disabled={uploading}
            className="flex-1"
          />
          <Button
            onClick={handleUpload}
            disabled={!files || uploading}
            className="flex items-center gap-2"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Upload & Parse
              </>
            )}
          </Button>
        </div>

        {files && files.length > 0 && (
          <div className="text-sm text-muted-foreground">
            {files.length} file(s) selected
          </div>
        )}

        {uploadStatus.length > 0 && (
          <div className="space-y-2 mt-4">
            <h4 className="text-sm font-semibold">Upload Status:</h4>
            {uploadStatus.map((status, idx) => (
              <div
                key={idx}
                className={`flex items-start gap-2 text-sm p-2 rounded-md ${
                  status.status === 'success'
                    ? 'bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100'
                    : 'bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100'
                }`}
              >
                {status.status === 'success' ? (
                  <CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1">
                  <p className="font-medium">{status.file}</p>
                  <p className="text-xs opacity-80">{status.message}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
