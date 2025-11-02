# Barcode Scanner Accuracy & Consensus - QA Checklist

## Overview
This PR implements multi-frame consensus, checksum validation, and confidence-based confirmation to prevent false positives while maintaining fast scanning speed.

## PR Description

### Changes Implemented

#### 1. **Enhanced Camera Configuration**
- ✅ Rear camera with optimized constraints: 1280x720 @ 24fps
- ✅ Continuous focus support (with graceful fallback)
- ✅ Improved device selection for mobile

#### 2. **Region of Interest (ROI) System**
- ✅ Centered crop region (~60% width × 40% height) for faster decoding
- ✅ Visual overlay with corner brackets and crosshair
- ✅ Adjustable ROI width (40-90%) via slider
- ✅ Dark overlay outside ROI to guide user positioning

#### 3. **Image Preprocessing Pipeline**
- ✅ Grayscale conversion
- ✅ Histogram-based contrast enhancement
- ✅ Median blur denoising (3x3 kernel)
- ✅ Adaptive thresholding for faded barcodes
- ✅ Brightness variation attempts on decode failure

#### 4. **Performance Optimizations**
- ✅ Web Worker implementation for off-main-thread decoding
- ✅ ~24 FPS processing rate (configurable)
- ✅ Single-frame-at-a-time worker messaging (prevents queue buildup)
- ✅ requestAnimationFrame-based frame capture
- ✅ Non-blocking UI during decode operations

#### 5. **Decoder Configuration**
- ✅ TRY_HARDER flag enabled
- ✅ Multiple format support: EAN-13, EAN-8, CODE-128, CODE-39, UPC-A, UPC-E, QR Code
- ✅ Sequential preprocessing attempts (enhanced → thresholded → brightened)
- ✅ Rate-limited decode attempts (~8-12/sec on mid-range devices)

#### 6. **Enhanced UX Features**
- ✅ **Torch toggle**: Shows when device supports it
- ✅ **Manual capture button**: Still image capture for difficult scans
- ✅ **Haptic feedback**: 200ms vibration on successful scan
- ✅ **Audio beep**: Success sound on decode
- ✅ **Visual feedback**: "Scanning..." pulse indicator
- ✅ **ROI adjustment**: User-configurable scan area width

#### 7. **Developer Diagnostics**
- ✅ Toggle-able diagnostics overlay (Info button)
- ✅ Real-time camera resolution display
- ✅ FPS counter (rolling 10-frame average)
- ✅ Average decode time in milliseconds
- ✅ Success rate percentage with attempt counters

#### 8. **Multi-Frame Consensus (NEW)**
- ✅ Requires same barcode in 2+ consecutive frames OR majority of 3-5 frames
- ✅ Prevents false positives from single-frame misreads
- ✅ 1.5-second consensus timeout with automatic retry
- ✅ Console logging with `framesUsed` count for QA validation

#### 9. **Checksum Validation (NEW)**
- ✅ EAN-13, EAN-8, UPC-A checksum validation
- ✅ Invalid checksums trigger confirmation dialog
- ✅ Other formats (CODE-128, QR) bypass checksum check

#### 10. **Confidence-Based Confirmation (NEW)**
- ✅ Low confidence scores trigger confirmation dialog
- ✅ Product database validation (unknown products require confirmation)
- ✅ One-tap confirmation UI: Confirm / Retry / Type buttons
- ✅ Visual feedback showing detected code and reason for confirmation

#### 11. **Scan Logging (NEW)**
- ✅ Console logs for every accepted scan
- ✅ Includes: timestamp, barcode, framesUsed, confidence, checksumValid, autoAccepted
- ✅ Enables before/after comparison for accuracy improvements

---

## QA Testing Checklist

### Prerequisites
- [ ] Test on **iPhone** (iOS 14+)
- [ ] Test on **mid-range Android** device (Android 9+)
- [ ] Test on **desktop** (Chrome/Edge/Safari)
- [ ] Prepare sample barcodes:
  - [ ] Clear, well-lit EAN-13 barcode
  - [ ] Faded/worn barcode
  - [ ] Barcode with glare
  - [ ] Small barcode (< 2cm wide)
  - [ ] QR code
  - [ ] Barcode NOT in product database (for unknown product test)

---

### ✅ Accuracy & Consensus Tests (NEW - Critical)

#### Test 0.1: Multi-Frame Consensus - Clear Barcode
- [ ] Open scanner and scan a clear barcode
- [ ] **Expected**: Auto-accept after 2 consecutive matching frames (< 500ms)
- [ ] Open browser console, check `[SCAN LOG]` entry
- [ ] **Expected**: Log shows `framesUsed: 2` and `autoAccepted: true`
- [ ] **Actual**: Pass / Fail

