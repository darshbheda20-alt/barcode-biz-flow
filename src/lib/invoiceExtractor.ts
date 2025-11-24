import { TextItem } from "./pdfParser";

export interface InvoiceFields {
  invoice_no: string | null;
  invoice_date: string | null;
  order_id: string | null;
  gstin: string | null;
  bill_to: string | null;
  ship_to: string | null;
  seller_name: string | null;
  subtotal: number | null;
  total_tax: number | null;
  grand_total: number | null;
  total_taxable_value: number | null;
  item_rows: ItemRow[];
  invoice_detected: boolean;
  ocr_used: boolean;
  parsing_notes: string[];
}

export interface ItemRow {
  description: string;
  hsn: string | null;
  qty: number;
  rate: number | null;
  taxable_value: number | null;
  gst_percent: number | null;
  gst_amount: number | null;
  line_total: number | null;
  source: 'pdf.js' | 'ocr';
  cell_tokens: string[];
}

interface FieldExtraction {
  value: string | number | null;
  source: 'pdf.js' | 'ocr' | 'fallback';
  confidence: 'high' | 'medium' | 'low';
  tokensUsed: string[];
}

// Group text items into lines based on Y coordinate
function groupIntoLines(items: TextItem[], yTolerance = 5): TextItem[][] {
  const lines: { y: number; items: TextItem[] }[] = [];
  
  for (const item of items) {
    const existingLine = lines.find(line => Math.abs(line.y - item.y) < yTolerance);
    if (existingLine) {
      existingLine.items.push(item);
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }
  
  // Sort lines top to bottom
  lines.sort((a, b) => b.y - a.y);
  
  // Sort items within each line left to right
  lines.forEach(line => line.items.sort((a, b) => a.x - b.x));
  
  return lines.map(l => l.items);
}

// Detect if page contains invoice content
export function detectInvoiceLabels(text_items: TextItem[]): boolean {
  const allText = text_items.map(item => item.str.toLowerCase()).join(' ');
  const invoiceKeywords = [
    'tax invoice', 'invoice no', 'invoice', 'bill to', 'ship to',
    'gstin', 'subtotal', 'total', 'grand total', 'gst amount',
    'taxable value', 'hsn'
  ];
  
  return invoiceKeywords.some(keyword => allText.includes(keyword));
}

// Extract invoice number from text items
function extractInvoiceNumber(text_items: TextItem[], rawText: string): FieldExtraction {
  const patterns = [
    /Invoice\s*No[:\s]*([A-Z0-9\-\/]+)/i,
    /Invoice\s*Number[:\s]*([A-Z0-9\-\/]+)/i,
    /Invoice[:\s]*([A-Z0-9\-\/]{6,})/i,
    /Tax\s*Invoice[:\s]*([A-Z0-9\-\/]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = rawText.match(pattern);
    if (match) {
      return {
        value: match[1].trim(),
        source: 'pdf.js',
        confidence: 'high',
        tokensUsed: [match[0]]
      };
    }
  }
  
  return {
    value: null,
    source: 'fallback',
    confidence: 'low',
    tokensUsed: []
  };
}

// Extract invoice date
function extractInvoiceDate(text_items: TextItem[], rawText: string): FieldExtraction {
  const patterns = [
    /Invoice\s*Date[:\s]*(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/i,
    /Date[:\s]*(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/i,
    /(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/
  ];
  
  for (const pattern of patterns) {
    const match = rawText.match(pattern);
    if (match) {
      const dateStr = match[1];
      // Normalize to YYYY-MM-DD
      const parts = dateStr.split(/[-\/]/);
      let normalized = dateStr;
      if (parts.length === 3 && parts[2].length === 4) {
        // DD-MM-YYYY or DD/MM/YYYY
        normalized = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }
      return {
        value: normalized,
        source: 'pdf.js',
        confidence: 'high',
        tokensUsed: [match[0]]
      };
    }
  }
  
  return {
    value: null,
    source: 'fallback',
    confidence: 'low',
    tokensUsed: []
  };
}

// Extract order ID
function extractOrderId(text_items: TextItem[], rawText: string): FieldExtraction {
  const patterns = [
    /Order\s*(?:ID|No|#)[:\s]*([A-Z0-9\-]{6,})/i,
    /Order[:\s]*([A-Z0-9\-]{10,})/i,
    /(?:AWB|Tracking)[:\s]*([A-Z0-9]{10,})/i
  ];
  
  for (const pattern of patterns) {
    const match = rawText.match(pattern);
    if (match) {
      return {
        value: match[1].trim(),
        source: 'pdf.js',
        confidence: 'high',
        tokensUsed: [match[0]]
      };
    }
  }
  
  return {
    value: null,
    source: 'fallback',
    confidence: 'low',
    tokensUsed: []
  };
}

// Extract GSTIN
function extractGSTIN(text_items: TextItem[], rawText: string): FieldExtraction {
  const pattern = /GSTIN[:\s]*([0-9A-Z]{15})/i;
  const match = rawText.match(pattern);
  
  if (match) {
    return {
      value: match[1],
      source: 'pdf.js',
      confidence: 'high',
      tokensUsed: [match[0]]
    };
  }
  
  // Try generic 15-char alphanumeric
  const genericPattern = /\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3})\b/;
  const genericMatch = rawText.match(genericPattern);
  if (genericMatch) {
    return {
      value: genericMatch[1],
      source: 'pdf.js',
      confidence: 'medium',
      tokensUsed: [genericMatch[0]]
    };
  }
  
  return {
    value: null,
    source: 'fallback',
    confidence: 'low',
    tokensUsed: []
  };
}

// Extract multiline address after a label
function extractMultilineAddress(lines: TextItem[][], labelPattern: RegExp, maxLines = 5): FieldExtraction {
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i].map(item => item.str).join(' ');
    if (labelPattern.test(lineText)) {
      const addressLines: string[] = [];
      for (let j = i; j < Math.min(i + maxLines, lines.length); j++) {
        const line = lines[j].map(item => item.str).join(' ').trim();
        if (line && !/Invoice|Date|GSTIN|Total|Subtotal/i.test(line)) {
          addressLines.push(line);
        }
      }
      return {
        value: addressLines.join(', '),
        source: 'pdf.js',
        confidence: 'medium',
        tokensUsed: addressLines
      };
    }
  }
  
  return {
    value: null,
    source: 'fallback',
    confidence: 'low',
    tokensUsed: []
  };
}

// Extract monetary value
function extractMoneyValue(text: string, label: string): FieldExtraction {
  const pattern = new RegExp(`${label}[:\\s]*₹?\\s*([0-9,]+\\.?\\d*)`, 'i');
  const match = text.match(pattern);
  
  if (match) {
    const valueStr = match[1].replace(/,/g, '');
    return {
      value: parseFloat(valueStr),
      source: 'pdf.js',
      confidence: 'high',
      tokensUsed: [match[0]]
    };
  }
  
  return {
    value: null,
    source: 'fallback',
    confidence: 'low',
    tokensUsed: []
  };
}

// Detect table header and compute column X-ranges
function detectTableColumns(lines: TextItem[][]): Map<string, { minX: number; maxX: number }> {
  const columnMap = new Map<string, { minX: number; maxX: number }>();
  
  for (const line of lines.slice(0, 20)) {
    const lineText = line.map(item => item.str).join(' ').toLowerCase();
    
    if (/description|product|item/i.test(lineText) || /hsn/i.test(lineText) || /qty/i.test(lineText)) {
      // Found header row
      for (const item of line) {
        const text = item.str.toLowerCase();
        const minX = item.x - 10;
        const maxX = item.x + item.width + 100;
        
        if (/description|product|item/i.test(text)) {
          columnMap.set('description', { minX, maxX });
        } else if (/hsn/i.test(text)) {
          columnMap.set('hsn', { minX, maxX });
        } else if (/qty|quantity/i.test(text)) {
          columnMap.set('qty', { minX, maxX });
        } else if (/rate|price|unit/i.test(text) && !/gst/i.test(text)) {
          columnMap.set('rate', { minX, maxX });
        } else if (/taxable.*value|value/i.test(text) && !/total/i.test(text)) {
          columnMap.set('taxable_value', { minX, maxX });
        } else if (/gst|tax/i.test(text) && /amount|value/i.test(text)) {
          columnMap.set('gst_amount', { minX, maxX });
        } else if (/total|amount/i.test(text)) {
          columnMap.set('total', { minX, maxX });
        }
      }
      break;
    }
  }
  
  return columnMap;
}

// Extract item rows from table
function extractItemRows(lines: TextItem[][], columnMap: Map<string, { minX: number; maxX: number }>): ItemRow[] {
  const items: ItemRow[] = [];
  let inTable = false;
  
  for (const line of lines) {
    const lineText = line.map(item => item.str).join(' ');
    
    // Start table after header
    if (/description|product|item/i.test(lineText) && /qty/i.test(lineText)) {
      inTable = true;
      continue;
    }
    
    // Stop at totals or footer
    if (/subtotal|total|grand total|tax total|terms|conditions/i.test(lineText)) {
      break;
    }
    
    if (!inTable) continue;
    
    // Skip obvious non-item rows
    if (/sr\.?\s*no|s\.?\s*no|^page|^continued/i.test(lineText)) continue;
    
    // Extract cells using column positions
    const row: Partial<ItemRow> = {
      description: '',
      hsn: null,
      qty: 0,
      rate: null,
      taxable_value: null,
      gst_percent: null,
      gst_amount: null,
      line_total: null,
      source: 'pdf.js',
      cell_tokens: []
    };
    
    for (const [col, range] of columnMap.entries()) {
      const cellItems = line.filter(item => item.x >= range.minX && item.x <= range.maxX);
      const cellText = cellItems.map(item => item.str).join(' ').trim();
      row.cell_tokens?.push(cellText);
      
      switch (col) {
        case 'description':
          row.description = cellText;
          break;
        case 'hsn':
          row.hsn = cellText || null;
          break;
        case 'qty':
          const qtyMatch = cellText.match(/\d+/);
          row.qty = qtyMatch ? parseInt(qtyMatch[0], 10) : 0;
          break;
        case 'rate':
          const rateMatch = cellText.match(/[\d,]+\.?\d*/);
          row.rate = rateMatch ? parseFloat(rateMatch[0].replace(/,/g, '')) : null;
          break;
        case 'taxable_value':
          const taxableMatch = cellText.match(/[\d,]+\.?\d*/);
          row.taxable_value = taxableMatch ? parseFloat(taxableMatch[0].replace(/,/g, '')) : null;
          break;
        case 'gst_amount':
          const gstMatch = cellText.match(/[\d,]+\.?\d*/);
          row.gst_amount = gstMatch ? parseFloat(gstMatch[0].replace(/,/g, '')) : null;
          break;
        case 'total':
          const totalMatch = cellText.match(/[\d,]+\.?\d*/);
          row.line_total = totalMatch ? parseFloat(totalMatch[0].replace(/,/g, '')) : null;
          break;
      }
    }
    
    // Only add if we have description and quantity
    if (row.description && row.qty && row.qty > 0) {
      items.push(row as ItemRow);
    }
  }
  
  return items;
}

// Main invoice extraction function
export function extractInvoiceFields(text_items: TextItem[], rawText: string): InvoiceFields {
  const invoice_detected = detectInvoiceLabels(text_items);
  const parsing_notes: string[] = [];
  
  if (!invoice_detected) {
    parsing_notes.push('No invoice labels detected - may not be an invoice page');
  }
  
  const lines = groupIntoLines(text_items);
  
  // Extract invoice-level fields
  const invoice_no = extractInvoiceNumber(text_items, rawText);
  const invoice_date = extractInvoiceDate(text_items, rawText);
  const order_id = extractOrderId(text_items, rawText);
  const gstin = extractGSTIN(text_items, rawText);
  const bill_to = extractMultilineAddress(lines, /bill\s*to/i);
  const ship_to = extractMultilineAddress(lines, /ship\s*to/i);
  
  // Extract totals
  const subtotal = extractMoneyValue(rawText, 'Subtotal');
  const total_tax = extractMoneyValue(rawText, '(?:Total\\s*)?(?:GST|Tax)(?:\\s*Amount)?');
  const grand_total = extractMoneyValue(rawText, 'Grand\\s*Total|Total\\s*Amount');
  const total_taxable_value = extractMoneyValue(rawText, 'Total\\s*Taxable\\s*Value');
  
  // Extract item rows
  const columnMap = detectTableColumns(lines);
  const item_rows = columnMap.size > 0 ? extractItemRows(lines, columnMap) : [];
  
  if (columnMap.size === 0) {
    parsing_notes.push('No table header detected - using heuristic item extraction');
  }
  
  if (item_rows.length === 0 && invoice_detected) {
    parsing_notes.push('Warning: Invoice detected but no item rows extracted');
  }
  
  // Confidence tracking
  if (invoice_no.confidence === 'low') parsing_notes.push('Low confidence in invoice number');
  if (grand_total.confidence === 'low') parsing_notes.push('Grand total not found');
  
  return {
    invoice_no: invoice_no.value as string | null,
    invoice_date: invoice_date.value as string | null,
    order_id: order_id.value as string | null,
    gstin: gstin.value as string | null,
    bill_to: bill_to.value as string | null,
    ship_to: ship_to.value as string | null,
    seller_name: null,
    subtotal: subtotal.value as number | null,
    total_tax: total_tax.value as number | null,
    grand_total: grand_total.value as number | null,
    total_taxable_value: total_taxable_value.value as number | null,
    item_rows,
    invoice_detected,
    ocr_used: false,
    parsing_notes
  };
}
