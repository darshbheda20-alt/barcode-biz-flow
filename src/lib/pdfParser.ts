/**
 * Robust PDF parsing utilities with positional text extraction
 * and layout-agnostic heuristics for marketplace order documents
 */

export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ParsedPage {
  page_number: number;
  raw_text: string;
  text_items?: TextItem[];
  ocr_text?: string;
  parsed_lines: any[];
}

/**
 * Extract text from PDF with positional information preserved
 */
export const extractTextWithPositions = async (
  page: any
): Promise<{ raw_text: string; text_items: TextItem[] }> => {
  const textContent = await page.getTextContent();
  const textItems: TextItem[] = [];
  const rawTextParts: string[] = [];

  for (const item of textContent.items) {
    if ('str' in item && item.str) {
      rawTextParts.push(item.str);
      
      // Extract positional info
      const transform = item.transform || [1, 0, 0, 1, 0, 0];
      textItems.push({
        str: item.str,
        x: transform[4] || 0,
        y: transform[5] || 0,
        width: item.width || 0,
        height: item.height || 0,
      });
    }
  }

  return {
    raw_text: rawTextParts.join(' '),
    text_items: textItems,
  };
};

/**
 * Group text items into lines based on Y coordinate
 */
export const groupIntoLines = (items: TextItem[], yTolerance = 5): TextItem[][] => {
  const lines: TextItem[][] = [];
  const sorted = [...items].sort((a, b) => b.y - a.y); // Top to bottom

  for (const item of sorted) {
    let addedToLine = false;
    for (const line of lines) {
      if (line.length > 0 && Math.abs(line[0].y - item.y) <= yTolerance) {
        line.push(item);
        addedToLine = true;
        break;
      }
    }
    if (!addedToLine) {
      lines.push([item]);
    }
  }

  // Sort items within each line by X coordinate (left to right)
  return lines.map(line => line.sort((a, b) => a.x - b.x));
};

/**
 * Group text items into columns based on X coordinate
 */
export const groupIntoColumns = (items: TextItem[], xTolerance = 20): TextItem[][] => {
  const columns: TextItem[][] = [];
  const sorted = [...items].sort((a, b) => a.x - b.x); // Left to right

  for (const item of sorted) {
    let addedToColumn = false;
    for (const column of columns) {
      if (column.length > 0 && Math.abs(column[0].x - item.x) <= xTolerance) {
        column.push(item);
        addedToColumn = true;
        break;
      }
    }
    if (!addedToColumn) {
      columns.push([item]);
    }
  }

  // Sort items within each column by Y coordinate (top to bottom)
  return columns.map(col => col.sort((a, b) => b.y - a.y));
};

/**
 * Find ASIN patterns in text
 */
export const findASINs = (text: string): string[] => {
  const asinPattern = /\bB0[A-Z0-9]{8}\b/g;
  const matches = text.match(asinPattern);
  return matches ? [...new Set(matches)] : [];
};

/**
 * Find seller SKU patterns (common formats)
 */
export const findSellerSKUs = (text: string): Array<{ sku: string; index: number }> => {
  const results: Array<{ sku: string; index: number }> = [];
  
  // Pattern 1: SKU in parentheses like ( LGO-TP2023-BLK-L )
  const parenthesesPattern = /\(\s*([A-Z0-9][A-Z0-9\-_]{4,})\s*\)/gi;
  let match;
  while ((match = parenthesesPattern.exec(text)) !== null) {
    results.push({ sku: match[1].trim(), index: match.index });
  }
  
  // Pattern 2: Standalone SKU-like tokens (uppercase with dashes/underscores)
  const standalonePattern = /\b([A-Z][A-Z0-9\-_]{5,})\b/g;
  while ((match = standalonePattern.exec(text)) !== null) {
    const sku = match[1].trim();
    // Avoid false positives (common words)
    if (!['INVOICE', 'NUMBER', 'ORDER', 'TOTAL', 'CUSTOMER'].includes(sku)) {
      results.push({ sku, index: match.index });
    }
  }
  
  return results;
};

/**
 * Extract context around a match index
 */
export const extractContextAroundIndex = (
  text: string,
  index: number,
  wordsBefore = 8,
  wordsAfter = 8
): string => {
  const words = text.split(/\s+/);
  const charToWordIndex = new Map<number, number>();
  
  let charPos = 0;
  words.forEach((word, idx) => {
    charToWordIndex.set(charPos, idx);
    charPos += word.length + 1; // +1 for space
  });
  
  // Find word index closest to the match index
  let wordIndex = 0;
  let minDist = Infinity;
  charToWordIndex.forEach((wIdx, cPos) => {
    const dist = Math.abs(cPos - index);
    if (dist < minDist) {
      minDist = dist;
      wordIndex = wIdx;
    }
  });
  
  const start = Math.max(0, wordIndex - wordsBefore);
  const end = Math.min(words.length, wordIndex + wordsAfter + 1);
  
  return words.slice(start, end).join(' ');
};

/**
 * Extract quantity from a text snippet
 */
export const extractQuantity = (text: string): number => {
  // Pattern 1: Explicit "Qty: 5" or "Quantity: 5"
  const explicitQtyPattern = /(?:Qty|Quantity)[:\s]*(\d+)/i;
  const explicitMatch = text.match(explicitQtyPattern);
  if (explicitMatch) {
    return parseInt(explicitMatch[1]);
  }
  
  // Pattern 2: Look for standalone small integers (1-99) near end of text
  const numbersPattern = /\b(\d{1,2})\b/g;
  const numbers: number[] = [];
  let match;
  while ((match = numbersPattern.exec(text)) !== null) {
    const num = parseInt(match[1]);
    if (num > 0 && num < 100) {
      numbers.push(num);
    }
  }
  
  // Return the last small number found (likely to be quantity)
  return numbers.length > 0 ? numbers[numbers.length - 1] : 1;
};

/**
 * Extract Amazon order ID
 */
export const extractAmazonOrderId = (text: string): string | null => {
  const patterns = [
    /Order\s*(?:Number|ID)[:\s]*([\d\-]{15,})/i,
    /(\d{3}-\d{7}-\d{7})/
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  
  return null;
};

/**
 * Detect if OCR is needed (no ASIN/SKU candidates found in pdf.js text)
 */
export const needsOCR = (text: string): boolean => {
  const hasASIN = findASINs(text).length > 0;
  const hasSKU = findSellerSKUs(text).length > 0;
  const hasQty = /(?:Qty|Quantity)/i.test(text);
  
  return !hasASIN && !hasSKU && !hasQty;
};