#### Test 0.2: Multi-Frame Consensus - Faded Barcode
- [ ] Scan a faded barcode
- [ ] **Expected**: System requires 2+ matching frames before accepting
- [ ] **Expected**: No false positive auto-accepts
- [ ] Check console log
- [ ] **Expected**: `framesUsed: 2` or higher, `checksumValid: true`
- [ ] **Actual**: Pass / Fail

#### Test 0.3: Consensus Disagreement
- [ ] Position scanner where multiple barcodes are partially visible
- [ ] **Expected**: System does NOT auto-accept conflicting reads
- [ ] **Expected**: After 3+ decode attempts without consensus, either shows confirmation dialog or times out
- [ ] **Actual**: Pass / Fail

#### Test 0.4: Checksum Validation - Valid EAN-13
- [ ] Scan a valid EAN-13 barcode from product database
- [ ] **Expected**: Checksum passes, auto-accepts
- [ ] Check console: `checksumValid: true`
- [ ] **Actual**: Pass / Fail

#### Test 0.5: Checksum Validation - Invalid (Manual Test)
- [ ] Create a test with an EAN-13 where last digit is changed
- [ ] **Expected**: System detects invalid checksum
- [ ] **Expected**: Confirmation dialog appears with "Invalid checksum" reason
- [ ] **Actual**: Pass / Fail (Note: Hard to test without mock data)

#### Test 0.6: Product Database Validation - Unknown Product
- [ ] Scan a valid barcode that does NOT exist in products table
- [ ] **Expected**: Confirmation dialog appears
- [ ] **Expected**: Reason shows "Product not found in database"
- [ ] **Expected**: Barcode displayed in large font with Confirm / Retry / Type buttons
- [ ] **Actual**: Pass / Fail

#### Test 0.7: Confirmation Dialog - Confirm Button
- [ ] Trigger confirmation dialog (unknown product or low confidence)
- [ ] Tap "Confirm" button
- [ ] **Expected**: Barcode immediately accepted and populated in field
- [ ] **Expected**: Modal closes
- [ ] **Expected**: Success toast appears
- [ ] Check console: `autoAccepted: false`
- [ ] **Actual**: Pass / Fail

#### Test 0.8: Confirmation Dialog - Retry Button
- [ ] Trigger confirmation dialog
- [ ] Tap "Retry" button
- [ ] **Expected**: Confirmation dialog closes
- [ ] **Expected**: Camera restarts
- [ ] **Expected**: User can scan again
- [ ] **Actual**: Pass / Fail

#### Test 0.9: Confirmation Dialog - Type Button
- [ ] Trigger confirmation dialog
- [ ] Tap "Type" button
- [ ] **Expected**: Switches to manual input mode
- [ ] **Expected**: Input field focused and ready
- [ ] **Actual**: Pass / Fail

#### Test 0.10: Low Confidence Detection
- [ ] Use a barcode with poor contrast or extreme angle
- [ ] **Expected**: If confidence < 2 (few result points), triggers confirmation
- [ ] **Expected**: Reason shows "Low confidence detection"
- [ ] **Actual**: Pass / Fail

#### Test 0.11: False Positive Prevention (Before/After)
- [ ] Prepare 10 faded/glare-affected sample barcodes
- [ ] Test with OLD scanner (if available): record false positive count
- [ ] Test with NEW scanner: record false positive count
- [ ] **Expected**: >80% reduction in false positives
- [ ] **Actual**: Old FP: _____ / New FP: _____ (Reduction: ____%)

---

### ✅ Speed Tests (Critical)

#### Test 1.1: Clear Barcode Speed
- [ ] Open scanner modal
- [ ] Point at clear barcode in good lighting
- [ ] **Expected**: Scan completes in < 500ms from camera ready to field populated
- [ ] **Actual**: _____ms (check diagnostics)

#### Test 1.2: Consecutive Scans
- [ ] Scan 5 barcodes consecutively
- [ ] **Expected**: All scans < 500ms, no performance degradation
- [ ] **Actual**: _____

---

### ✅ Robustness Tests (Critical)

#### Test 2.1: Faded Barcode
- [ ] Test with printed barcode left in sunlight or artificially faded
- [ ] **Expected**: >90% success rate on faded codes
- [ ] **Actual**: _____ successes out of 10 attempts

