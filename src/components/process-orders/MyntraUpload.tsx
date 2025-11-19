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
  extractColumnValue,
  type ParsedPage,
} from "@/lib/pdfParser";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface ParsedPicklistRow {
  myntra_sku: string;
  seller_sku: string;
  product_description: string;
  quantity: number;
  qty_source: 'column' | 'guessed' | 'label' | 'proximity' | 'ocr';
  raw_line: string;
  source: 'pdf.js' | 'ocr';
  page_number: number;
  column_indices?: {
    myntra_sku_x?: number;
    seller_sku_x?: number;
    quantity_x?: number;
  };
  seller_sku_raw_tokens?: { str: string; x: number; y: number }[];
  seller_sku_assembled?: string;
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
    const { text_items, page_number } = parsedPage;
    console.log(`=== PARSING MYNTRA PICKLIST PAGE ${page_number} ===`);
    
    const rows: ParsedPicklistRow[] = [];

    const myntraDebug: any = {
      headerRowIndex: -1,
      headerText: '',
      myntraSkuColumnIndex: null,
      sellerSkuColumnIndex: null,
      qtyColumnIndex: null,
      columnXRanges: [] as Array<{ index: number; minX: number; maxX: number }>,
    };

    if (!text_items || text_items.length === 0) {
      (parsedPage as any).myntra_debug = myntraDebug;
      return rows;
    }

    // Group into logical rows by Y coordinate
    const lines = groupIntoLines(text_items, 4);
    console.log(`Grouped ${text_items.length} text items into ${lines.length} lines`);

    // Detect header row: the first row containing a Seller SKU header variant
    const sellerHeaderVariants = [
      'seller sku code',
      'seller sku',
    ];

    let headerRowIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const text = lines[i].map((item) => item.str).join(' ').toLowerCase();
      if (sellerHeaderVariants.some((variant) => text.includes(variant))) {
        headerRowIndex = i;
        myntraDebug.headerRowIndex = i;
        myntraDebug.headerText = text;
        break;
      }
    }

    if (headerRowIndex === -1) {
      console.warn('Myntra parser: no header row with Seller Sku column found');
      (parsedPage as any).myntra_debug = myntraDebug;
      return rows;
    }

    // Build column ranges using header row text items and keywords
    const headerLine = lines[headerRowIndex];
    
    type HeaderColInfo = {
      key: 'myntra' | 'seller' | 'description' | 'qty';
      x: number;
    };

    const headerHits: HeaderColInfo[] = [];

    // Search header row for column keywords
    const headerText = headerLine.map(item => item.str).join(' ').toLowerCase();
    
    // Find Myntra Sku column
    if (headerText.includes('myntra') && headerText.includes('sku')) {
      const myntraItems = headerLine.filter(item => 
        item.str.toLowerCase().includes('myntra') || 
        item.str.toLowerCase().includes('sku') && item.x < 150
      );
      if (myntraItems.length > 0) {
        const avgX = myntraItems.reduce((sum, item) => sum + item.x, 0) / myntraItems.length;
        headerHits.push({ key: 'myntra', x: avgX });
      }
    }

    // Find Seller Sku column
    if (headerText.includes('seller') && headerText.includes('sku')) {
      const sellerItems = headerLine.filter(item => 
        item.str.toLowerCase().includes('seller') || 
        (item.str.toLowerCase().includes('sku') && item.x > 150 && item.x < 250) ||
        item.str.toLowerCase().includes('code') && item.x > 150 && item.x < 250
      );
      if (sellerItems.length > 0) {
        const avgX = sellerItems.reduce((sum, item) => sum + item.x, 0) / sellerItems.length;
        headerHits.push({ key: 'seller', x: avgX });
      }
    }

    // Find Product Description column
    if (headerText.includes('product') && headerText.includes('description')) {
      const descItems = headerLine.filter(item => 
        item.str.toLowerCase().includes('product') || 
        item.str.toLowerCase().includes('description')
      );
      if (descItems.length > 0) {
        const avgX = descItems.reduce((sum, item) => sum + item.x, 0) / descItems.length;
        headerHits.push({ key: 'description', x: avgX });
      }
    }

    // Find Quantity column
    if (headerText.includes('qty') || headerText.includes('quantity')) {
      const qtyItems = headerLine.filter(item => 
        item.str.toLowerCase().includes('qty') || 
        item.str.toLowerCase().includes('quantity')
      );
      if (qtyItems.length > 0) {
        const avgX = qtyItems.reduce((sum, item) => sum + item.x, 0) / qtyItems.length;
        headerHits.push({ key: 'qty', x: avgX });
      }
    }

    // Sort header hits left-to-right and derive x ranges
    const sortedHits = [...headerHits].sort((a, b) => a.x - b.x);

    interface ColumnRange {
      index: number;
      minX: number;
      maxX: number;
      key: 'myntra' | 'seller' | 'description' | 'qty';
    }

    const columnXRanges: ColumnRange[] = [];
    sortedHits.forEach((hit, idx) => {
      const prev = sortedHits[idx - 1];
      const next = sortedHits[idx + 1];
      const center = hit.x;
      const minX = prev ? (prev.x + center) / 2 : center - 40;
      const maxX = next ? (next.x + center) / 2 : center + 40;
      columnXRanges.push({
        index: idx,
        minX,
        maxX,
        key: hit.key,
      });
    });

    const findIndexByKey = (key: 'myntra' | 'seller' | 'description' | 'qty') =>
      columnXRanges.find((c) => c.key === key)?.index;

    const myntraSkuColIdx = findIndexByKey('myntra');
    const sellerSkuColIdx = findIndexByKey('seller');
    const descriptionColIdx = findIndexByKey('description');
    const qtyColIdx = findIndexByKey('qty');

    myntraDebug.myntraSkuColumnIndex = myntraSkuColIdx ?? null;
    myntraDebug.sellerSkuColumnIndex = sellerSkuColIdx ?? null;
    myntraDebug.qtyColumnIndex = qtyColIdx ?? null;
    myntraDebug.columnXRanges = columnXRanges;

    const myntraSkuX = headerHits.find((h) => h.key === 'myntra')?.x;
    const sellerSkuX = headerHits.find((h) => h.key === 'seller')?.x;
    const qtyX = headerHits.find((h) => h.key === 'qty')?.x;

    // Compute line centers for row band calculation
    const lineCenters = lines.map((line) =>
      line.length
        ? line.reduce((sum, item) => sum + item.y, 0) / line.length
        : 0
    );

    const getRowBounds = (rowIndex: number) => {
      const center = lineCenters[rowIndex];
      const prevCenter =
        rowIndex > 0 ? lineCenters[rowIndex - 1] : center - 10;
      const nextCenter =
        rowIndex < lineCenters.length - 1
          ? lineCenters[rowIndex + 1]
          : center + 10;
      const rowTop = (prevCenter + center) / 2;
      const rowBottom = (center + nextCenter) / 2;
      return { rowTop, rowBottom };
    };

    const sellerSkuColumnRange = columnXRanges.find(
      (c) => c.key === 'seller'
    );
    const myntraSkuColumnRange = columnXRanges.find(
      (c) => c.key === 'myntra'
    );
    const qtyColumnRange = columnXRanges.find((c) => c.key === 'qty');
    const descriptionColumnRange = columnXRanges.find(
      (c) => c.key === 'description'
    );

    (myntraDebug as any).sellerSkuColumnRange = sellerSkuColumnRange;
    (myntraDebug as any).qtyColumnRange = qtyColumnRange;
    (myntraDebug as any).descriptionColumnRange = descriptionColumnRange;

    type TextItem = (typeof text_items)[number];
    const yTolerance = 2;

    const buildCellTokens = (
      rowIndex: number,
      colRange?: { minX: number; maxX: number }
    ): TextItem[] => {
      if (!colRange) return [];
      const { rowTop, rowBottom } = getRowBounds(rowIndex);
      const wrapTolerance = 14; // allow a bit of vertical wrapping below the row

      const inColumn = (item: TextItem) =>
        item.x >= colRange.minX && item.x <= colRange.maxX;

      // Tokens within the main row band
      const rowItems = text_items.filter(
        (item) =>
          item.y >= rowTop - yTolerance &&
          item.y <= rowBottom + yTolerance &&
          inColumn(item)
      );

      // Additional tokens slightly below the row (wrapped cell content)
      const maxRowY = rowItems.reduce(
        (max, item) => (item.y > max ? item.y : max),
        rowBottom
      );

      const wrappedItems = text_items.filter(
        (item) =>
          inColumn(item) &&
          item.y > rowBottom + yTolerance &&
          item.y <= maxRowY + wrapTolerance
      );

      const all = [...rowItems, ...wrappedItems];

      // Sort by visual reading order (top-to-bottom, then left-to-right)
      return all.sort((a, b) =>
        a.y === b.y ? a.x - b.x : a.y - b.y
      );
    };

    const assembleCodeCellText = (tokens: TextItem[]): string => {
      if (!tokens.length) return '';
      const raw = tokens
        .map((t) => t.str ?? '')
        .join('')
        .replace(/\s+/g, '')
        .replace(/[|,]+/g, '')
        .trim();
      return raw;
    };

    const assembleDescriptionCellText = (tokens: TextItem[]): string => {
      if (!tokens.length) return '';
      const raw = tokens
        .map((t) => t.str ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      return raw;
    };

    // Parse each data row strictly by columns using assembled cells
    for (let i = headerRowIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.length === 0) continue;

      const lineText = line.map((item) => item.str).join(' ').trim();
      if (!lineText) continue;

      let myntraSku = '';
      let sellerSku = '';
      let quantity = 1;
      let qty_source: ParsedPicklistRow['qty_source'] = 'guessed';

      if (!myntraSku && myntraSkuColumnRange) {
        // When we have a detected Myntra SKU column, treat rows without a
        // Myntra SKU as wrapped continuation lines (already captured via
        // buildCellTokens) and skip creating a separate row here.
        continue;
      }

      // Seller SKU from STRICT Seller Sku Code column only
      const sellerSkuTokens = buildCellTokens(i, sellerSkuColumnRange);
      const sellerSkuAssembledRaw = assembleCodeCellText(sellerSkuTokens);
      const sellerSkuCandidate = sellerSkuAssembledRaw.toUpperCase();
      const SELLER_SKU_RE = /^[A-Z0-9\-]{6,}$/;
      if (sellerSkuCandidate && SELLER_SKU_RE.test(sellerSkuCandidate)) {
        sellerSku = sellerSkuCandidate;
      } else {
        sellerSku = '';
      }

      // Quantity from Qty/Quantity column only
      const qtyTokens = buildCellTokens(i, qtyColumnRange);
      const qtyText = assembleCodeCellText(qtyTokens);
      if (qtyText) {
        const match = qtyText.match(/\d+/);
        if (match) {
          const qtyVal = parseInt(match[0], 10);
          if (Number.isFinite(qtyVal) && qtyVal > 0) {
            quantity = qtyVal;
            qty_source = 'column';
          }
        }
      }

      // Product description strictly from Product Description column
      const descTokens = buildCellTokens(i, descriptionColumnRange);
      const productDescription = assembleDescriptionCellText(descTokens) || lineText;

      rows.push({
        myntra_sku: myntraSku,
        seller_sku: sellerSku,
        product_description: productDescription,
        quantity,
        qty_source,
        raw_line: lineText,
        source: 'pdf.js',
        page_number,
        column_indices: {
          myntra_sku_x: myntraSkuX,
          seller_sku_x: sellerSkuX,
          quantity_x: qtyX,
        },
        seller_sku_raw_tokens: sellerSkuTokens.map((t) => ({
          str: t.str,
          x: t.x,
          y: t.y,
        })),
        seller_sku_assembled: sellerSkuCandidate,
      });
    }

    (parsedPage as any).myntra_debug = myntraDebug;
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
