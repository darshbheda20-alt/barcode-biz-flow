import { PDFDocument } from 'pdf-lib';

export interface CropResult {
  labelPdf: Uint8Array;
  invoicePdf: Uint8Array;
  pageNumber: number;
}

/**
 * Crops Flipkart PDF pages into separate label and invoice PDFs.
 * - Label: Top ~55% of page (above dashed line) - kept at original scale
 * - Invoice: Bottom ~45% of page (below dashed line) - kept at original scale
 * 
 * Uses MediaBox/CropBox to define visible area without scaling content.
 */
export async function cropFlipkartPdf(pdfBytes: Uint8Array): Promise<CropResult[]> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const results: CropResult[] = [];

  for (let i = 0; i < pdfDoc.getPageCount(); i++) {
    const page = pdfDoc.getPage(i);
    const { width, height } = page.getSize();

    // Flipkart PDF layout: Label is top ~55%, Invoice is bottom ~45%
    // The dashed line separator is approximately at 45% from the bottom
    const splitY = height * 0.45;

    // ===== CREATE LABEL PDF (top portion) =====
    const labelDoc = await PDFDocument.create();
    const [labelPage] = await labelDoc.copyPages(pdfDoc, [i]);
    
    // Crop to show only top portion: from splitY to height
    // MediaBox format: (x, y, width, height) where y is from bottom of original
    const labelCropHeight = height - splitY;
    labelPage.setMediaBox(0, splitY, width, labelCropHeight);
    labelPage.setCropBox(0, splitY, width, labelCropHeight);
    labelDoc.addPage(labelPage);

    // ===== CREATE INVOICE PDF (bottom portion) =====
    const invoiceDoc = await PDFDocument.create();
    const [invoicePage] = await invoiceDoc.copyPages(pdfDoc, [i]);
    
    // Crop to show only bottom portion: from 0 to splitY
    invoicePage.setMediaBox(0, 0, width, splitY);
    invoicePage.setCropBox(0, 0, width, splitY);
    invoiceDoc.addPage(invoicePage);

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
  return `${bucket}/${fileName}`;
}
