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
 * Detect column headers and map column indices
 */
export const detectColumnHeaders = (
  lines: TextItem[][],
  headerKeywords: string[]
): Map<string, number> => {
  const columnMap = new Map<string, number>();
  
  // Find header row (first few lines that contain header keywords)
  for (let lineIdx = 0; lineIdx < Math.min(5, lines.length); lineIdx++) {
    const line = lines[lineIdx];
    const lineText = line.map(item => item.str).join(' ').toLowerCase();
    
    // Check if this line contains header keywords
    const hasHeaders = headerKeywords.some(keyword => 
      lineText.includes(keyword.toLowerCase())
    );
    
    if (hasHeaders) {
      // Sort line items by x-coordinate to get column order
      const sortedByX = [...line].sort((a, b) => a.x - b.x);
      
      // Map each header keyword to its column index
      headerKeywords.forEach(keyword => {
        const keywordLower = keyword.toLowerCase();
        const columnIdx = sortedByX.findIndex(item => 
          item.str.toLowerCase().includes(keywordLower) ||
          lineText.includes(keywordLower)
        );
        
        if (columnIdx >= 0) {
          columnMap.set(keyword, sortedByX[columnIdx].x);
        }
      });
      
      break;
    }
  }
  
  return columnMap;
};

/**
 * Extract column value from a line based on x-coordinate
 */
export const extractColumnValue = (
  line: TextItem[],
  targetX: number,
  xTolerance = 30
): string => {
  const sortedByX = [...line].sort((a, b) => a.x - b.x);
  
  // Find items near the target x coordinate
  const columnItems = sortedByX.filter(item => 
    Math.abs(item.x - targetX) <= xTolerance
  );
  
  if (columnItems.length > 0) {
    return columnItems.map(item => item.str).join(' ').trim();
  }
  
  // Fallback: find the closest item
  let closest = sortedByX[0];
  let minDist = Math.abs(sortedByX[0].x - targetX);
  
  for (const item of sortedByX) {
    const dist = Math.abs(item.x - targetX);
    if (dist < minDist) {
      minDist = dist;
      closest = item;
    }
  }
  
  return closest?.str.trim() || '';
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

export interface QuantityResult {
  qty: number;
  source: 'label' | 'column' | 'proximity' | 'ocr' | 'guessed';
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Extract quantity from positional text items (preferred method)
 */
export const extractQuantityFromItems = (
  items: TextItem[],
  targetY: number,
  yTolerance = 5
): QuantityResult => {
  // Find items on the same line (same Y coordinate)
  const lineItems = items.filter(item => Math.abs(item.y - targetY) <= yTolerance);
  
  // Pattern 1: Explicit Qty label on the same line
  const qtyPatterns = [
    /\bQty[:\s]*([0-9]+)\b/i,
    /\bQuantity[:\s]*([0-9]+)\b/i,
    /\b(\d+)\s+Unit\b/i
  ];
  
  for (const item of lineItems) {
    for (const pattern of qtyPatterns) {
      const match = item.str.match(pattern);
      if (match) {
        return {
          qty: parseInt(match[1]),
          source: 'label',
          confidence: 'high'
        };
      }
    }
  }
  
  // Pattern 2: Column detection - find qty column by x clustering
  // Group all numbers by their x position to find qty column
  const numberItems = items
    .filter(item => /^\d{1,2}$/.test(item.str.trim()))
    .map(item => ({
      ...item,
      value: parseInt(item.str.trim())
    }))
    .filter(item => item.value > 0 && item.value < 100);
  
  if (numberItems.length > 0) {
    // Cluster by x coordinate to find qty column
    const xClusters = new Map<number, typeof numberItems>();
    const xTolerance = 20;
    
    for (const numItem of numberItems) {
      let foundCluster = false;
      for (const [clusterX, cluster] of xClusters.entries()) {
        if (Math.abs(numItem.x - clusterX) <= xTolerance) {
          cluster.push(numItem);
          foundCluster = true;
          break;
        }
      }
      if (!foundCluster) {
        xClusters.set(numItem.x, [numItem]);
      }
    }
    
    // Find the cluster with most items (likely qty column)
    let largestCluster: typeof numberItems = [];
    let largestClusterX = 0;
    for (const [clusterX, cluster] of xClusters.entries()) {
      if (cluster.length > largestCluster.length) {
        largestCluster = cluster;
        largestClusterX = clusterX;
      }
    }
    
    // Find number in this column on target line
    const qtyOnLine = largestCluster.find(item => 
      Math.abs(item.y - targetY) <= yTolerance
    );
    
    if (qtyOnLine) {
      return {
        qty: qtyOnLine.value,
        source: 'column',
        confidence: 'high'
      };
    }
  }
  
  // Pattern 3: Fallback to proximity (last resort, low confidence)
  const numbersOnLine = lineItems
    .filter(item => /^\d{1,2}$/.test(item.str.trim()))
    .map(item => parseInt(item.str.trim()))
    .filter(num => num > 0 && num < 100);
  
  if (numbersOnLine.length > 0) {
    return {
      qty: numbersOnLine[numbersOnLine.length - 1],
      source: 'proximity',
      confidence: 'low'
    };
  }
  
  // Default: guess 1
  return {
    qty: 1,
    source: 'guessed',
    confidence: 'low'
  };
};

/**
 * Extract quantity from text (fallback when text_items not available)
 */
export const extractQuantity = (text: string): QuantityResult => {
  // Pattern 1: Explicit "Qty: 5" or "Quantity: 5"
  const qtyPatterns = [
    /\bQty[:\s]*([0-9]+)\b/i,
    /\bQuantity[:\s]*([0-9]+)\b/i,
    /\b(\d+)\s+Unit\b/i
  ];
  
  for (const pattern of qtyPatterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        qty: parseInt(match[1]),
        source: 'label',
        confidence: 'high'
      };
    }
  }
  
  // Pattern 2: Look for standalone small integers (strict)
  const numbersPattern = /\b(\d{1,2})\b/g;
  const numbers: number[] = [];
  let match;
  while ((match = numbersPattern.exec(text)) !== null) {
    const num = parseInt(match[1]);
    if (num > 0 && num < 100) {
      numbers.push(num);
    }
  }
  
  // Only use proximity if we have very few candidates
  if (numbers.length === 1) {
    return {
      qty: numbers[0],
      source: 'proximity',
      confidence: 'medium'
    };
  }
  
  // Default: guess 1 and flag for review
  return {
    qty: 1,
    source: 'guessed',
    confidence: 'low'
  };
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
