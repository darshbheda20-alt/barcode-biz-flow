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

interface ParsedPicklistRow {
  myntra_sku: string;
  seller_sku: string;
  product_description: string;
  quantity: number;
  raw_line: string;
}

interface MyntraUploadProps {
  onOrdersParsed: () => void;
}

export const MyntraUpload = ({ onOrdersParsed }: MyntraUploadProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ status: 'success' | 'error'; message: string } | null>(null);
  const [debugData, setDebugData] = useState<ParsedPicklistRow[] | null>(null);
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

  const parseMyntraPicklist = (text: string): ParsedPicklistRow[] => {
    console.log('=== PARSING MYNTRA PICKLIST ===');
    console.log('Text length:', text.length);

    const rows: ParsedPicklistRow[] = [];

    // Pattern to match table rows
    // Example: "LACAASHOR115953941 LC-WM-RC-SKIN-L Lady Care Women High-Rise Slim Fit Sports Shorts 1 N/A"
    const rowPattern = /([A-Z0-9]+)\s+([A-Z0-9\-]+)\s+(.+?)\s+(\d+)\s+(?:N\/A|[\d\/\-]+)/gi;

    let match;
    while ((match = rowPattern.exec(text)) !== null) {
      const myntra_sku = match[1].trim();
      const seller_sku = match[2].trim();
      const product_description = match[3].trim();
      const quantity = parseInt(match[4]);

      // Skip header row
      if (seller_sku === 'Code' || myntra_sku === 'Myntra') continue;

      rows.push({
        myntra_sku,
        seller_sku,
        product_description,
        quantity,
        raw_line: match[0]
      });

      console.log('Extracted Myntra product:', {
        myntra_sku,
        seller_sku,
        product_description,
        quantity
      });
    }

    return rows;
  };

  const mapSKUToMasterSKU = async (sku: string): Promise<string | null> => {
    console.log('Attempting exact match for Myntra SKU:', sku);

    // First, try to find in sku_aliases table (exact match only)
    const { data: aliasData, error: aliasError } = await supabase
      .from('sku_aliases')
      .select('product_id, products(master_sku)')
      .eq('marketplace', 'Myntra')
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
      
      // Extract text from PDF
      const text = await extractTextFromPDF(file);
      
      // Parse picklist rows
      const parsedRows = parseMyntraPicklist(text);

      if (parsedRows.length === 0) {
        setUploadStatus({
          status: 'error',
          message: 'No valid products found in picklist'
        });
        setUploading(false);
        return;
      }

      // Upload file to storage
      const uploadedFilePath = await uploadToStorage(file);
      console.log(`Uploaded to storage: ${uploadedFilePath}`);

      let newOrderCount = 0;
      let duplicateCount = 0;
      let unmappedCount = 0;

      // Process each parsed row
      for (const row of parsedRows) {
        try {
          // Map seller SKU to master SKU (exact match only)
          const masterSku = await mapSKUToMasterSKU(row.seller_sku);
          
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
            console.log(`Unmapped Myntra SKU detected: ${row.seller_sku}`);
          }

          // Generate a pseudo order ID for Myntra (using Myntra SKU)
          const orderId = `MYNTRA-${row.myntra_sku}`;

          // Check for duplicates
          const { data: existingOrder } = await supabase
            .from('process_orders')
            .select('id, workflow_status')
            .eq('order_id', orderId)
            .eq('marketplace_sku', row.seller_sku)
            .eq('platform', 'Myntra')
            .maybeSingle();

          if (existingOrder) {
            if (existingOrder.workflow_status === 'archived') {
              console.log(`Skipping archived order: ${orderId}`);
              duplicateCount++;
            }
            continue;
          }

          // Insert into process_orders
          const { error: insertError } = await supabase
            .from('process_orders')
            .insert({
              platform: 'Myntra',
              order_id: orderId,
              marketplace_sku: row.seller_sku,
              master_sku: masterSku || row.seller_sku, // Use seller SKU if unmapped
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
      setDebugData(parsedRows);

      // Trigger UI refresh
      onOrdersParsed();

      // Determine status message
      let statusMessage = '';
      if (newOrderCount > 0) {
        statusMessage = `Processed ${newOrderCount} item(s)`;
        if (unmappedCount > 0) {
          statusMessage += ` (${unmappedCount} unmapped SKU${unmappedCount > 1 ? 's' : ''} require mapping)`;
        }
        if (duplicateCount > 0) {
          statusMessage += `, ${duplicateCount} duplicate(s) skipped`;
        }
      } else if (duplicateCount > 0) {
        statusMessage = `All ${duplicateCount} item(s) were already processed and archived`;
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
          ? `${newOrderCount} item(s) processed. ${unmappedCount} unmapped SKU${unmappedCount > 1 ? 's' : ''} require${unmappedCount === 1 ? 's' : ''} mapping below.`
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
          Upload Myntra Picklist CSV
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
          <Button 
            onClick={downloadDebugJSON}
            variant="outline"
            size="sm"
          >
            <FileText className="mr-2 h-4 w-4" />
            Download Debug JSON
          </Button>
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
