# Order Processing Workflow - Complete Implementation

## Overview
The complete order processing workflow from picklist generation through packing to sales orders is now implemented and functional.

## Workflow Steps

### 1. Generate Picklist (Tab 1)
**Upload Files:**
- **Flipkart**: Upload combined label+invoice PDFs
- **Amazon**: Upload label and invoice PDFs  
- **Myntra**: Upload CSV files with SKU and quantity

**Process:**
1. Files are parsed and stored in `process_orders` table
2. SKUs are mapped to Master SKUs (exact match required)
3. Unmapped SKUs appear in "Unmapped SKUs" section for manual mapping
4. Picklist is generated, grouped by Master SKU

**Export Picklist:**
When you click "Export CSV":
- Archives `process_orders` rows (status → 'archived')
- Creates `order_packing` records for each order
- Creates `sales_orders` records with invoice metadata
- For Flipkart: Creates `crop_queue` jobs automatically

### 2. Crop & Print (Tab 2)
**Automatic Processing:**
- Flipkart PDFs are automatically queued for cropping
- Click "Process" to crop PDFs into:
  - **Label PDF**: 4x6 inches (288x432 points) → saved to `printed-labels/` bucket
  - **Invoice PDF**: Separate invoice → saved to `printed-invoices/` bucket
- Label and invoice paths are attached to corresponding `order_packing` records

**Platform-Specific:**
- **Flipkart**: Auto-crop on export
- **Amazon**: Original PDF attached, no cropping
- **Myntra**: Manual upload during packing

**Debug:**
- Click "Download Debug JSON" to download crop queue metadata

### 3. Order Packaging (Tab 3)
**Packing Queue:**
- Shows all `order_packing` records with status != 'packed'
- Click "Pack" on any order to open packing interface

**Packing Interface:**
1. **Scan Product Barcode:**
   - Exact match → Auto-decrement inventory
   - Multiple matches → Show disambiguation modal
   - No match → Show "Map SKU" modal

2. **Session Auto-Apply:**
   - Check "Apply to next 5 scans" in disambiguation modal
   - System auto-selects the same SKU for next 5 scans of same barcode
   - Shows remaining counter

3. **Flipkart Orders:**
   - Requires Packet ID (manual input)

4. **Inventory Deduction:**
   - Atomic transaction with optimistic locking
   - Warns if inventory goes negative
   - Creates `packing_scan_audit` record

5. **Undo Last Scan:**
   - Available within 10 minutes
   - Reverts inventory and scan count

6. **Complete Packing:**
   - Marks `order_packing.status = 'packed'`
   - Creates/updates `sales_orders` record
   - Archives `process_orders` row

**View Completed Orders:**
- Click "View Completed" to see packed orders
- Click "Export CSV" to download completed orders list
- Click "Clear All" to delete pending orders (completed orders unaffected)

### 4. Sales Orders (Separate Page)
**Features:**
- View all completed sales orders
- Filter by platform, search by order ID/invoice number
- **View Invoice**: Opens invoice details modal
- **Download Invoice**: Downloads PDF from storage (cropped or original)
- **Bulk Download**: Select multiple orders → Download as ZIP
- Debug JSON available for each order

## Database Tables

### process_orders
- Stores parsed order data from uploaded files
- `workflow_status`: 'pending' | 'picklist_generated' | 'archived'
- Archives on export

### order_packing
- Created when picklist is exported
- Tracks packing progress
- `status`: 'pending' | 'packing' | 'packed'
- Stores label/invoice file paths

### crop_queue
- Created for Flipkart PDFs on export
- `status`: 'queued' | 'processing' | 'completed' | 'failed'
- Stores crop metadata

### packing_scan_audit
- Audit trail for all barcode scans
- Records: barcode, master_sku, delta, action, source
- Enables undo functionality

### sales_orders
- Final sales order records
- Created on export, updated on packing completion
- Stores invoice metadata and file paths

## Storage Buckets

