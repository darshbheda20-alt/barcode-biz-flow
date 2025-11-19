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
  groupIntoLines,
  extractQuantity,
  needsOCR,
  type ParsedPage,
} from "@/lib/pdfParser";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface ParsedPicklistRow {
  myntra_sku: string;
  seller_sku: string;
  product_description: string;
  quantity: number;
  raw_line: string;
  source: 'pdf.js' | 'ocr';
}

interface MyntraUploadProps {
  onOrdersParsed: () => void;
}

export const MyntraUpload = ({ onOrdersParsed }: MyntraUploadProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ status: 'success' | 'error'; message: string } | null>(null);
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

  const parseMyntraPicklistPage = (parsedPage: ParsedPage): ParsedPicklistRow[] => {
    const { raw_text, text_items, page_number } = parsedPage;
    console.log(`=== PARSING MYNTRA PICKLIST PAGE ${page_number} ===`);
    
    const rows: ParsedPicklistRow[] = [];

    // Strategy 1: If we have positional text, use column-based reconstruction
    if (text_items && text_items.length > 0) {
      console.log('Using positional text reconstruction');
      
      // Group into lines
      const lines = groupIntoLines(text_items, 5);
      
      // For Myntra picklists, typical format is:
      // [Myntra SKU] [Seller SKU] [Product Description] [Quantity] [Other info]
      for (const line of lines) {
        if (line.length < 4) continue; // Need at least 4 columns
        
        const lineText = line.map(item => item.str).join(' ');
        
        // Skip header rows
        if (lineText.includes('Myntra') || lineText.includes('Code') || lineText.includes('Product')) {
          continue;
        }
        
        // Extract columns by position
        const sortedByX = [...line].sort((a, b) => a.x - b.x);
        
        // Heuristic: first column is Myntra SKU, second is Seller SKU
        const myntraSku = sortedByX[0]?.str.trim() || '';
        const sellerSku = sortedByX[1]?.str.trim() || '';
        
        // Middle items are likely product description
        const descriptionItems = sortedByX.slice(2, -2);
        const productDescription = descriptionItems.map(item => item.str).join(' ').trim();
        
        // Last items contain quantity
        const lastItems = sortedByX.slice(-2);
        const qtyText = lastItems.map(item => item.str).join(' ');
        const qtyResult = extractQuantity(qtyText);
        
        // Validate SKU patterns (should be alphanumeric with dashes)
        if (myntraSku.length > 3 && sellerSku.length > 3 && qtyResult.qty > 0) {
          rows.push({
            myntra_sku: myntraSku,
            seller_sku: sellerSku,
            product_description: productDescription || '',
            quantity: qtyResult.qty,
            raw_line: lineText,
            source: 'pdf.js'
          });
          
          console.log('Extracted Myntra product:', {
            myntra_sku: myntraSku,
            seller_sku: sellerSku,
            quantity: qtyResult.qty
          });
        }
      }
    }
    
    // Strategy 2: Fallback to regex-based parsing if positional didn't work
    if (rows.length === 0) {
      console.log('Falling back to regex-based parsing');
      
      // More flexible pattern - match any line with SKU-like tokens and a number
      const lines = raw_text.split('\n');
      
      for (const line of lines) {
        // Skip headers
        if (line.includes('Myntra') || line.includes('Code') || line.includes('Product')) {
          continue;
        }
        
        // Match patterns like: SKUABC123 LC-WM-RC-SKIN-L Product Description 5 N/A
        const tokens = line.trim().split(/\s+/);
        if (tokens.length < 4) continue;
        
        // First token is Myntra SKU
        const myntraSku = tokens[0];
        // Second token is Seller SKU
        const sellerSku = tokens[1];
        
        // Find quantity (first number in tokens)
        let quantity = 1;
        let qtyIndex = -1;
        for (let i = 2; i < tokens.length; i++) {
          if (/^\d+$/.test(tokens[i])) {
            quantity = parseInt(tokens[i]);
            qtyIndex = i;
            break;
          }
        }
        
        // Everything between seller SKU and quantity is description
        const description = qtyIndex > 2 
          ? tokens.slice(2, qtyIndex).join(' ') 
          : tokens.slice(2, -1).join(' ');
        
        if (myntraSku.length > 3 && sellerSku.length > 3) {
          rows.push({
            myntra_sku: myntraSku,
            seller_sku: sellerSku,
            product_description: description,
            quantity,
            raw_line: line,
            source: 'pdf.js'
          });
        }
      }
    }

    return rows;
  };

  const mapSKUToMasterSKU = async (sku: string): Promise<string | null> => {
    console.log('Attempting exact match for Myntra SKU:', sku);

    // Try sku_aliases table
    const { data: aliasData } = await supabase
      .from('sku_aliases')
      .select('product_id, products(master_sku)')
      .eq('marketplace', 'myntra')
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
    const filePath = `myntra/${Date.now()}_${file.name}`;
    const { data, error } = await supabase.storage
      .from('order-documents')
      .upload(filePath, file);

    if (error) throw error;
    return data.path;
  };

  const handleUpload = async () => {
    if (!file) {
      toast({
        title: "No file selected",
        description: "Please select a Myntra picklist PDF file to upload",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    setUploadStatus(null);

    try {
      console.log(`Processing Myntra picklist: ${file.name}`);
      
      // Extract pages with positional info
      const pages = await extractPagesFromPDF(file);
      
      const allParsedRows: ParsedPicklistRow[] = [];
      
      // Parse each page
      for (const page of pages) {
        // Check if OCR needed
        if (needsOCR(page.raw_text)) {
          console.log(`Page ${page.page_number} may need OCR`);
          page.ocr_text = '(OCR would run here - placeholder)';
        }
        
        const parsedRows = parseMyntraPicklistPage(page);
        page.parsed_lines = parsedRows;
        allParsedRows.push(...parsedRows);
      }

      if (allParsedRows.length === 0) {
        setUploadStatus({
          status: 'error',
          message: 'No valid products found in picklist'
        });
        setDebugData(pages);
        setUploading(false);
        return;
      }

      // Upload file to storage
      const uploadedFilePath = await uploadToStorage(file);
      console.log(`Uploaded to storage: ${uploadedFilePath}`);

      let newOrderCount = 0;
      let unmappedCount = 0;

      // Process each parsed row
      for (const row of allParsedRows) {
        try {
          // Map seller SKU to master SKU
          const masterSku = await mapSKUToMasterSKU(row.seller_sku);
          
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
            console.log(`Unmapped Myntra SKU detected: ${row.seller_sku}`);
          }

          // Generate a pseudo order ID
          const orderId = `MYNTRA-${row.myntra_sku}`;

          // Check for duplicates
          const { data: existingOrder } = await supabase
            .from('process_orders')
            .select('id, workflow_status')
            .eq('order_id', orderId)
            .eq('marketplace_sku', row.seller_sku)
            .eq('platform', 'myntra')
            .maybeSingle();

          if (existingOrder && existingOrder.workflow_status !== 'archived') {
            console.log(`Duplicate order found: ${orderId}`);
            continue;
          }

          // Insert into process_orders - ALWAYS persist, even if unmapped
          const { error: insertError } = await supabase
            .from('process_orders')
            .insert({
              platform: 'myntra',
              order_id: orderId,
              marketplace_sku: row.seller_sku,
              master_sku: masterSku,
              product_id: productId,
              product_name: row.product_description,
              quantity: row.quantity,
              workflow_status: 'pending',
              uploaded_file_path: uploadedFilePath
            });

          if (insertError) {
            console.error('Insert error:', insertError);
          } else {
            newOrderCount++;
            if (isUnmapped) {
              unmappedCount++;
            }
          }

        } catch (rowError) {
          console.error(`Error processing row:`, rowError);
        }
      }

      // Store debug data
      setDebugData(pages);

      // Trigger UI refresh
      onOrdersParsed();

      // Status message
      let statusMessage = '';
      if (newOrderCount > 0) {
        statusMessage = `Processed ${newOrderCount} item(s)`;
        if (unmappedCount > 0) {
          statusMessage += ` (${unmappedCount} unmapped SKU${unmappedCount > 1 ? 's' : ''} require mapping)`;
        }
      } else {
        statusMessage = 'No valid items found';
      }

      setUploadStatus({
        status: newOrderCount > 0 ? 'success' : 'error',
        message: statusMessage
      });

      // Show toast
      if (newOrderCount > 0) {
        const description = unmappedCount > 0
          ? `${newOrderCount} item(s) processed. ${unmappedCount} unmapped SKU${unmappedCount > 1 ? 's' : ''} require mapping below.`
          : `${newOrderCount} item(s) processed from Myntra picklist`;
        
        toast({
          title: "Myntra picklist uploaded successfully",
          description,
        });
      } else {
        toast({
          title: "Upload failed",
          description: statusMessage,
          variant: "destructive",
        });
      }

    } catch (error) {
      console.error(`Error processing Myntra picklist:`, error);
      setUploadStatus({
        status: 'error',
        message: getUserFriendlyError(error)
      });
      toast({
        title: "Upload failed",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      setFile(null);
    }
  };

  const downloadDebugJSON = () => {
    if (!debugData) return;
    
    const dataStr = JSON.stringify(debugData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `myntra-debug-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Myntra</CardTitle>
        <CardDescription>
          Upload Myntra Picklist PDF (supports layout-agnostic parsing)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Input
            type="file"
            accept=".pdf,.csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            disabled={uploading}
          />
          <Button 
            onClick={handleUpload} 
            disabled={uploading || !file}
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

        {uploadStatus && (
          <div className="flex items-start gap-2 text-sm p-2 rounded border">
            {uploadStatus.status === 'success' ? (
              <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
            ) : (
              <XCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
            )}
            <p className={uploadStatus.status === 'success' ? 'text-green-600' : 'text-red-600'}>
              {uploadStatus.message}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
