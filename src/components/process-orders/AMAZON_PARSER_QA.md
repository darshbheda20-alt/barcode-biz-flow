# Amazon PDF Parser - QA Checklist

## Test Fixture
**File**: `document - 2025-11-16T122256.058.pdf`

**Expected Output**:
- **Seller SKU**: `LGO-TP2023-BLK-L`
- **Quantity**: `1`
- **Order ID**: `404-0340551-2394744`
- **ASIN**: Should be extracted if present

## Test Scenarios

### ✅ Scenario 1: Single-Page Invoice with One Product
**Purpose**: Verify basic parsing functionality

**Steps**:
1. Upload a single-page Amazon invoice PDF with one product
2. Verify the following are extracted:
   - Order ID (format: 123-1234567-1234567)
   - ASIN (format: B0XXXXXXXX)
   - Seller SKU (text in parentheses after ASIN)
   - Quantity (default to 1 if not found)
   - Product name (if available)

**Expected Result**:
- ✅ All fields extracted correctly
- ✅ Parsed data appears in process_orders table
- ✅ If SKU not in master list, Unmapped SKUs section shows the item
- ✅ Debug JSON download available

**Acceptance Criteria**:
- Zero fuzzy matching
- Exact match required for master_sku assignment
- product_id is NULL if no exact match found

---

### ✅ Scenario 2: Multi-Product Invoice Page
**Purpose**: Verify handling of multiple products on one page

**Steps**:
1. Upload an Amazon invoice with 3+ products on a single page
2. Verify each product line is extracted separately

**Expected Result**:
- ✅ Each product creates a separate `parsed_line` entry
- ✅ Quantities are correct per product (not summed incorrectly)
- ✅ Order ID is the same for all products from the page
- ✅ Each product's ASIN/SKU is distinct and captured

**Acceptance Criteria**:
- Number of `parsed_lines` matches number of products on page
- No duplicate counting
- Each line has correct qty, sku, and asin

---

### ✅ Scenario 3: Unmapped SKU Triggers Mapping UI
**Purpose**: Verify exact-match policy enforcement

**Steps**:
1. Upload Amazon PDF with seller SKU `LGO-TP2023-BLK-L`
2. Ensure `LGO-TP2023-BLK-L` is NOT in:
   - `products.master_sku`
   - `products.barcode`
   - `sku_aliases.alias_value` for Amazon marketplace

**Expected Result**:
- ✅ Order is saved to `process_orders` with `product_id = NULL`
- ✅ `marketplace_sku = 'LGO-TP2023-BLK-L'`
- ✅ `master_sku = 'LGO-TP2023-BLK-L'` (fallback to marketplace SKU)
- ✅ Unmapped SKUs section displays this SKU
- ✅ Mapping Review UI allows:
   - Map to existing product (searchable dropdown)
   - Create new product skeleton
   - Skip & Flag for later

**Acceptance Criteria**:
- ZERO auto-assignment without user confirmation
- No fuzzy matching or "closest match" logic
- User explicitly chooses mapping action

---

### ✅ Scenario 4: Multi-Page PDF Processing
**Purpose**: Verify all pages are parsed

**Steps**:
1. Upload a 5+ page Amazon PDF with products on multiple pages
2. Check that all pages are iterated

**Expected Result**:
- ✅ Debug JSON shows `parsed_pages` array with all pages
- ✅ Each page has `page_number`, `raw_text`, and `parsed_lines`
- ✅ All products from all pages are extracted
- ✅ UI shows total count of orders processed

**Acceptance Criteria**:
- `parsed_pages.length` equals PDF page count
- No pages skipped
- Page numbers are 1-indexed

---

### ✅ Scenario 5: Duplicate Order Handling
**Purpose**: Verify duplicate prevention

**Steps**:
1. Upload the same Amazon PDF twice
2. Check database for duplicate entries

**Expected Result**:
- ✅ First upload: Orders inserted successfully
- ✅ Second upload: "All X order(s) were already processed and archived" message
- ✅ No duplicate rows in `process_orders` table
- ✅ Duplicate count shown in upload status