1. **order-documents**: Original uploaded PDFs
2. **printed-labels**: Cropped label PDFs (4x6)
3. **printed-invoices**: Cropped invoice PDFs

## Acceptance Tests

### Test 1: Flipkart Flow
1. Upload Flipkart PDF to Generate Picklist tab
2. Click "Export CSV"
3. Verify:
   - CSV downloads
   - Crop & Print tab shows queued job
   - Order Packaging tab shows packing orders
4. Go to Crop & Print, click "Process"
5. Verify label and invoice PDFs are created
6. Go to Order Packaging, click "Pack" on an order
7. Enter Packet ID
8. Scan product barcode
9. Click "Complete Packing"
10. Go to Sales Orders page
11. Verify order appears with invoice file
12. Click "Download Invoice" → PDF downloads

### Test 2: Ambiguous Barcode
1. Create products with same barcode, different SKUs
2. Start packing an order
3. Scan the ambiguous barcode
4. Verify disambiguation modal appears with candidates
5. Select one, check "Apply to next 5 scans"
6. Scan same barcode 5 more times
7. Verify auto-selection works
8. On 6th scan, modal should reappear

### Test 3: Unmapped SKU
1. Scan barcode not in system
2. Verify "Map SKU" modal appears
3. Test "Map to Existing Product"
4. Test "Create New Product"
5. Verify order can be completed

### Test 4: Undo Functionality
1. Pack an order, scan a product
2. Click "Undo Last Scan"
3. Verify inventory restored
4. Verify scan count decremented
5. Wait 11 minutes, verify undo disabled

### Test 5: Completed Orders Management
1. Complete packing for multiple orders
2. Click "View Completed" in Order Packaging
3. Verify completed orders appear
4. Click "Export CSV" → Downloads completed orders list
5. Switch back to "View Pending"
6. Add new orders, click "Clear All"
7. Verify only pending orders deleted, completed orders remain

### Test 6: Bulk Invoice Download
1. Go to Sales Orders
2. Select multiple orders (checkboxes)
3. Click "Bulk Download Selected"
4. Verify ZIP file downloads with all invoices

### Test 7: Debug Data
1. Click "Download Debug JSON" in any section
2. Verify JSON contains:
   - process_orders
   - order_packing
   - packing_scan_audit
   - sales_orders
   - crop_queue

## Error Handling

### Negative Inventory
- Warning modal: "Inventory will become negative - continue?"
- If confirmed, allows decrement and flags in audit

### Concurrent Updates
- Uses optimistic locking on inventory updates
- Shows error if concurrent update detected
- User can retry scan

### Missing Invoice Files
- Shows "Invoice file not found" error
- Check storage bucket permissions
- Verify file paths in database

### Crop Job Failures
- Status marked as 'failed'
- Error message stored in crop_queue
- Retry button available
- Download debug JSON for troubleshooting

## Platform-Specific Notes

### Flipkart
- Requires Packet ID during packing
- Auto-crops PDFs into 4x6 labels + invoices
- Both label and invoice attached to order_packing

### Amazon
- No Packet ID required
- No auto-cropping
- Original PDF attached as-is

### Myntra
- Optional Tag Barcode
- Manual invoice/label upload during packing
- CSV upload for picklist

## Debug Tools

All sections include "Download Debug JSON" button that exports:
- Related database records
- File paths and metadata
- Audit trail
- Error messages (if any)

Use this for troubleshooting any workflow issues.

## Key Features

✅ Complete workflow from upload to sales order  
✅ Automatic PDF cropping for Flipkart  
✅ Barcode scanning with disambiguation  
✅ Session auto-apply for repeated scans  
✅ Atomic inventory deduction  
✅ Undo functionality (10-minute window)  
✅ Completed orders archive  
✅ Bulk invoice download  
✅ Debug JSON exports  
✅ Real-time UI updates  
✅ Platform-specific handling  

## Next Steps

1. Test the complete workflow with real data
2. Verify storage bucket permissions
3. Test edge cases (negative inventory, concurrent users)
4. Review debug outputs for any issues
5. Train users on the workflow
