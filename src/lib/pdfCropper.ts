import { PDFDocument } from 'pdf-lib';

export interface CropResult {
  labelPdf: Uint8Array;
  invoicePdf: Uint8Array;
}

export async function cropFlipkartPdf(pdfBytes: Uint8Array): Promise<CropResult[]> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const results: CropResult[] = [];

  for (let i = 0; i < pdfDoc.getPageCount(); i++) {
    const page = pdfDoc.getPage(i);
    const { width, height } = page.getSize();

    // Create label PDF (top half) - 4x6 inches
    const labelDoc = await PDFDocument.create();
    const [copiedLabelPage] = await labelDoc.copyPages(pdfDoc, [i]);
    
    // Crop to top half and resize to 4x6 (288x432 points)
    copiedLabelPage.setMediaBox(0, height / 2, width, height);
    copiedLabelPage.scale(288 / width, 432 / (height / 2));
    labelDoc.addPage(copiedLabelPage);

    // Create invoice PDF (bottom half) - 4x6 inches
    const invoiceDoc = await PDFDocument.create();
    const [copiedInvoicePage] = await invoiceDoc.copyPages(pdfDoc, [i]);
    
    // Crop to bottom half and resize to 4x6
    copiedInvoicePage.setMediaBox(0, 0, width, height / 2);
    copiedInvoicePage.scale(288 / width, 432 / (height / 2));
    invoiceDoc.addPage(copiedInvoicePage);

    const labelPdf = await labelDoc.save();
    const invoicePdf = await invoiceDoc.save();

    results.push({
      labelPdf,
      invoicePdf
    });
  }

  return results;
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
