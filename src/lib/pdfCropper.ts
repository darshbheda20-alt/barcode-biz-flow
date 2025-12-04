import { PDFDocument, degrees } from 'pdf-lib';

export interface CropResult {
  labelPdf: Uint8Array;
  invoicePdf: Uint8Array;
  pageNumber: number;
}

// 4x6 inches in PDF points (72 DPI)
const FOUR_INCHES = 288;
const SIX_INCHES = 432;

/**
 * Crops Flipkart PDF pages into separate label and invoice PDFs.
 * - Label: 4x6 inches PORTRAIT (288 x 432 points)
 * - Invoice: 4x6 inches LANDSCAPE (432 x 288 points)
 */
export async function cropFlipkartPdf(pdfBytes: Uint8Array): Promise<CropResult[]> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const results: CropResult[] = [];

  for (let i = 0; i < pdfDoc.getPageCount(); i++) {
    const page = pdfDoc.getPage(i);
    const { width, height } = page.getSize();

    // Flipkart PDF layout:
    // - Top portion (~60%): Shipping Label
    // - Bottom portion (~40%): Tax Invoice
    const splitRatio = 0.40;
    const splitY = height * splitRatio;

    // ===== CREATE LABEL PDF (4x6 Portrait) =====
    const labelDoc = await PDFDocument.create();
    const [copiedLabelPage] = await labelDoc.copyPages(pdfDoc, [i]);
    
    // Crop to top 60% (label area)
    const labelHeight = height - splitY;
    copiedLabelPage.setMediaBox(0, splitY, width, labelHeight);
    copiedLabelPage.setCropBox(0, splitY, width, labelHeight);
    
    // Scale to fit 4x6 portrait
    const labelScaleX = FOUR_INCHES / width;
    const labelScaleY = SIX_INCHES / labelHeight;
    const labelScale = Math.min(labelScaleX, labelScaleY);
    
    // Set final size to 4x6 portrait
    copiedLabelPage.setSize(FOUR_INCHES, SIX_INCHES);
    copiedLabelPage.setMediaBox(0, 0, FOUR_INCHES, SIX_INCHES);
    copiedLabelPage.setCropBox(0, 0, FOUR_INCHES, SIX_INCHES);
    
    // Scale and center the content
    copiedLabelPage.scaleContent(labelScale, labelScale);
    const labelOffsetX = (FOUR_INCHES - width * labelScale) / 2;
    const labelOffsetY = (SIX_INCHES - labelHeight * labelScale) / 2 - splitY * labelScale;
    copiedLabelPage.translateContent(labelOffsetX, labelOffsetY);
    
    labelDoc.addPage(copiedLabelPage);

    // ===== CREATE INVOICE PDF (4x6 Landscape = 6x4) =====
    const invoiceDoc = await PDFDocument.create();
    const [copiedInvoicePage] = await invoiceDoc.copyPages(pdfDoc, [i]);
    
    // Crop to bottom 40% (invoice area)
    const invoiceHeight = splitY;
    copiedInvoicePage.setMediaBox(0, 0, width, invoiceHeight);
    copiedInvoicePage.setCropBox(0, 0, width, invoiceHeight);
    
    // Scale to fit 6x4 landscape (width=6in, height=4in)
    const invoiceScaleX = SIX_INCHES / width;
    const invoiceScaleY = FOUR_INCHES / invoiceHeight;
    const invoiceScale = Math.min(invoiceScaleX, invoiceScaleY);
    
    // Set final size to 6x4 landscape
    copiedInvoicePage.setSize(SIX_INCHES, FOUR_INCHES);
    copiedInvoicePage.setMediaBox(0, 0, SIX_INCHES, FOUR_INCHES);
    copiedInvoicePage.setCropBox(0, 0, SIX_INCHES, FOUR_INCHES);
    
    // Scale and center the content
    copiedInvoicePage.scaleContent(invoiceScale, invoiceScale);
    const invoiceOffsetX = (SIX_INCHES - width * invoiceScale) / 2;
    const invoiceOffsetY = (FOUR_INCHES - invoiceHeight * invoiceScale) / 2;
    copiedInvoicePage.translateContent(invoiceOffsetX, invoiceOffsetY);
    
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
  return `${bucket}/${fileName}`;
}
