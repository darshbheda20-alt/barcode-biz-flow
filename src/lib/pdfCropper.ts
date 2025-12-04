import { PDFDocument } from 'pdf-lib';

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
 * - Label: 4x6 inches PORTRAIT (288 x 432 points) - crops top portion above dashed line
 * - Invoice: 6x4 inches LANDSCAPE (432 x 288 points) - crops bottom portion below dashed line
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

    // ===== CREATE LABEL PDF (4x6 Portrait) =====
    const labelDoc = await PDFDocument.create();
    
    // Embed only the TOP portion of the page (label area)
    // Bounding box: left, bottom, right, top (from the original page)
    const labelEmbedded = await labelDoc.embedPage(page, {
      left: 0,
      bottom: splitY,  // Start from the split line
      right: width,
      top: height      // Go to the top
    });
    
    // Create a 4x6 portrait page
    const labelPage = labelDoc.addPage([FOUR_INCHES, SIX_INCHES]);
    
    // Calculate scaling to fit the cropped content into 4x6
    const labelCropHeight = height - splitY;
    const labelScaleX = FOUR_INCHES / width;
    const labelScaleY = SIX_INCHES / labelCropHeight;
    const labelScale = Math.min(labelScaleX, labelScaleY);
    
    // Center the content
    const labelDrawWidth = width * labelScale;
    const labelDrawHeight = labelCropHeight * labelScale;
    const labelOffsetX = (FOUR_INCHES - labelDrawWidth) / 2;
    const labelOffsetY = (SIX_INCHES - labelDrawHeight) / 2;
    
    labelPage.drawPage(labelEmbedded, {
      x: labelOffsetX,
      y: labelOffsetY,
      width: labelDrawWidth,
      height: labelDrawHeight
    });

    // ===== CREATE INVOICE PDF (6x4 Landscape) =====
    const invoiceDoc = await PDFDocument.create();
    
    // Embed only the BOTTOM portion of the page (invoice area)
    const invoiceEmbedded = await invoiceDoc.embedPage(page, {
      left: 0,
      bottom: 0,       // Start from the bottom
      right: width,
      top: splitY      // Go up to the split line
    });
    
    // Create a 6x4 landscape page
    const invoicePage = invoiceDoc.addPage([SIX_INCHES, FOUR_INCHES]);
    
    // Calculate scaling to fit the cropped content into 6x4
    const invoiceScaleX = SIX_INCHES / width;
    const invoiceScaleY = FOUR_INCHES / splitY;
    const invoiceScale = Math.min(invoiceScaleX, invoiceScaleY);
    
    // Center the content
    const invoiceDrawWidth = width * invoiceScale;
    const invoiceDrawHeight = splitY * invoiceScale;
    const invoiceOffsetX = (SIX_INCHES - invoiceDrawWidth) / 2;
    const invoiceOffsetY = (FOUR_INCHES - invoiceDrawHeight) / 2;
    
    invoicePage.drawPage(invoiceEmbedded, {
      x: invoiceOffsetX,
      y: invoiceOffsetY,
      width: invoiceDrawWidth,
      height: invoiceDrawHeight
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
