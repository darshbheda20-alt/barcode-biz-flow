import { PDFDocument } from 'pdf-lib';

export interface CropResult {
  labelPdf: Uint8Array;
  invoicePdf: Uint8Array;
  pageNumber: number;
}

/**
 * Crops Flipkart PDF pages into separate label and invoice PDFs.
 * - Label: Top ~55% of page (above dashed line) - original scale, clipped
 * - Invoice: Bottom ~45% of page (below dashed line) - original scale, clipped
 * 
 * Uses embedPage with bounding box to actually clip content (not just hide it).
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
    const labelHeight = height - splitY;
    const invoiceHeight = splitY;

    // ===== CREATE LABEL PDF (top portion) =====
    const labelDoc = await PDFDocument.create();
    // Embed only the top portion with bounding box - this actually clips the content
    const labelEmbedded = await labelDoc.embedPage(page, {
      left: 0,
      bottom: splitY,
      right: width,
      top: height
    });
    // Create page with exact size of the cropped region
    const labelPage = labelDoc.addPage([width, labelHeight]);
    // Draw at origin, at original size (no scaling)
    labelPage.drawPage(labelEmbedded, {
      x: 0,
      y: 0,
      width: width,
      height: labelHeight
    });

    // ===== CREATE INVOICE PDF (bottom portion) =====
    const invoiceDoc = await PDFDocument.create();
    // Embed only the bottom portion with bounding box
    const invoiceEmbedded = await invoiceDoc.embedPage(page, {
      left: 0,
      bottom: 0,
      right: width,
      top: splitY
    });
    // Create page with exact size of the cropped region
    const invoicePage = invoiceDoc.addPage([width, invoiceHeight]);
    // Draw at origin, at original size (no scaling)
    invoicePage.drawPage(invoiceEmbedded, {
      x: 0,
      y: 0,
      width: width,
      height: invoiceHeight
    });

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
