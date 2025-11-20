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

  const convertDateFormat = (dateStr: string): string => {
    // Convert DD-MM-YYYY to YYYY-MM-DD
    const match = dateStr.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
    if (match) {
      const [, day, month, year] = match;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return dateStr;
  };

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

  const parseFlipkartPage = (text: string, fileName: string): ParsedOrder[] => {
    try {
      console.log('=== PARSING PAGE ===');
      console.log('File:', fileName);
      console.log('Text length:', text.length);
      console.log('Raw text sample:', text.substring(0, 500));
      
      // Extract order-level data (common to all products on this page)
      const orderIdMatch = text.match(/Order\s*Id[:\s]+(OD\d{15,})/i) || text.match(/OD\d{15,}/i);
      const orderId = orderIdMatch ? (orderIdMatch[1] || orderIdMatch[0]) : '';

      const invoiceMatch = text.match(/Invoice\s*No[:\s]+([A-Z0-9]+)/i);
      const invoiceNumber = invoiceMatch ? invoiceMatch[1] : '';

      const dateMatch = text.match(/Invoice\s*Date[:\s]+(\d{1,2}-\d{1,2}-\d{4})/i);
      const invoiceDate = dateMatch ? dateMatch[1] : '';

      const trackingMatch = text.match(/AWB\s*No\.?\s*\(N\)[:\s]+([A-Z0-9]+)/i) || 
                           text.match(/AWB[:\s]+([A-Z0-9]+)/i);
      const trackingId = trackingMatch ? trackingMatch[1] : '';

      const paymentType = text.match(/COD|Cash\s+on\s+Delivery/i) ? 'COD' : 'Prepaid';

      if (!orderId && !trackingId && !invoiceNumber) {
        console.warn(`Could not extract essential order data from ${fileName}`);
        return [];
      }

      // Extract ALL product lines from the page using multiple patterns
      const productLines: ParsedOrder[] = [];
      const processedSkus = new Set<string>(); // Track SKUs to avoid duplicates
      
      console.log('=== SEARCHING FOR SKUS ===');
      
      // Pattern 1: More flexible table format that handles variations
      // Matches: | SKU-WITH-DASHES | ... | number |
      const tablePattern1 = /\|\s*([A-Z]{3,}(?:-[A-Z0-9]+){2,})\s*\|[^|]*\|\s*(\d+)\s*\|/gi;
      let match;
      
      while ((match = tablePattern1.exec(text)) !== null) {
        const sku = match[1].trim();
        const quantity = parseInt(match[2]);
        
        if (!processedSkus.has(sku)) {
          processedSkus.add(sku);
          
          // Try to extract product name from nearby text
          const matchPos = match.index;
          const afterMatch = text.substring(matchPos, matchPos + 300);
          const nameMatch = afterMatch.match(/\|\s*([A-Za-z][^|]{10,}?)\s*\|/);
          const productName = nameMatch ? nameMatch[1].trim().split(/\s{2,}/)[0] : 'Unknown Product';
          
          console.log(`Pattern1 found: SKU=${sku}, QTY=${quantity}, Name=${productName}`);
          
          productLines.push({
            orderId: orderId || `FLP-${Date.now()}-${productLines.length}`,
            invoiceNumber: invoiceNumber || `INV-${Date.now()}`,
            invoiceDate: invoiceDate ? convertDateFormat(invoiceDate) : new Date().toISOString().split('T')[0],
            trackingId: trackingId || '',
            sku: sku,
            productName: productName || 'Unknown Product',
            quantity: quantity || 1,
            amount: 0,
            paymentType
          });
        }
      }
      
      // Pattern 2: Line-based pattern without strict pipe reliance
      // Matches SKU patterns followed by description and qty on same or nearby lines
      const linePattern = /([A-Z]{3,}(?:-[A-Z0-9]+){2,})[^\n]*?(?:QTY|Qty|qty)[^\d]*(\d+)/gi;
      
      while ((match = linePattern.exec(text)) !== null) {
        const sku = match[1].trim();
        const quantity = parseInt(match[2]);
        
        if (!processedSkus.has(sku)) {
          processedSkus.add(sku);
          console.log(`Pattern2 found: SKU=${sku}, QTY=${quantity}`);
          
          productLines.push({
            orderId: orderId || `FLP-${Date.now()}-${productLines.length}`,
            invoiceNumber: invoiceNumber || `INV-${Date.now()}`,
            invoiceDate: invoiceDate ? convertDateFormat(invoiceDate) : new Date().toISOString().split('T')[0],
            trackingId: trackingId || '',
            sku: sku,
            productName: 'Unknown Product',
            quantity: quantity || 1,
            amount: 0,
            paymentType
          });
        }
      }


      // Fallback: If no products found with patterns above, try inline pattern
      if (productLines.length === 0) {
        console.log('No products found with table/line patterns, trying inline pattern...');
        
        // Pattern 3: Inline format - "QTY [number] [SKU]"
        const inlinePattern = /QTY\s+(\d+)\s+([A-Z][A-Z0-9\-]+)/gi;
        
        while ((match = inlinePattern.exec(text)) !== null) {
          const quantity = parseInt(match[1]);
          const sku = match[2].trim();
          
          if (!processedSkus.has(sku)) {
            processedSkus.add(sku);
            console.log(`Inline pattern found: SKU=${sku}, QTY=${quantity}`);
            
            productLines.push({
              orderId: orderId || `FLP-${Date.now()}-${productLines.length}`,
              invoiceNumber: invoiceNumber || `INV-${Date.now()}`,
              invoiceDate: invoiceDate ? convertDateFormat(invoiceDate) : new Date().toISOString().split('T')[0],
              trackingId: trackingId || '',
              sku: sku,
              productName: 'Unknown Product',
              quantity: quantity || 1,
              amount: 0,
              paymentType
            });
          }
        }
      }


      console.log(`=== PARSE COMPLETE: Found ${productLines.length} product(s) ===`);
      
      // If we found products, try to get the total amount for the order
      if (productLines.length > 0) {
        const amountMatch = text.match(/TOTAL\s*PRICE[:\s]+(\d+(?:\.\d{2})?)/i) ||
                           text.match(/Total\s+(\d+\.\d{2})/i);
        const totalAmount = amountMatch ? parseFloat(amountMatch[1]) : 0;
        
        // Distribute amount equally across products (or assign to first)
        if (totalAmount > 0) {
          productLines[0].amount = totalAmount;
        }
      }

      return productLines;
      
    } catch (error) {
      console.error('Error parsing page:', error);
      return [];
    }
  };

  const mapSKUToMasterSKU = async (marketplaceSku: string): Promise<{ productId: string; masterSku: string; productName: string } | null> => {
    if (!marketplaceSku) return null;

    console.log('=== STRICT SKU MAPPING ===');
    console.log('Looking for EXACT match for SKU:', marketplaceSku);

    try {
      // STRICT MATCHING ONLY - First, try to find via sku_aliases with EXACT match
      const { data: aliasData, error: aliasError } = await supabase
        .from('sku_aliases')
        .select('product_id, products!inner(id, master_sku, name)')
        .eq('marketplace', 'flipkart')
        .or(`alias_value.eq.${marketplaceSku},marketplace_sku.eq.${marketplaceSku}`)
        .maybeSingle();

      if (!aliasError && aliasData) {
        console.log('✓ Found EXACT match in sku_aliases:', (aliasData.products as any).master_sku);
        return {
          productId: aliasData.product_id,
          masterSku: (aliasData.products as any).master_sku,
          productName: (aliasData.products as any).name
        };
      }

      // STRICT MATCHING ONLY - Try direct product lookup with EXACT match on barcode or master_sku
      // NO FUZZY MATCHING - removed ilike with wildcards
      const { data: productData, error: productError } = await supabase
        .from('products')
        .select('id, master_sku, name')
        .or(`barcode.eq.${marketplaceSku},master_sku.eq.${marketplaceSku}`)
        .maybeSingle();

      if (!productError && productData) {
        console.log('✓ Found EXACT match in products:', productData.master_sku);
        return {
          productId: productData.id,
          masterSku: productData.master_sku,
          productName: productData.name
        };
      }

      console.log('✗ NO EXACT MATCH FOUND - SKU must be mapped manually');
      console.log('==========================');
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
      let fileOrderCount = 0;
      let fileDuplicateCount = 0;
      let fileSkippedCount = 0;
      
      try {
        // Extract text from each page separately
        const pages = await extractTextFromPDF(file);
        
        // Upload file to storage once
        const storagePath = await uploadToStorage(file);
        
        // Parse each page - each page may contain MULTIPLE products
        for (let pageNum = 0; pageNum < pages.length; pageNum++) {
          const pageText = pages[pageNum];
          
          try {
            // Parse ALL product lines from this page
            const parsedProducts = parseFlipkartPage(pageText, `${file.name} (page ${pageNum + 1})`);
            
            if (parsedProducts.length === 0) {
              console.log(`Page ${pageNum + 1} of ${file.name}: No valid product data found`);
              fileSkippedCount++;
              continue;
            }

            console.log(`Page ${pageNum + 1}: Found ${parsedProducts.length} product(s)`);

            // Process each product line separately
            for (let prodIdx = 0; prodIdx < parsedProducts.length; prodIdx++) {
              const parsedProduct = parsedProducts[prodIdx];
              
              // DUPLICATE CHECK REMOVED FOR TEST PHASE
              // Allow re-uploading same PDFs during testing

              // STRICT EXACT MATCH - Map to Master SKU
              console.log(`Page ${pageNum + 1}, Product ${prodIdx + 1}: Attempting STRICT EXACT match for SKU:`, parsedProduct.sku);
              const mapping = await mapSKUToMasterSKU(parsedProduct.sku);
              
              if (!mapping) {
                console.warn(`⚠️  UNMAPPED SKU: "${parsedProduct.sku}" - No exact match found. This SKU must be mapped manually via the Unmapped SKUs section.`);
              } else {
                console.log('✓ Successfully mapped to Master SKU:', mapping.masterSku);
              }

              // Insert into database
              const { error: insertError } = await supabase
                .from('process_orders')
                .insert({
                  platform: 'flipkart',
                  order_id: parsedProduct.orderId,
                  invoice_number: parsedProduct.invoiceNumber,
                  invoice_date: parsedProduct.invoiceDate,
                  tracking_id: parsedProduct.trackingId,
                  marketplace_sku: parsedProduct.sku,
                  product_id: mapping?.productId || null,
                  master_sku: mapping?.masterSku || parsedProduct.sku,
                  product_name: mapping?.productName || parsedProduct.productName,
                  quantity: parsedProduct.quantity,
                  amount: parsedProduct.amount,
                  payment_type: parsedProduct.paymentType,
                  workflow_status: 'pending',
                  uploaded_file_path: storagePath
                });

              if (insertError) {
                console.error(`Insert error for page ${pageNum + 1}, product ${prodIdx + 1}:`, insertError);
                continue;
              }

              allParsedOrders.push(parsedProduct);
              fileOrderCount++;
            }
            
          } catch (pageError) {
            console.error(`Error processing page ${pageNum + 1} of ${file.name}:`, pageError);
          }
        }

        if (fileOrderCount > 0) {
          const duplicateMsg = fileDuplicateCount > 0 ? ` (${fileDuplicateCount} duplicate(s) skipped)` : '';
          statusUpdates.push({
            file: file.name,
            status: 'success',
            message: `Processed ${fileOrderCount} new order(s) from ${pages.length} page(s)${duplicateMsg}`
          });
        } else if (fileDuplicateCount > 0) {
          statusUpdates.push({
            file: file.name,
            status: 'error',
            message: `All ${fileDuplicateCount} order(s) were duplicates - already processed`
          });
        } else {
          statusUpdates.push({
            file: file.name,
            status: 'error',
            message: 'No valid orders found in PDF'
          });
        }

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

    const totalDuplicates = statusUpdates.reduce((sum, s) => {
      const match = s.message.match(/(\d+) duplicate/);
      return sum + (match ? parseInt(match[1]) : 0);
    }, 0);

    if (allParsedOrders.length > 0) {
      onOrdersParsed(allParsedOrders);
      toast({
        title: "Upload Complete",
        description: `Successfully processed ${allParsedOrders.length} new order(s) from ${files.length} file(s)${totalDuplicates > 0 ? ` (${totalDuplicates} duplicates skipped)` : ''}`
      });
    } else if (totalDuplicates > 0) {
      // Even if no new orders, trigger refresh to show existing picklist
      onOrdersParsed([]);
      toast({
        title: "All Orders Already Processed",
        description: `${totalDuplicates} order(s) were already uploaded and archived. Use "View Past" to see historical picklists, or "Clear Picklist" to reprocess them.`,
        variant: "default"
      });
    } else {
      toast({
        title: "Upload Failed",
        description: "Could not process any orders from the PDF(s)",
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
