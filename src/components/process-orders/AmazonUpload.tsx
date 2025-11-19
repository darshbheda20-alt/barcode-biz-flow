import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileText, Loader2, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getUserFriendlyError } from "@/lib/errorHandling";
import * as pdfjsLib from "pdfjs-dist";
import {
  extractTextWithPositions,
  findASINs,
  findSellerSKUs,
  extractContextAroundIndex,
  extractQuantity,
  extractQuantityFromItems,
  extractAmazonOrderId,
  needsOCR,
  type ParsedPage,
} from "@/lib/pdfParser";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface ParsedLine {
  order_id: string;
  asin: string;
  seller_sku: string;
  qty: number;
  qty_source: 'label' | 'column' | 'proximity' | 'ocr' | 'guessed';
  qty_confidence: 'high' | 'medium' | 'low';
  raw_line: string;
  product_name?: string;
  source: 'pdf.js' | 'ocr';
}

interface AmazonUploadProps {
  onOrdersParsed: () => void;
}

export const AmazonUpload = ({ onOrdersParsed }: AmazonUploadProps) => {
  const [files, setFiles] = useState<FileList | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ file: string; status: 'success' | 'error'; message: string }[]>([]);
  const [debugData, setDebugData] = useState<ParsedPage[] | null>(null);
  const { toast } = useToast();

  const extractPagesFromPDF = async (file: File): Promise<ParsedPage[]> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages: ParsedPage[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const { raw_text, text_items } = await extractTextWithPositions(page);
      
      pages.push({
        page_number: i,
        raw_text,
        text_items,
        parsed_lines: []
      });
    }

    return pages;
  };

  const detectPageType = (text: string): 'label' | 'invoice' | 'unknown' => {
    if (text.includes('Tax Invoice') || text.includes('Invoice Number') || text.includes('Sl. No')) {
      return 'invoice';
    }
    if (text.includes('AWB') || text.includes('BOX') || text.includes('Ship To:')) {
      return 'label';
    }
    return 'unknown';
  };

  const parseAmazonInvoicePage = (parsedPage: ParsedPage): ParsedLine[] => {
    const { raw_text, text_items, page_number } = parsedPage;
    console.log(`=== PARSING AMAZON INVOICE PAGE ${page_number} ===`);
    
    const parsedLines: ParsedLine[] = [];
    const orderId = extractAmazonOrderId(raw_text);
    
    if (!orderId) {
      console.warn(`No order ID found on invoice page ${page_number}`);
      return [];
    }

    // Find all ASINs on the page
    const asins = findASINs(raw_text);
    console.log(`Found ${asins.length} ASINs on page ${page_number}:`, asins);

    // Find all seller SKUs
    const skuMatches = findSellerSKUs(raw_text);
    console.log(`Found ${skuMatches.length} seller SKU candidates`);

    // For each ASIN, try to find its seller SKU and quantity
    for (const asin of asins) {
      const asinIndex = raw_text.indexOf(asin);
      const context = extractContextAroundIndex(raw_text, asinIndex, 10, 10);
      
      // Find seller SKU in parentheses near this ASIN
      let sellerSku = '';
      for (const skuMatch of skuMatches) {
        if (Math.abs(skuMatch.index - asinIndex) < 100) {
          sellerSku = skuMatch.sku;
          break;
        }
      }

      if (!sellerSku) {
        console.warn(`No seller SKU found for ASIN ${asin}, using ASIN as fallback`);
        sellerSku = asin;
      }

      // Extract quantity using positional data if available
      let qtyResult;
      if (text_items && text_items.length > 0) {
        // Find the ASIN item to get its Y position
        const asinItem = text_items.find(item => item.str.includes(asin));
        if (asinItem) {
          qtyResult = extractQuantityFromItems(text_items, asinItem.y);
          console.log(`Quantity extracted via text_items for ${asin}:`, qtyResult);
        } else {
          qtyResult = extractQuantity(context);
          console.log(`Quantity extracted via text fallback for ${asin}:`, qtyResult);
        }
      } else {
        qtyResult = extractQuantity(context);
        console.log(`Quantity extracted via text fallback for ${asin}:`, qtyResult);
      }

      // Try to extract product name (text before ASIN)
      const productNameMatch = context.match(/^(.+?)\s+B0[A-Z0-9]{8}/);
      const productName = productNameMatch ? productNameMatch[1].trim() : '';

      parsedLines.push({
        order_id: orderId,
        asin,
        seller_sku: sellerSku,
        qty: qtyResult.qty,
        qty_source: qtyResult.source,
        qty_confidence: qtyResult.confidence,
        raw_line: context,
        product_name: productName,
        source: 'pdf.js'
      });

      console.log('Extracted product:', {
        order_id: orderId,
        asin,
        seller_sku: sellerSku,
        qty: qtyResult.qty,
        qty_source: qtyResult.source,
        qty_confidence: qtyResult.confidence,
        product_name: productName
      });
    }

    return parsedLines;
  };

  const mapSKUToMasterSKU = async (sku: string): Promise<string | null> => {
    console.log('Attempting exact match for Amazon SKU:', sku);

    // Try sku_aliases table
    const { data: aliasData } = await supabase
      .from('sku_aliases')
      .select('product_id, products(master_sku)')
      .eq('marketplace', 'amazon')
      .eq('alias_value', sku)
      .maybeSingle();

    if (aliasData?.products) {
      console.log('Found exact match in aliases:', aliasData.products.master_sku);
      return aliasData.products.master_sku;
    }

    // Try products table
    const { data: productData } = await supabase
      .from('products')
      .select('master_sku, id')
      .or(`master_sku.eq.${sku},barcode.eq.${sku}`)
      .maybeSingle();

    if (productData) {
      console.log('Found exact match in products:', productData.master_sku);
      return productData.master_sku;
    }

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
    let totalUnmappedSKUs = 0;

    for (const file of Array.from(files)) {
      try {
        console.log(`Processing file: ${file.name}`);
        
        // Extract pages with positional info
        const pages = await extractPagesFromPDF(file);
        
        // Parse invoice pages
        for (const page of pages) {
          const pageType = detectPageType(page.raw_text);
          
          if (pageType === 'invoice') {
            // Check if OCR needed
            if (needsOCR(page.raw_text)) {
              console.log(`Page ${page.page_number} may need OCR - no ASIN/SKU candidates found`);
              page.ocr_text = '(OCR would run here - placeholder)';
            }
            
            const parsedLines = parseAmazonInvoicePage(page);
            page.parsed_lines = parsedLines;
            allParsedPages.push(page);
          }
        }

        // Collect all parsed lines
        const allParsedLines = allParsedPages.flatMap(p => p.parsed_lines as ParsedLine[]);

        if (allParsedLines.length === 0) {
          statuses.push({
            file: file.name,
            status: 'error',
            message: 'No valid products found in PDF'
          });
          continue;
        }

        // Upload file to storage
        const uploadedFilePath = await uploadToStorage(file);
        console.log(`Uploaded to storage: ${uploadedFilePath}`);

        let fileNewOrderCount = 0;
        let fileUnmappedCount = 0;

        // Verify aggregation: sum of all parsed_line.qty should be consistent
        const totalParsedQty = allParsedLines.reduce((sum, line) => sum + line.qty, 0);
        console.log(`Total quantity from parsed lines: ${totalParsedQty}`);
        
        // Log qty_source distribution for QA
        const qtySourceCounts = allParsedLines.reduce((acc, line) => {
          acc[line.qty_source] = (acc[line.qty_source] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        console.log('Quantity extraction sources:', qtySourceCounts);
        
        // Flag low-confidence quantities for review
        const lowConfidenceLines = allParsedLines.filter(
          line => line.qty_confidence === 'low'
        );
        if (lowConfidenceLines.length > 0) {
          console.warn(
            `${lowConfidenceLines.length} lines have low-confidence quantities and may need review:`,
            lowConfidenceLines.map(l => ({ order_id: l.order_id, seller_sku: l.seller_sku, qty: l.qty, source: l.qty_source }))
          );
        }

        // Process each parsed line
        for (const line of allParsedLines) {
          try {
            // Map seller SKU to master SKU
            const masterSku = await mapSKUToMasterSKU(line.seller_sku);
            
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
              isUnmapped = true;
              console.log(`Unmapped Amazon SKU detected: ${line.seller_sku} (Order: ${line.order_id})`);
            }

            // Check for duplicates
            const { data: existingOrder } = await supabase
              .from('process_orders')
              .select('id, workflow_status')
              .eq('order_id', line.order_id)
              .eq('marketplace_sku', line.seller_sku)
              .eq('platform', 'amazon')
              .maybeSingle();

            if (existingOrder && existingOrder.workflow_status !== 'archived') {
              console.log(`Duplicate order found: ${line.order_id}`);
              continue;
            }

            // Insert into process_orders - ALWAYS persist, even if unmapped
            const { error: insertError } = await supabase
              .from('process_orders')
              .insert({
                platform: 'amazon',
                order_id: line.order_id,
                marketplace_sku: line.seller_sku,
                master_sku: masterSku,
                product_id: productId,
                product_name: line.product_name || '',
                quantity: line.qty,
                workflow_status: 'pending',
                uploaded_file_path: uploadedFilePath
              });

            if (insertError) {
              console.error('Insert error:', insertError);
            } else {
              fileNewOrderCount++;
              totalOrdersProcessed++;
              if (isUnmapped) {
                fileUnmappedCount++;
                totalUnmappedSKUs++;
              }
            }

          } catch (lineError) {
            console.error(`Error processing line:`, lineError);
          }
        }

        // Status message
        let statusMessage = '';
        if (fileNewOrderCount > 0) {
          statusMessage = `Processed ${fileNewOrderCount} order(s)`;
          if (fileUnmappedCount > 0) {
            statusMessage += ` (${fileUnmappedCount} unmapped SKU${fileUnmappedCount > 1 ? 's' : ''} require mapping)`;
          }
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
      }
    }

    setUploadStatus(statuses);
    setDebugData(allParsedPages);

    // Trigger UI refresh
    onOrdersParsed();

    // Show final toast
    if (totalOrdersProcessed > 0) {
      const description = totalUnmappedSKUs > 0
        ? `${totalOrdersProcessed} order(s) processed. ${totalUnmappedSKUs} unmapped SKU${totalUnmappedSKUs > 1 ? 's' : ''} require mapping below.`
        : `${totalOrdersProcessed} order(s) processed from Amazon invoices`;
      
      toast({
        title: "Amazon orders uploaded successfully",
        description,
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
          Upload invoice PDFs from Amazon (supports layout-agnostic parsing)
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
          <div className="flex gap-2">
            <Button 
              onClick={downloadDebugJSON}
              variant="outline"
              size="sm"
            >
              <FileText className="mr-2 h-4 w-4" />
              Download Debug JSON
            </Button>
            <div className="flex-1 text-xs text-muted-foreground flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              Debug JSON includes text_items, raw_text, and parsed_lines for QA
            </div>
          </div>
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