**Acceptance Criteria**:
- Duplicate check based on: `order_id`, `marketplace_sku`, `platform = 'Amazon'`
- Archived orders are skipped with clear messaging
- User is directed to "View Past" or "Clear Picklist"

---

### ✅ Scenario 6: Debug JSON Export
**Purpose**: Verify debug data availability

**Steps**:
1. Upload any Amazon PDF
2. Click "Download Debug JSON" button

**Expected Result**:
- ✅ JSON file downloads with filename format `amazon-debug-{timestamp}.json`
- ✅ JSON structure matches:
```json
[
  {
    "page_number": 1,
    "raw_text": "...",
    "parsed_lines": [
      {
        "order_id": "404-0340551-2394744",
        "asin": "B0ABCDEFGH",
        "seller_sku": "LGO-TP2023-BLK-L",
        "qty": 1,
        "product_name": "Product Name",
        "raw_line": "..."
      }
    ]
  }
]
```

**Acceptance Criteria**:
- Valid JSON format
- All extracted fields present
- Useful for QA and debugging parse failures

---

### ✅ Scenario 7: No Products Found
**Purpose**: Verify graceful handling of invalid PDFs

**Steps**:
1. Upload a blank PDF or invoice with no recognizable products
2. Check error handling

**Expected Result**:
- ✅ Status shows "No valid products found in PDF"
- ✅ No database inserts
- ✅ No crash or unhandled errors
- ✅ User can try again with different file

**Acceptance Criteria**:
- Clear error message
- Parsing doesn't crash
- Other files in batch still process

---

### ✅ Scenario 8: ASIN Fallback When No Seller SKU
**Purpose**: Verify fallback logic for missing seller SKU

**Steps**:
1. Upload Amazon invoice where ASIN is present but seller SKU is missing
2. Verify ASIN is used as marketplace_sku

**Expected Result**:
- ✅ `marketplace_sku` is set to ASIN (e.g., `B0ABCDEFGH`)
- ✅ `seller_sku` in parsed line shows ASIN
- ✅ Treated as unmapped unless ASIN exactly matches master_sku

**Acceptance Criteria**:
- No crashes when seller SKU missing
- ASIN captured as fallback identifier
- Still requires exact match for mapping

---

## Test Fixture Validation

**Using**: `document - 2025-11-16T122256.058.pdf`

### Expected Extraction:
```json
{
  "order_id": "404-0340551-2394744",
  "seller_sku": "LGO-TP2023-BLK-L",
  "qty": 1,
  "asin": "[ASIN from PDF]",
  "product_name": "[Product name from PDF]"
}
```

### Validation Steps:
1. ✅ Upload fixture PDF
2. ✅ Download debug JSON
3. ✅ Verify extracted fields match expected values
4. ✅ If `LGO-TP2023-BLK-L` not in master list, Unmapped SKUs shows it
5. ✅ User can map it to existing product or create new

---

## Performance & Reliability

- **Parse Time**: Should complete within 30 seconds for 10-page PDF
- **Error Recovery**: Individual line failures don't crash entire batch
- **Logging**: Console logs show extraction progress with page numbers
- **UI Feedback**: Upload button disabled during processing, status updates shown

---

## PR Checklist

- [ ] All 8 test scenarios pass
- [ ] Test fixture validated with expected output
- [ ] Debug JSON export functional
- [ ] No fuzzy matching - only exact matches
- [ ] Unmapped SKUs trigger Mapping Review UI
- [ ] Duplicate prevention working
- [ ] Multi-page and multi-product parsing correct
- [ ] Error handling graceful
- [ ] Code follows Flipkart parser patterns
- [ ] Documentation updated

---

## Known Limitations

1. **OCR**: Current parser uses text extraction only. Image-based invoices may need OCR enhancement.
2. **Format Variations**: Amazon invoice formats may vary. Parser uses multiple regex patterns to handle variations.
3. **Seller SKU Format**: Parser looks for text in parentheses after ASIN. If Amazon changes format, regex may need updates.

---

## Future Enhancements

- [ ] Add OCR retry option for low-quality PDFs
- [ ] Support for Amazon international formats
- [ ] Batch mapping for multiple unmapped SKUs
- [ ] Auto-learn seller SKU patterns from successful mappings
