import { PDFDocument } from 'pdf-lib';

export interface CropResult {
  labelPdf: Uint8Array;
  invoicePdf: Uint8Array;
  pageNumber: number;
}

/**
 * Crops Flipkart PDF pages into separate label and invoice PDFs.
 * Flipkart layout: Label is in the upper ~60% of the page, Invoice is in the lower ~40%
 */
export async function cropFlipkartPdf(pdfBytes: Uint8Array): Promise<CropResult[]> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const results: CropResult[] = [];

  for (let i = 0; i < pdfDoc.getPageCount(); i++) {
    const page = pdfDoc.getPage(i);
    const { width, height } = page.getSize();

    // Flipkart PDF layout analysis:
    // - Top portion (~60%): Shipping Label with QR code, address, barcode
    // - Bottom portion (~40%): Tax Invoice with product details
    // The dashed line separates them at approximately 40% from the bottom
    
    const splitRatio = 0.40; // Invoice takes bottom 40%, Label takes top 60%
    const splitY = height * splitRatio;

    // Create label PDF (top 60% of the page)
    const labelDoc = await PDFDocument.create();
    const [copiedLabelPage] = await labelDoc.copyPages(pdfDoc, [i]);
    
    // MediaBox format: [x, y, width, height] where (x,y) is bottom-left corner
    // For label: crop from splitY to top of page
    copiedLabelPage.setMediaBox(0, splitY, width, height - splitY);
    copiedLabelPage.setCropBox(0, splitY, width, height - splitY);
    copiedLabelPage.setTrimBox(0, splitY, width, height - splitY);
    labelDoc.addPage(copiedLabelPage);

    // Create invoice PDF (bottom 40% of the page)
    const invoiceDoc = await PDFDocument.create();
    const [copiedInvoicePage] = await invoiceDoc.copyPages(pdfDoc, [i]);
    
    // For invoice: crop from bottom to splitY
    copiedInvoicePage.setMediaBox(0, 0, width, splitY);
    copiedInvoicePage.setCropBox(0, 0, width, splitY);
    copiedInvoicePage.setTrimBox(0, 0, width, splitY);
    invoiceDoc.addPage(copiedInvoicePage);

    const labelPdf = await labelDoc.save();
    const invoicePdf = await invoiceDoc.save();

    results.push({
      labelPdf,
      invoicePdf,
      pageNumber: i + 1
    });
  }

  return results;
}

/**
 * Creates a combined PDF with all labels from multiple pages
 */
export async function combineLabels(cropResults: CropResult[]): Promise<Uint8Array> {
  const combinedDoc = await PDFDocument.create();
  
  for (const result of cropResults) {
    const labelDoc = await PDFDocument.load(result.labelPdf);
    const [page] = await combinedDoc.copyPages(labelDoc, [0]);
    combinedDoc.addPage(page);
  }
  
  return combinedDoc.save();
}

/**
 * Creates a combined PDF with all invoices from multiple pages
 */
export async function combineInvoices(cropResults: CropResult[]): Promise<Uint8Array> {
  const combinedDoc = await PDFDocument.create();
  
  for (const result of cropResults) {
    const invoiceDoc = await PDFDocument.load(result.invoicePdf);
    const [page] = await combinedDoc.copyPages(invoiceDoc, [0]);
    combinedDoc.addPage(page);
  }
  
  return combinedDoc.save();
}

export async function uploadCroppedPdf(
  pdfBytes: Uint8Array,
  fileName: string,
  bucket: string = 'order-documents'
): Promise<string> {
  // This would upload to Supabase storage
  // For now, return a placeholder path
  return `${bucket}/${fileName}`;
}