#### Test 2.2: Glare/Reflection
- [ ] Position barcode with mild overhead light reflection
- [ ] **Expected**: Scanner handles glare with preprocessing
- [ ] **Actual**: Pass / Fail

#### Test 2.3: Low Light
- [ ] Test in dim environment
- [ ] **Expected**: Torch toggle appears (if supported)
- [ ] **Expected**: Manual capture button works
- [ ] **Actual**: Pass / Fail

#### Test 2.4: Damaged Barcode
- [ ] Test with barcode that has minor bar damage
- [ ] **Expected**: Adaptive thresholding compensates
- [ ] **Actual**: Pass / Fail

---

### ✅ UI/UX Tests

#### Test 3.1: ROI Visual Feedback
- [ ] Open scanner
- [ ] **Expected**: See highlighted rectangle with corner brackets
- [ ] **Expected**: Area outside ROI is darkened
- [ ] **Expected**: Crosshair visible in center
- [ ] **Actual**: Pass / Fail

#### Test 3.2: ROI Adjustment
- [ ] Adjust "Scan Area Width" slider
- [ ] **Expected**: ROI overlay width changes in real-time
- [ ] **Expected**: Scanning still works at 40%, 60%, 90%
- [ ] **Actual**: Pass / Fail

#### Test 3.3: Torch Toggle (if supported)
- [ ] Click torch button
- [ ] **Expected**: Device flashlight activates
- [ ] **Expected**: Button shows "Torch On"
- [ ] Click again
- [ ] **Expected**: Flashlight deactivates
- [ ] **Actual**: Pass / Fail

#### Test 3.4: Manual Capture
- [ ] Position barcode in frame
- [ ] Click "Capture" button
- [ ] **Expected**: "Processing image..." toast appears
- [ ] **Expected**: Decode happens on still image
- [ ] **Actual**: Pass / Fail

#### Test 3.5: Haptic & Audio Feedback
- [ ] Scan a barcode successfully
- [ ] **Expected**: Device vibrates (200ms)
- [ ] **Expected**: Audio beep plays
- [ ] **Actual**: Pass / Fail

#### Test 3.6: Status Indicator
- [ ] Watch during active scanning
- [ ] **Expected**: "Scanning..." badge pulses at bottom during decode
- [ ] **Expected**: Badge disappears between attempts
- [ ] **Actual**: Pass / Fail

---

### ✅ Diagnostics Tests

#### Test 4.1: Diagnostics Toggle
- [ ] Click info (i) button in modal header
- [ ] **Expected**: Diagnostics overlay appears with:
  - [ ] Resolution (e.g., "1280x720")
  - [ ] FPS (should be ~20-24)
  - [ ] Avg Decode time (should be < 200ms)
  - [ ] Success Rate percentage
- [ ] **Actual**: Pass / Fail

#### Test 4.2: Diagnostics Accuracy
- [ ] Perform 10 scans (mix successful and unsuccessful)
- [ ] **Expected**: Counter increments correctly
- [ ] **Expected**: Success rate calculates accurately
- [ ] **Actual**: Pass / Fail

---

### ✅ Performance Tests

#### Test 5.1: CPU Usage (Mobile)
- [ ] Open scanner and watch device
- [ ] **Expected**: No significant lag in UI
- [ ] **Expected**: Modal animations remain smooth
- [ ] **Expected**: Device doesn't heat up noticeably during 60s test
- [ ] **Actual**: Pass / Fail

#### Test 5.2: Main Thread Responsiveness
- [ ] While scanner is active, try scrolling/interacting with modal controls
- [ ] **Expected**: Controls remain responsive
- [ ] **Expected**: No janky animations
- [ ] **Actual**: Pass / Fail

#### Test 5.3: Worker Performance
- [ ] Check browser DevTools → Performance tab
- [ ] **Expected**: Decoding work appears in Worker thread, not Main thread
- [ ] **Actual**: Pass / Fail

---

### ✅ Compatibility Tests

#### Test 6.1: iOS Safari
- [ ] Test all above on iPhone
- [ ] **Expected**: All features work (torch may not be supported on all models)
- [ ] **Actual**: Pass / Fail / N/A

#### Test 6.2: Android Chrome
- [ ] Test all above on Android
- [ ] **Expected**: All features work
- [ ] **Actual**: Pass / Fail

#### Test 6.3: Desktop Fallback
- [ ] Test on desktop with webcam
- [ ] **Expected**: Works but may be slower (desktop cameras often lower quality)
- [ ] **Expected**: Manual input still available
- [ ] **Actual**: Pass / Fail

