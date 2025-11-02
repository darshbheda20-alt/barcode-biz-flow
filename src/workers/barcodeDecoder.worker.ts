import {
  MultiFormatReader,
  DecodeHintType,
  BarcodeFormat,
  RGBLuminanceSource,
  BinaryBitmap,
  HybridBinarizer,
} from '@zxing/library';

const hints = new Map();
const formats = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.QR_CODE,
];
hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
hints.set(DecodeHintType.TRY_HARDER, true);

const reader = new MultiFormatReader();
reader.setHints(hints);

// Image preprocessing functions
function grayscale(imageData: ImageData): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(imageData.width * imageData.height);
  const data = imageData.data;
  
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Weighted grayscale conversion
    gray[i / 4] = Math.floor(0.299 * r + 0.587 * g + 0.114 * b);
  }
  
  return gray;
}

function enhanceContrast(gray: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  // Simple contrast enhancement via histogram stretching
  let min = 255;
  let max = 0;
  
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] < min) min = gray[i];
    if (gray[i] > max) max = gray[i];
  }
  
  const range = max - min;
  if (range === 0) return gray;
  
  const enhanced = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i++) {
    enhanced[i] = Math.floor(((gray[i] - min) * 255) / range);
  }
  
  return enhanced;
}

function medianBlur(gray: Uint8ClampedArray, width: number, height: number, kernelSize: number = 3): Uint8ClampedArray {
  const blurred = new Uint8ClampedArray(gray.length);
  const offset = Math.floor(kernelSize / 2);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const neighbors: number[] = [];
      
      for (let ky = -offset; ky <= offset; ky++) {
        for (let kx = -offset; kx <= offset; kx++) {
          const ny = y + ky;
          const nx = x + kx;
          
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            neighbors.push(gray[ny * width + nx]);
          }
        }
      }
      
      neighbors.sort((a, b) => a - b);
      blurred[y * width + x] = neighbors[Math.floor(neighbors.length / 2)];
    }
  }
  
  return blurred;
}

function adaptiveThreshold(gray: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const output = new Uint8ClampedArray(gray.length);
  const blockSize = 15;
  const C = 10;
  const offset = Math.floor(blockSize / 2);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      
      for (let ky = -offset; ky <= offset; ky++) {
        for (let kx = -offset; kx <= offset; kx++) {
          const ny = y + ky;
          const nx = x + kx;
          
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            sum += gray[ny * width + nx];
            count++;
          }
        }
      }
      
      const mean = sum / count;
      const threshold = mean - C;
      const idx = y * width + x;
      output[idx] = gray[idx] > threshold ? 255 : 0;
    }
  }
  
  return output;
}

function preprocessImage(imageData: ImageData): Uint8ClampedArray[] {
  const { width, height } = imageData;
  
  // Convert to grayscale
  const gray = grayscale(imageData);
  
  // Enhance contrast
  const enhanced = enhanceContrast(gray, width, height);
  
  // Denoise
  const denoised = medianBlur(enhanced, width, height, 3);
  
  // Adaptive threshold
  const thresholded = adaptiveThreshold(denoised, width, height);
  
  return [denoised, thresholded];
}

function decodeFromGrayscale(gray: Uint8ClampedArray, width: number, height: number) {
  const luminanceSource = new RGBLuminanceSource(gray, width, height);
  const binaryBitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));
  
  try {
    const result = reader.decode(binaryBitmap);
    return result.getText();
  } catch (e) {
    return null;
  }
}

self.onmessage = (e: MessageEvent) => {
  const { imageData, rotation = 0 } = e.data;
  const startTime = performance.now();
  
  try {
    const { width, height } = imageData;
    
    // Try multiple preprocessing variations
    const [enhanced, thresholded] = preprocessImage(imageData);
    
    // Try enhanced version first
    let result = decodeFromGrayscale(enhanced, width, height);
    
    // Try thresholded version if enhanced failed
    if (!result) {
      result = decodeFromGrayscale(thresholded, width, height);
    }
    
    // Try with brightness adjustment if still failed
    if (!result && rotation < 2) {
      const brightened = new Uint8ClampedArray(enhanced.length);
      const factor = rotation === 0 ? 1.2 : 0.8;
      for (let i = 0; i < enhanced.length; i++) {
        brightened[i] = Math.min(255, Math.floor(enhanced[i] * factor));
      }
      result = decodeFromGrayscale(brightened, width, height);
    }
    
    const decodeTime = performance.now() - startTime;
    
    if (result) {
      // Extract result text from the decode result object
      const luminanceSource = new RGBLuminanceSource(enhanced, width, height);
      const binaryBitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));
      
      let fullResult: any = null;
      try {
        fullResult = reader.decode(binaryBitmap);
      } catch (e) {
        // If full decode fails, try thresholded
        try {
          const luminanceSource2 = new RGBLuminanceSource(thresholded, width, height);
          const binaryBitmap2 = new BinaryBitmap(new HybridBinarizer(luminanceSource2));
          fullResult = reader.decode(binaryBitmap2);
        } catch (e2) {
          // Fall back to basic result
        }
      }
      
      const barcodeText = result;
      const format = fullResult?.getBarcodeFormat() || 0;
      const confidence = fullResult?.getResultPoints()?.length || 1;
      const checksumValid = validateChecksum(barcodeText, format);
      
      self.postMessage({ 
        success: true, 
        barcode: barcodeText,
        format: format.toString(),
        confidence,
        checksumValid,
        decodeTime 
      });
    } else {
      self.postMessage({ success: false, decodeTime });
    }
  } catch (error) {
    const decodeTime = performance.now() - startTime;
    self.postMessage({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      decodeTime 
    });
  }
};

// Checksum validation for EAN/UPC codes
function validateChecksum(barcode: string, format: number): boolean {
  const formatStr = format.toString();
  
  // EAN-13 checksum validation (format = 3)
  if (formatStr === '3' && barcode.length === 13) {
    const digits = barcode.split('').map(Number);
    const check = digits.pop()!;
    const sum = digits.reduce((acc, digit, i) => acc + digit * (i % 2 === 0 ? 1 : 3), 0);
    return (10 - (sum % 10)) % 10 === check;
  }
  
  // EAN-8 checksum validation (format = 4)
  if (formatStr === '4' && barcode.length === 8) {
    const digits = barcode.split('').map(Number);
    const check = digits.pop()!;
    const sum = digits.reduce((acc, digit, i) => acc + digit * (i % 2 === 0 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === check;
  }
  
  // UPC-A checksum validation (format = 5)
  if (formatStr === '5' && barcode.length === 12) {
    const digits = barcode.split('').map(Number);
    const check = digits.pop()!;
    const sum = digits.reduce((acc, digit, i) => acc + digit * (i % 2 === 0 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === check;
  }
  
  // UPC-E checksum validation (format = 6) - accept as valid
  if (formatStr === '6' && barcode.length === 8) {
    return true;
  }
  
  // For CODE-128, CODE-39, QR codes, etc. - assume valid
  return true;
}
