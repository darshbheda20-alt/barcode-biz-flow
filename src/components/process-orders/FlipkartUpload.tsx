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

  interface ParsedPage {
    page_number: number;
    raw_text: string;
    text_items: Array<{ str: string; x: number; y: number; width: number; height: number }>;
    parsed_lines: Array<{
      sku: string;
      quantity: number;
      productName: string;
      raw_line: string;
      row_index?: number;
      qty_source: string;
    }>;
  }

  const extractTextFromPDF = async (file: File): Promise<ParsedPage[]> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages: ParsedPage[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      
      // Preserve positional information
      const text_items = textContent.items.map((item: any) => ({
        str: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: item.height
      }));
      
      const raw_text = text_items.map(item => item.str).join(' ');
      
      pages.push({
        page_number: i,
        raw_text,
        text_items,
        parsed_lines: []
      });
    }

    return pages;
  };

  const parseFlipkartPage = (parsedPage: ParsedPage, orderContext: { orderId: string; invoiceNumber: string; invoiceDate: string; trackingId: string; paymentType: string }): ParsedOrder[] => {
    try {
      const { page_number, raw_text, text_items } = parsedPage;
      console.log(`=== PARSING PAGE ${page_number} ===`);
      console.log('Text items count:', text_items.length);
      console.log('Raw text sample:', raw_text.substring(0, 500));
      
      const productLines: ParsedOrder[] = [];
      
      // Group text items into lines based on Y coordinate
      const yTolerance = 4;
      const lines = text_items.reduce((acc, item) => {
        const existingLine = acc.find(line => Math.abs(line.y - item.y) < yTolerance);
        if (existingLine) {
          existingLine.items.push(item);
        } else {
          acc.push({ y: item.y, items: [item] });
        }
        return acc;
      }, [] as Array<{ y: number; items: typeof text_items }>);
      
      // Sort lines by Y (top to bottom) and items within lines by X (left to right)
      lines.sort((a, b) => b.y - a.y);
      lines.forEach(line => line.items.sort((a, b) => a.x - b.x));
      
      console.log(`Grouped into ${lines.length} lines`);
      
      // Find header row containing SKU and QTY columns
      let headerLineIndex = -1;
      let skuColumnX: number | null = null;
      let qtyColumnX: number | null = null;
      
      for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i].items.map(item => item.str).join(' ');
        if (/SKU/i.test(lineText) && /QTY/i.test(lineText)) {
          headerLineIndex = i;
          
          // Find column X positions
          const skuItem = lines[i].items.find(item => /SKU/i.test(item.str));
          const qtyItem = lines[i].items.find(item => /QTY/i.test(item.str));
          
          if (skuItem) skuColumnX = skuItem.x;
          if (qtyItem) qtyColumnX = qtyItem.x;
          
          console.log(`Found header at line ${i}, SKU col X: ${skuColumnX}, QTY col X: ${qtyColumnX}`);
          break;
        }
      }
      
      // Extract product rows (all rows after header that contain data)
      if (headerLineIndex >= 0 && skuColumnX !== null && qtyColumnX !== null) {
        const xTolerance = 30;
        const wrapTolerance = 14;
        
        console.log(`Processing data rows starting from line ${headerLineIndex + 1}`);
        
        // Process all data rows after header
        for (let i = headerLineIndex + 1; i < lines.length; i++) {
          const currentLine = lines[i];
          const nextLine = i + 1 < lines.length ? lines[i + 1] : null;
          
          // Extract SKU from column
          const skuItems = currentLine.items.filter(item => 
            Math.abs(item.x - skuColumnX!) < xTolerance
          );
          
          // Check if SKU might be wrapped to next line
          if (nextLine && Math.abs(nextLine.y - currentLine.y) < wrapTolerance) {
            const wrappedSkuItems = nextLine.items.filter(item => 
              Math.abs(item.x - skuColumnX!) < xTolerance
            );
            skuItems.push(...wrappedSkuItems);
          }
          
          // Assemble SKU (preserve hyphens and join fragments)
          let sku = skuItems.map(item => item.str.trim()).join('').replace(/\s+/g, '');
          
          console.log(`Row ${i}: Raw SKU tokens = ${skuItems.map(s => s.str).join('|')}, Assembled = ${sku}`);
          
          // Validate SKU pattern
          const skuPattern = /^[A-Z]{3,}(?:-[A-Z0-9]+){2,}$/;
          if (!skuPattern.test(sku)) {
            // Check if this line is actually a product description or other data
            const lineText = currentLine.items.map(item => item.str).join(' ');
            console.log(`Row ${i}: SKU validation failed, lineText = ${lineText}`);
            if (!/Lango|Product|Description|TOTAL|Handling|Price/i.test(lineText)) {
              continue;
            }
            continue;
          }
          
          // Extract quantity from column
          const qtyItems = currentLine.items.filter(item => 
            Math.abs(item.x - qtyColumnX!) < xTolerance
          );
          
          if (nextLine && Math.abs(nextLine.y - currentLine.y) < wrapTolerance) {
            const wrappedQtyItems = nextLine.items.filter(item => 
              Math.abs(item.x - qtyColumnX!) < xTolerance
            );
            qtyItems.push(...wrappedQtyItems);
          }
          
          const qtyText = qtyItems.map(item => item.str.trim()).join('');
          const quantity = parseInt(qtyText) || 1;
          
          // Extract product name (items between SKU and QTY columns)
          const nameItems = currentLine.items.filter(item => 
            item.x > (skuColumnX! + xTolerance) && item.x < (qtyColumnX! - xTolerance)
          );
          const productName = nameItems.map(item => item.str).join(' ').trim() || 'Unknown Product';
          
          // Build raw line for debugging
          const raw_line = currentLine.items.map(item => item.str).join(' ');
          
          console.log(`Row ${i}: SKU=${sku}, QTY=${quantity}, Name=${productName}`);
          
          productLines.push({
            orderId: orderContext.orderId || `FLP-${Date.now()}-${productLines.length}`,
            invoiceNumber: orderContext.invoiceNumber || `INV-${Date.now()}`,
            invoiceDate: orderContext.invoiceDate,
            trackingId: orderContext.trackingId || '',
            sku: sku,
            productName: productName,
            quantity: quantity,
            amount: 0,
            paymentType: orderContext.paymentType
          });
        }
      } else {
        console.log('Header not found or columns not detected, trying fallback regex...');
      }
      
      // Fallback: Use regex patterns if positional parsing fails
      if (productLines.length === 0) {
        console.log('Positional parsing found no products, falling back to regex...');
        const processedSkus = new Set<string>();
        
        // Pattern: | SKU-WITH-DASHES | ... | number |
        const tablePattern = /\|\s*([A-Z]{3,}(?:-[A-Z0-9]+){2,})\s*\|[^|]*\|\s*(\d+)\s*\|/gi;
        let match;
        
        while ((match = tablePattern.exec(raw_text)) !== null) {
          const sku = match[1].trim();
          const quantity = parseInt(match[2]);
          
          if (!processedSkus.has(sku)) {
            processedSkus.add(sku);
            
            const matchPos = match.index;
            const afterMatch = raw_text.substring(matchPos, matchPos + 300);
            const nameMatch = afterMatch.match(/\|\s*([A-Za-z][^|]{10,}?)\s*\|/);
            const productName = nameMatch ? nameMatch[1].trim().split(/\s{2,}/)[0] : 'Unknown Product';
            
            console.log(`Fallback regex found: SKU=${sku}, QTY=${quantity}`);
            
            productLines.push({
              orderId: orderContext.orderId || `FLP-${Date.now()}-${productLines.length}`,
              invoiceNumber: orderContext.invoiceNumber || `INV-${Date.now()}`,
              invoiceDate: orderContext.invoiceDate,
              trackingId: orderContext.trackingId || '',
              sku: sku,
              productName: productName,
              quantity: quantity,
              amount: 0,
              paymentType: orderContext.paymentType
            });
          }
        }
      }
      
      console.log(`=== PAGE ${page_number} COMPLETE: Found ${productLines.length} product(s) ===`);
      
      // Store parsed_lines in parsedPage for debug JSON
      parsedPage.parsed_lines = productLines.map(p => ({
        sku: p.sku,
        quantity: p.quantity,
        productName: p.productName,
        raw_line: `${p.sku} | ${p.productName} | ${p.quantity}`,
        qty_source: 'column'
      }));
      
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
    const debugData: { fileName: string; pages: ParsedPage[] }[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let fileOrderCount = 0;
      let fileSkippedCount = 0;
      
      try {
        // Extract text with positional info from each page
        const parsedPages = await extractTextFromPDF(file);
        debugData.push({ fileName: file.name, pages: parsedPages });
        
        // Upload file to storage once
        const storagePath = await uploadToStorage(file);
        
        // Extract order-level context from first page
        const firstPageText = parsedPages[0]?.raw_text || '';
        
        const orderIdMatch = firstPageText.match(/Order\s*Id[:\s]+(OD\d{15,})/i) || firstPageText.match(/OD\d{15,}/i);
        const orderId = orderIdMatch ? (orderIdMatch[1] || orderIdMatch[0]) : '';

        const invoiceMatch = firstPageText.match(/Invoice\s*No[:\s]+([A-Z0-9]+)/i);
        const invoiceNumber = invoiceMatch ? invoiceMatch[1] : '';

        const dateMatch = firstPageText.match(/Invoice\s*Date[:\s]+(\d{1,2}-\d{1,2}-\d{4})/i);
        const invoiceDate = dateMatch ? convertDateFormat(dateMatch[1]) : new Date().toISOString().split('T')[0];

        const trackingMatch = firstPageText.match(/AWB\s*No\.?\s*\(N\)[:\s]+([A-Z0-9]+)/i) || 
                             firstPageText.match(/AWB[:\s]+([A-Z0-9]+)/i);
        const trackingId = trackingMatch ? trackingMatch[1] : '';

        const paymentType = firstPageText.match(/COD|Cash\s+on\s+Delivery/i) ? 'COD' : 'Prepaid';
        
        const orderContext = { orderId, invoiceNumber, invoiceDate, trackingId, paymentType };
        
        // Parse each page - each page may contain MULTIPLE products
        for (let pageNum = 0; pageNum < parsedPages.length; pageNum++) {
          const parsedPage = parsedPages[pageNum];
          
          try {
            // Parse ALL product lines from this page
            const parsedProducts = parseFlipkartPage(parsedPage, orderContext);
            
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
          statusUpdates.push({
            file: file.name,
            status: 'success',
            message: `Processed ${fileOrderCount} new order(s) from ${parsedPages.length} page(s)`
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

    // Generate debug JSON
    const debugJSON = JSON.stringify(debugData, null, 2);
    console.log('=== DEBUG JSON ===');
    console.log(debugJSON);
    
    // Create downloadable debug file
    const debugBlob = new Blob([debugJSON], { type: 'application/json' });
    const debugUrl = URL.createObjectURL(debugBlob);
    const debugLink = document.createElement('a');
    debugLink.href = debugUrl;
    debugLink.download = `flipkart-debug-${Date.now()}.json`;
    console.log('Debug JSON available for download - check console for details');

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