#### Test 6.4: No Camera Device
- [ ] Test on device without camera
- [ ] **Expected**: Error message shown
- [ ] **Expected**: Manual input automatically available
- [ ] **Actual**: Pass / Fail

---

### ✅ Edge Cases

#### Test 7.1: Camera Permission Denied
- [ ] Deny camera permission
- [ ] **Expected**: Clear error message with instructions
- [ ] **Expected**: Manual input fallback available
- [ ] **Actual**: Pass / Fail

#### Test 7.2: Multiple Cameras
- [ ] Test on device with multiple cameras
- [ ] **Expected**: Camera selector dropdown appears
- [ ] **Expected**: Can switch between cameras
- [ ] **Actual**: Pass / Fail

#### Test 7.3: Portrait vs Landscape
- [ ] Test in both orientations
- [ ] **Expected**: ROI overlay adapts
- [ ] **Expected**: Scanning works in both
- [ ] **Actual**: Pass / Fail

#### Test 7.4: Preview/Iframe Mode
- [ ] Test in Lovable preview iframe
- [ ] **Expected**: "Camera unavailable in preview" warning shown
- [ ] **Expected**: "Open in New Tab" button works
- [ ] **Expected**: Manual input available
- [ ] **Actual**: Pass / Fail

---

## Acceptance Criteria Summary

### Original Criteria (Still Valid)
- [ ] **Speed**: Clear barcodes scan in < 500ms on iPhone and mid-range Android
- [ ] **Robustness**: >90% success rate on faded/glare sample set (10 barcodes)
- [ ] **CPU**: Main thread remains responsive with smooth animations
- [ ] **Torch**: Toggle works when device supports it
- [ ] **Haptic**: Vibration feedback on success
- [ ] **Diagnostics**: Overlay shows accurate FPS, decode time, success rate
- [ ] **Manual Fallback**: Always visible and functional

### New Consensus & Accuracy Criteria
- [ ] **Multi-Frame Consensus**: Same code required in 2+ consecutive frames OR majority of 3-5 frames
- [ ] **No False Positives**: System does NOT auto-accept on single misread or disagreeing frames
- [ ] **Checksum Validation**: EAN/UPC codes validated before auto-accept
- [ ] **Product Validation**: Unknown products trigger confirmation (not auto-accept)
- [ ] **Confirmation UI**: One-tap Confirm / Retry / Type workflow is fast and intuitive
- [ ] **Logging**: Console logs show all scan metadata for QA analysis
- [ ] **False Positive Reduction**: >80% reduction compared to single-frame acceptance

---

## Known Limitations

1. **Torch support**: Only available on devices that expose the `torch` capability (typically rear cameras on newer phones)
2. **iOS Safari limitations**: Some older iPhone models may not support torch via web APIs
3. **Desktop performance**: Webcams typically have lower resolution and frame rates, may be slower than mobile
4. **Worker overhead**: First decode after opening modal may take 100-200ms longer due to worker initialization

---

## Demo Video Requirements

Please record and attach:
1. **iPhone video** (60-90 seconds):
   - Show clear barcode scan (< 500ms) with auto-accept
   - Show console log with `framesUsed: 2` and `autoAccepted: true`
   - Show faded barcode scan with consensus success
   - Show unknown product triggering confirmation dialog
   - Demonstrate Confirm / Retry / Type buttons
   - Show torch toggle working
   - Show diagnostics overlay with metrics

2. **Android video** (60-90 seconds):
   - Show clear barcode scan with auto-accept
   - Show confirmation dialog for low confidence code
   - Demonstrate one-tap confirmation workflow
   - Show manual capture button
   - Show ROI adjustment working
   - Show console logs with consensus data

3. **Screenshots**:
   - Scanner with ROI overlay visible
   - Confirmation dialog showing detected code and reason
   - Console logs with `[SCAN LOG]` entries
   - Diagnostics overlay showing metrics
   - Torch controls (if available)

---

## Build Steps

No additional build steps required. The Web Worker is bundled automatically by Vite with the `new URL()` syntax.

---

## Rollback Plan

If issues arise:
1. Revert to previous `BarcodeScanner.tsx` (using `react-zxing`)
2. Remove `src/workers/barcodeDecoder.worker.ts`
3. Remove `@zxing/library` dependency
4. Previous implementation will work immediately

---

## Related Issues

- Fixes: Slow mobile barcode scanning (2-3 seconds per scan)
- Fixes: Failed scans on faded/damaged barcodes
- Adds: Developer diagnostics for troubleshooting
- Adds: Enhanced UX features (torch, manual capture, haptic feedback)
