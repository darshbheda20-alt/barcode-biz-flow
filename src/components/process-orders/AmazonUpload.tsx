import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileText, Loader2, CheckCircle, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getUserFriendlyError } from "@/lib/errorHandling";
import * as pdfjsLib from "pdfjs-dist";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface ParsedLine {
  order_id: string;
  asin: string;
  seller_sku: string;
  qty: number;
  raw_line: string;
  product_name?: string;
}

interface ParsedPage {
  page_number: number;
  raw_text: string;
  parsed_lines: ParsedLine[];
}

interface ParsedOrder {
  orderId: string;
  asin: string;
  sellerSku: string;
  productName: string;
  quantity: number;
  invoiceNumber?: string;
  invoiceDate?: string;
  trackingId?: string;
  amount?: number;
}

interface AmazonUploadProps {
  onOrdersParsed: (orders: ParsedOrder[]) => void;
}

export const AmazonUpload = ({ onOrdersParsed }: AmazonUploadProps) => {
  const [files, setFiles] = useState<FileList | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ file: string; status: 'success' | 'error'; message: string }[]>([]);
  const [debugData, setDebugData] = useState<ParsedPage[] | null>(null);
  const { toast } = useToast();

  const extractTextFromPDF = async (file: File): Promise<string[]> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      pages.push(pageText);
    }

    return pages;
  };

  const detectPageType = (text: string): 'label' | 'invoice' | 'unknown' => {
    // Invoice page indicators
    if (text.includes('Tax Invoice') || text.includes('Invoice Number') || text.includes('Sl. No')) {
      return 'invoice';
    }
    // Label page indicators
    if (text.includes('AWB') || text.includes('BOX') || text.includes('Ship To:')) {
      return 'label';
    }
    return 'unknown';
  };

  const parseAmazonLabelPage = (text: string, pageNumber: number): { order_id: string; awb: string; box_info: string } | null => {
    // Extract Order ID
    const orderIdMatch = text.match(/Order\s*(?:ID|Id)[:\s]*([\d\-]{15,})/i) || 
                         text.match(/(\d{3}-\d{7}-\d{7})/);
    const orderId = orderIdMatch ? orderIdMatch[1].trim() : '';

    // Extract AWB
    const awbMatch = text.match(/AWB[:\s]*([\d]+)/i);
    const awb = awbMatch ? awbMatch[1].trim() : '';

    // Extract BOX info
    const boxMatch = text.match(/BOX\s*(\d+)\s*of\s*(\d+)/i);
    const boxInfo = boxMatch ? `${boxMatch[1]}/${boxMatch[2]}` : '1/1';

    if (!orderId) {
      console.warn(`No order ID found on label page ${pageNumber}`);
      return null;
    }

    console.log(`Label page ${pageNumber}: Order ${orderId}, AWB ${awb}, Box ${boxInfo}`);
    return { order_id: orderId, awb, box_info: boxInfo };
  };

  const parseAmazonInvoicePage = (text: string, pageNumber: number): ParsedPage => {
    console.log('=== PARSING AMAZON INVOICE PAGE ===');
    console.log('Page:', pageNumber);

    const parsedLines: ParsedLine[] = [];

    // Extract Order ID
    const orderIdMatch = text.match(/Order\s*(?:Number|ID)[:\s]*([\d\-]{15,})/i) || 
                         text.match(/(\d{3}-\d{7}-\d{7})/);
    const orderId = orderIdMatch ? orderIdMatch[1].trim() : '';

    if (!orderId) {
      console.warn(`No order ID found on invoice page ${pageNumber}`);
      return { page_number: pageNumber, raw_text: text, parsed_lines: [] };
    }

    // Extract invoice number and date
    const invoiceNumMatch = text.match(/Invoice\s*Number[:\s]*([^\s]+)/i);
    const invoiceDateMatch = text.match(/Invoice\s*Date[:\s]*([^\s]+)/i);

    // Pattern for product rows in invoice table
    // Example: "| 1 | Product Name... | B0XXXXXXXX ( SELLER-SKU ) HSN:... | ₹612.86 | 1 | ..."
    const productPattern = /\|\s*\d+\s*\|([^|]+)\|\s*(B0[A-Z0-9]{8,})\s*\(\s*([^\)]+?)\s*\)[^|]*\|[^|]*\|\s*(\d+)\s*\|/gi;

    let match;
    while ((match = productPattern.exec(text)) !== null) {
      const product_name = match[1].trim();
      const asin = match[2].trim();
      const seller_sku = match[3].trim();
      const qty = parseInt(match[4]);

      parsedLines.push({
        order_id: orderId,
        asin,
        seller_sku,
        qty,
        product_name,
        raw_line: match[0]
      });

      console.log('Extracted product from invoice:', {
        order_id: orderId,
        asin,
        seller_sku,
        qty,
        product_name
      });
    }

    return {
      page_number: pageNumber,
      raw_text: text,
      parsed_lines: parsedLines
    };
  };

  const mapSKUToMasterSKU = async (sku: string): Promise<string | null> => {
    console.log('Attempting exact match for Amazon SKU:', sku);

    // First, try to find in sku_aliases table (exact match only)
    const { data: aliasData, error: aliasError } = await supabase
      .from('sku_aliases')
      .select('product_id, products(master_sku)')
      .eq('marketplace', 'Amazon')
      .eq('alias_value', sku)
      .maybeSingle();

    if (aliasError) {
      console.error('Error querying sku_aliases:', aliasError);
    }

    if (aliasData?.products) {
      console.log('Found exact match in aliases:', aliasData.products.master_sku);
      return aliasData.products.master_sku;
    }

    // Second, try exact match in products table (master_sku or barcode)
    const { data: productData, error: productError } = await supabase
      .from('products')
      .select('master_sku, id')
      .or(`master_sku.eq.${sku},barcode.eq.${sku}`)
      .maybeSingle();

    if (productError) {
      console.error('Error querying products:', productError);
    }

    if (productData) {
      console.log('Found exact match in products:', productData.master_sku);
      return productData.master_sku;
    }

    // NO FUZZY MATCHING - return null if no exact match
    console.log('No exact match found for SKU:', sku);
    return null;
  };

  const uploadToStorage = async (file: File): Promise<string> => {
    const filePath = `amazon/${Date.now()}_${file.name}`;
    const { data, error } = await supabase.storage
      .from('order-documents')
      .upload(filePath, file);

    if (error) throw error;
    return data.path;
  };

  const handleUpload = async () => {
    if (!files || files.length === 0) {
      toast({
        title: "No files selected",
        description: "Please select one or more PDF files to upload",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    setUploadStatus([]);
    const allParsedPages: ParsedPage[] = [];
    const statuses: { file: string; status: 'success' | 'error'; message: string }[] = [];

    let totalOrdersProcessed = 0;
    let totalFileDuplicates = 0;
    let totalFilesSkipped = 0;
    let totalUnmappedSKUs = 0;

    for (const file of Array.from(files)) {
      try {
        console.log(`Processing file: ${file.name}`);
        
        // Extract text from all pages
        const pageTexts = await extractTextFromPDF(file);
        
        // Classify pages and group by order
        const labelPages: Array<{ page_number: number; order_id: string; awb: string; box_info: string }> = [];
        const invoicePages: ParsedPage[] = [];

        for (let i = 0; i < pageTexts.length; i++) {
          const pageText = pageTexts[i];
          const pageType = detectPageType(pageText);
          
          if (pageType === 'label') {
            const labelData = parseAmazonLabelPage(pageText, i + 1);
            if (labelData) {
              labelPages.push({ page_number: i + 1, ...labelData });
            }
          } else if (pageType === 'invoice') {
            const invoicePage = parseAmazonInvoicePage(pageText, i + 1);
            if (invoicePage.parsed_lines.length > 0) {
              invoicePages.push(invoicePage);
              allParsedPages.push(invoicePage);
            }
          }
        }

        console.log(`Found ${labelPages.length} label pages and ${invoicePages.length} invoice pages`);

        // Flatten all parsed lines from invoice pages
        const allParsedLines = invoicePages.flatMap(page => page.parsed_lines);

        if (allParsedLines.length === 0) {
          statuses.push({
            file: file.name,
            status: 'error',
            message: 'No valid products found in PDF'
          });
          totalFilesSkipped++;
          continue;
        }

        // Upload file to storage
        const uploadedFilePath = await uploadToStorage(file);
        console.log(`Uploaded to storage: ${uploadedFilePath}`);

        let fileNewOrderCount = 0;
        let fileDuplicateCount = 0;
        let fileSkippedCount = 0;
        let fileUnmappedCount = 0;

        // Process each parsed line
        for (const line of allParsedLines) {
          try {
            // Map seller SKU to master SKU (exact match only)
            const masterSku = await mapSKUToMasterSKU(line.seller_sku);
            
            // Get product_id if master SKU exists
            let productId = null;
            let isUnmapped = false;
            
            if (masterSku) {
              const { data: productData } = await supabase
                .from('products')
                .select('id')
                .eq('master_sku', masterSku)
                .maybeSingle();
              
              productId = productData?.id || null;
            } else {
              // SKU is unmapped - will be shown in UnmappedSKUs component
              isUnmapped = true;
              console.log(`Unmapped Amazon SKU detected: ${line.seller_sku} (Order: ${line.order_id})`);
            }

            // Check for duplicates
            const { data: existingOrder } = await supabase
              .from('process_orders')
              .select('id, workflow_status')
              .eq('order_id', line.order_id)
              .eq('marketplace_sku', line.seller_sku)
              .eq('platform', 'Amazon')
              .maybeSingle();

            if (existingOrder) {
              if (existingOrder.workflow_status === 'archived') {
                console.log(`Skipping archived order: ${line.order_id} - ${line.seller_sku}`);
                fileDuplicateCount++;
              } else {
                console.log(`Duplicate order found (not archived): ${line.order_id}`);
                fileSkippedCount++;
              }
              continue;
            }

            // Insert into process_orders
            const { error: insertError } = await supabase
              .from('process_orders')
              .insert({
                platform: 'Amazon',
                order_id: line.order_id,
                marketplace_sku: line.seller_sku,
                master_sku: masterSku || line.seller_sku, // Use seller SKU if unmapped
                product_id: productId,
                product_name: line.product_name || '',
                quantity: line.qty,
                workflow_status: 'pending',
                uploaded_file_path: uploadedFilePath
              });

            if (insertError) {
              console.error('Insert error:', insertError);
              fileSkippedCount++;
            } else {
              fileNewOrderCount++;
              if (isUnmapped) {
                fileUnmappedCount++;
              }
            }

          } catch (lineError) {
            console.error(`Error processing line:`, lineError);
            fileSkippedCount++;
          }
        }

        totalOrdersProcessed += fileNewOrderCount;
        totalFileDuplicates += fileDuplicateCount;
        totalFilesSkipped += fileSkippedCount;
        totalUnmappedSKUs += fileUnmappedCount;

        // Determine status message
        let statusMessage = '';
        if (fileNewOrderCount > 0) {
          statusMessage = `Processed ${fileNewOrderCount} order(s)`;
          if (fileUnmappedCount > 0) {
            statusMessage += ` (${fileUnmappedCount} unmapped SKU${fileUnmappedCount > 1 ? 's' : ''} require mapping)`;
          }
          if (fileDuplicateCount > 0) {
            statusMessage += `, ${fileDuplicateCount} duplicate(s) skipped`;
          }
        } else if (fileDuplicateCount > 0) {
          statusMessage = `All ${fileDuplicateCount} order(s) were already processed and archived`;
        } else {
          statusMessage = 'No valid orders found';
        }

        statuses.push({
          file: file.name,
          status: fileNewOrderCount > 0 ? 'success' : 'error',
          message: statusMessage
        });

      } catch (error) {
        console.error(`Error processing file ${file.name}:`, error);
        statuses.push({
          file: file.name,
          status: 'error',
          message: getUserFriendlyError(error)
        });
        totalFilesSkipped++;
      }
    }

    setUploadStatus(statuses);
    setDebugData(allParsedPages);

    // Trigger UI refresh
    onOrdersParsed([]);

    // Show final toast
    if (totalOrdersProcessed > 0) {
      const description = totalUnmappedSKUs > 0
        ? `${totalOrdersProcessed} order(s) processed across ${files.length} file(s). ${totalUnmappedSKUs} unmapped SKU${totalUnmappedSKUs > 1 ? 's' : ''} require${totalUnmappedSKUs === 1 ? 's' : ''} mapping below.`
        : `${totalOrdersProcessed} order(s) processed across ${files.length} file(s)`;
      
      toast({
        title: "Amazon orders uploaded successfully",
        description,
      });
    } else if (totalFileDuplicates > 0) {
      toast({
        title: "All orders already processed",
        description: `All ${totalFileDuplicates} order(s) were already processed and archived. Use "View Past" to see them or "Clear Picklist" to reset.`,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Upload failed",
        description: "Could not process any orders from the uploaded files",
        variant: "destructive",
      });
    }

    setUploading(false);
    setFiles(null);
  };

  const downloadDebugJSON = () => {
    if (!debugData) return;
    
    const dataStr = JSON.stringify(debugData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `amazon-debug-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Amazon Order Upload</CardTitle>
        <CardDescription>
          Upload invoice PDFs from Amazon (labels or combined documents)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Input
            type="file"
            accept=".pdf"
            multiple
            onChange={(e) => setFiles(e.target.files)}
            disabled={uploading}
          />
          <Button 
            onClick={handleUpload} 
            disabled={uploading || !files}
            size="default"
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Upload & Parse
              </>
            )}
          </Button>
        </div>

        {debugData && (
          <Button 
            onClick={downloadDebugJSON}
            variant="outline"
            size="sm"
          >
            <FileText className="mr-2 h-4 w-4" />
            Download Debug JSON
          </Button>
        )}

        {uploadStatus.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Upload Status:</p>
            {uploadStatus.map((status, idx) => (
              <div key={idx} className="flex items-start gap-2 text-sm p-2 rounded border">
                {status.status === 'success' ? (
                  <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-medium">{status.file}</p>
                  <p className="text-muted-foreground">{status.message}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
