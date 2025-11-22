import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileText, Loader2, CheckCircle, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import * as pdfjsLib from "pdfjs-dist";
import { extractQuantityFromItems, TextItem } from "@/lib/pdfParser";

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
  const [debugData, setDebugData] = useState<{ fileName: string; pages: ParsedPage[] }[] | null>(null);
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
    detected_headers?: {
      header_row_index: number;
      header_text: string;
    };
    column_xranges?: Array<{ column: string; minX: number; maxX: number }>;
    parsed_lines: Array<{
      sku: string;
      sku_cell_text: string;
      sku_valid: boolean;
      sku_pattern_matched: string;
      quantity: number;
      qty_cell_text: string;
      productName: string;
      raw_line: string;
      row_index?: number;
      qty_source: string;
      source: 'pdfjs' | 'ocr' | 'fallback_regex';
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
      console.log(`=== PARSING PAGE ${page_number} (STRICT COLUMN-BASED) ===`);
      console.log('Text items count:', text_items.length);
      
      const productLines: ParsedOrder[] = [];
      const debugLines: ParsedPage["parsed_lines"] = [];
      
      // Blacklist tokens that should never be treated as SKUs
      const blacklistTokens = ['AWB', 'WB', 'FMPC', 'FMPP', 'Order', 'Not', 'Printed', 'Resale', 'Invoice'];
      
      // Group text items into lines based on Y coordinate
      const yTolerance = 5;
      const items = (text_items as TextItem[]) || [];
      const lines = items.reduce((acc, item) => {
        const existingLine = acc.find(line => Math.abs(line.y - item.y) < yTolerance);
        if (existingLine) {
          existingLine.items.push(item);
        } else {
          acc.push({ y: item.y, items: [item] });
        }
        return acc;
      }, [] as Array<{ y: number; items: TextItem[] }>);
      
      lines.sort((a, b) => b.y - a.y);
      lines.forEach(line => line.items.sort((a, b) => a.x - b.x));
      
      console.log(`Grouped into ${lines.length} lines`);
      
      // STEP 1: Detect header row and compute column X-ranges
      let headerRowIndex = -1;
      let columnXRanges: Array<{ column: string; minX: number; maxX: number }> = [];
      
      for (let i = 0; i < Math.min(15, lines.length); i++) {
        const lineItems = lines[i].items;
        const lineText = lineItems.map(item => item.str).join(' ').toLowerCase();
        
        // Look for header keywords
        if (/sku|product|description|qty|quantity|amount/.test(lineText)) {
          console.log(`Found header row at line ${i}: ${lineText}`);
          headerRowIndex = i;
          
          // Extract column positions from header
          const sortedByX = [...lineItems].sort((a, b) => a.x - b.x);
          
          for (let j = 0; j < sortedByX.length; j++) {
            const item = sortedByX[j];
            const itemText = item.str.toLowerCase();
            
            // Define column ranges with tolerance
            const minX = item.x - 20;
            const maxX = item.x + item.width + 100; // Extended range for wrapped text
            
            if (/sku|seller.*sku/i.test(itemText)) {
              columnXRanges.push({ column: 'SKU', minX, maxX });
              console.log(`SKU column range: ${minX} - ${maxX}`);
            } else if (/qty|quantity/i.test(itemText)) {
              columnXRanges.push({ column: 'QTY', minX, maxX });
              console.log(`QTY column range: ${minX} - ${maxX}`);
            } else if (/product|description/i.test(itemText)) {
              columnXRanges.push({ column: 'PRODUCT', minX, maxX });
            }
          }
          
          parsedPage.detected_headers = {
            header_row_index: i,
            header_text: lineText
          };
          parsedPage.column_xranges = columnXRanges;
          
          break;
        }
      }
      
      if (headerRowIndex === -1 || columnXRanges.length === 0) {
        console.warn('⚠️  No header row detected - falling back to heuristic parsing');
        // Fallback: use heuristic column detection based on typical positions
        // This will still use positional info but without explicit header anchoring
      }
      
      const skuColumnRange = columnXRanges.find(col => col.column === 'SKU');
      const qtyColumnRange = columnXRanges.find(col => col.column === 'QTY');
      
      // STEP 2: Parse data rows (start after header)
      const dataStartIdx = headerRowIndex > 0 ? headerRowIndex + 1 : 0;
      let shouldStopParsing = false;
      
      for (let i = dataStartIdx; i < lines.length; i++) {
        const lineItems = lines[i].items;
        const lineText = lineItems.map(item => item.str).join(' ');
        
        // Stop at Tax Invoice section
        if (/TAX\s+INVOICE|INVOICE\s+DETAILS|Invoice\s+Date|Billing\s+Address/i.test(lineText)) {
          console.log(`Row ${i}: Reached Tax Invoice section - stopping`);
          shouldStopParsing = true;
          break;
        }
        
        // Skip obvious non-product rows
        if (/SKU\s*ID|Handling\s+Fee|TOTAL|Shipped\s+by|IMEI|Sr\.?\s*No/i.test(lineText)) {
          continue;
        }
        
        // STEP 3: Extract SKU ONLY from SKU column x-range
        let skuCellText = '';
        let skuTokens: string[] = [];
        
        if (skuColumnRange) {
          // Get all items in SKU column range for this row
          const skuItems = lineItems.filter(item => 
            item.x >= skuColumnRange.minX && item.x <= skuColumnRange.maxX
          );
          
          skuCellText = skuItems.map(item => item.str).join('').trim();
          skuTokens = skuCellText.split(/\s+/).filter(t => t.length > 0);
        } else {
          // Fallback: look for SKU-like patterns anywhere
          const matches = lineText.match(/[A-Z]{3,}(?:-[A-Z0-9]+){2,}/g);
          if (matches) {
            skuTokens = matches;
            skuCellText = matches.join(' ');
          }
        }
        
        if (skuTokens.length === 0) continue;
        
        // STEP 4: Validate each SKU token with STRICT patterns
        for (const skuRaw of skuTokens) {
          const sku = skuRaw.replace(/\s+/g, '').trim().toUpperCase();
          
          // Check blacklist
          if (blacklistTokens.some(bl => sku.includes(bl.toUpperCase()))) {
            console.log(`Row ${i}: SKU "${sku}" contains blacklisted token - rejecting`);
            continue;
          }
          
          // Strict validation patterns
          const vendorPatterns = [
            /^[A-Z0-9]+-[A-Z0-9\-]*\d{2,}$/,  // Pattern with digits at end
            /\b(LANGO|LGO|LC|LNGO|L-A|L-)\-[A-Z0-9\-]{4,}\b/i  // Vendor prefixes
          ];
          
          let skuValid = false;
          let matchedPattern = '';
          
          // Must contain at least one digit
          if (!/\d/.test(sku)) {
            console.log(`Row ${i}: SKU "${sku}" rejected - no digits (e.g., GUL-GUL-GUL)`);
            debugLines.push({
              sku: sku,
              sku_cell_text: skuCellText,
              sku_valid: false,
              sku_pattern_matched: 'NONE - no digits',
              quantity: 0,
              qty_cell_text: '',
              productName: '',
              raw_line: lineText,
              row_index: i,
              qty_source: 'none',
              source: 'pdfjs'
            });
            continue;
          }
          
          for (const pattern of vendorPatterns) {
            if (pattern.test(sku)) {
              skuValid = true;
              matchedPattern = pattern.toString();
              break;
            }
          }
          
          if (!skuValid) {
            console.log(`Row ${i}: SKU "${sku}" failed pattern validation`);
            debugLines.push({
              sku: sku,
              sku_cell_text: skuCellText,
              sku_valid: false,
              sku_pattern_matched: 'NONE - pattern mismatch',
              quantity: 0,
              qty_cell_text: '',
              productName: '',
              raw_line: lineText,
              row_index: i,
              qty_source: 'none',
              source: 'pdfjs'
            });
            continue;
          }
          
          console.log(`Row ${i}: ✓ Valid SKU "${sku}" (pattern: ${matchedPattern})`);
          
          // STEP 5: Extract quantity from QTY column
          let quantity = 1;
          let qtyCellText = '';
          let qtySource = 'guessed';
          
          if (qtyColumnRange) {
            const qtyItems = lineItems.filter(item =>
              item.x >= qtyColumnRange.minX && item.x <= qtyColumnRange.maxX
            );
            qtyCellText = qtyItems.map(item => item.str).join(' ').trim();
            
            const qtyMatch = qtyCellText.match(/\d{1,2}/);
            if (qtyMatch) {
              quantity = parseInt(qtyMatch[0]);
              qtySource = 'column';
            }
          } else {
            // Fallback: use positional quantity extractor
            const quantityResult = extractQuantityFromItems(items, lineItems[0].y, 5);
            quantity = quantityResult.qty;
            qtySource = quantityResult.source;
            qtyCellText = quantity.toString();
          }
          
          // Extract product name
          const nameText = lineText
            .replace(sku, '')
            .replace(/Qty[:\s]*\d+/i, '')
            .replace(/Quantity[:\s]*\d+/i, '')
            .replace(/\b\d+\b/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          const productName = nameText || 'Unknown Product';
          
          productLines.push({
            orderId: orderContext.orderId || `FLP-${Date.now()}-${productLines.length}`,
            invoiceNumber: orderContext.invoiceNumber || `INV-${Date.now()}`,
            invoiceDate: orderContext.invoiceDate,
            trackingId: orderContext.trackingId || '',
            sku,
            productName,
            quantity,
            amount: 0,
            paymentType: orderContext.paymentType
          });
          
          debugLines.push({
            sku,
            sku_cell_text: skuCellText,
            sku_valid: true,
            sku_pattern_matched: matchedPattern,
            quantity,
            qty_cell_text: qtyCellText,
            productName,
            raw_line: lineText,
            row_index: i,
            qty_source: qtySource,
            source: 'pdfjs'
          });
        }
      }
      
      console.log(`=== PAGE ${page_number} COMPLETE: ${productLines.length} valid product(s) ===`);
      parsedPage.parsed_lines = debugLines;
      
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
      setDebugData(null);
    }
  };

  const downloadDebugJSON = () => {
    if (!debugData) return;
    
    const debugJSON = JSON.stringify(debugData, null, 2);
    const debugBlob = new Blob([debugJSON], { type: 'application/json' });
    const debugUrl = URL.createObjectURL(debugBlob);
    const debugLink = document.createElement('a');
    debugLink.href = debugUrl;
    debugLink.download = `flipkart-debug-${Date.now()}.json`;
    debugLink.click();
    URL.revokeObjectURL(debugUrl);
    
    toast({
      title: "Debug JSON Downloaded",
      description: "Parse details saved for QA review"
    });
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
        // Parse each page - each page may contain MULTIPLE products
        for (let pageNum = 0; pageNum < parsedPages.length; pageNum++) {
          const parsedPage = parsedPages[pageNum];
          const pageText = parsedPage.raw_text || '';

          // Extract order-level context PER PAGE so each order is counted correctly
          const orderIdMatch = pageText.match(/Order\s*Id[:\s]+(OD\d{15,})/i) || pageText.match(/OD\d{15,}/i);
          const orderId = orderIdMatch ? (orderIdMatch[1] || orderIdMatch[0]) : '';

          const invoiceMatch = pageText.match(/Invoice\s*No[:\s]+([A-Z0-9]+)/i);
          const invoiceNumber = invoiceMatch ? invoiceMatch[1] : '';

          const dateMatch = pageText.match(/Invoice\s*Date[:\s]+(\d{1,2}-\d{1,2}-\d{4})/i);
          const invoiceDate = dateMatch ? convertDateFormat(dateMatch[1]) : new Date().toISOString().split('T')[0];

          const trackingMatch = pageText.match(/AWB\s*No\.?\s*\(N\)[:\s]+([A-Z0-9]+)/i) || 
                               pageText.match(/AWB[:\s]+([A-Z0-9]+)/i);
          const trackingId = trackingMatch ? trackingMatch[1] : '';

          const paymentType = pageText.match(/COD|Cash\s+on\s+Delivery/i) ? 'COD' : 'Prepaid';
          
          const orderContext = { orderId, invoiceNumber, invoiceDate, trackingId, paymentType };
          
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
    setDebugData(debugData);
    setUploading(false);

    // Log debug JSON to console
    console.log('=== DEBUG JSON ===');
    console.log(JSON.stringify(debugData, null, 2));

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
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Upload Status:</h4>
              {debugData && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadDebugJSON}
                  className="text-xs"
                >
                  Download Debug JSON
                </Button>
              )}
            </div>
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
