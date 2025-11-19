# Process Orders - PDF Parsing Guide

## Amazon PDF Parsing

The Amazon parser extracts order details from Amazon invoice/label PDFs with strict exact-match policies to prevent incorrect SKU mappings.

### Current Extraction Patterns

```javascript
// Order ID: Amazon format (123-1234567-1234567)
/Order\s*(?:ID|#)[:\s]*([\d\-]{15,})/i
/(\d{3}-\d{7}-\d{7})/

// ASIN with Seller SKU in parentheses
/\|\s*(B0[A-Z0-9]{8,})\s*\(\s*([^\)]+?)\s*\)/gi

// Product Description with ASIN and optional Seller SKU
/(.+?)\s*\|\s*(B0[A-Z0-9]{8,})\s*(?:\(\s*([^\)]+?)\s*\))?/gi

// Quantity extraction
/Qty[:\s]*(\d+)/i
/Quantity[:\s]*(\d+)/i
```

### Key Features

1. **Exact Match Only**: No fuzzy matching or auto-assignment
2. **Multi-Page Support**: Iterates all pages in PDF
3. **Multi-Product Support**: Extracts all products from each page
4. **Seller SKU Priority**: Prefers seller SKU over ASIN when both present
5. **Debug Export**: Downloadable JSON with all parsed data
6. **Duplicate Prevention**: Checks existing orders before insertion

### Parsed Data Structure

```typescript
interface ParsedPage {
  page_number: number;
  raw_text: string;
  parsed_lines: [
    {
      order_id: string;      // e.g., "404-0340551-2394744"
      asin: string;          // e.g., "B0ABCDEFGH"
      seller_sku: string;    // e.g., "LGO-TP2023-BLK-L"
      qty: number;           // defaults to 1 if not found
      product_name?: string;
      raw_line: string;      // for debugging
    }
  ]
}
```

### Mapping Logic

1. **Check sku_aliases**: Look for exact match in `sku_aliases` table where `marketplace='Amazon'`
2. **Check products**: Look for exact match in `master_sku` or `barcode` columns
3. **No Match**: Set `product_id=NULL` and surface in Unmapped SKUs UI

**CRITICAL**: No fuzzy matching, no substring matching, no "closest match". Only exact matches are accepted.

### Unmapped SKU Workflow

When a seller SKU is not found:
1. Order is saved with `product_id=NULL`
2. `marketplace_sku` is set to the seller SKU (or ASIN if no seller SKU)
3. `master_sku` is set to same value as fallback
4. Unmapped SKUs section displays the item
5. User must explicitly:
   - Map to existing product (via searchable dropdown)
   - Create new product skeleton (pre-filled modal)
   - Skip & flag for later review

### Testing

See `AMAZON_PARSER_QA.md` for comprehensive test scenarios and validation steps.

Test fixture: `document - 2025-11-16T122256.058.pdf`
- Expected Order ID: `404-0340551-2394744`
- Expected Seller SKU: `LGO-TP2023-BLK-L`
- Expected Quantity: `1`

### Improving Parsing Accuracy

1. **Collect Sample PDFs**: Test with various Amazon invoice formats
2. **Pattern Refinement**: Adjust regex patterns based on real invoices
3. **OCR Enhancement**: Add OCR retry option for image-based PDFs
4. **Validation Rules**: Ensure extracted data passes sanity checks

---

## Flipkart PDF Parsing

The current implementation uses regex patterns to extract order details from Flipkart PDFs. These patterns may need adjustment based on actual Flipkart invoice/label formats.

### Current Extraction Patterns

```javascript
// Order ID: OD followed by 15+ digits
/OD\d{15,}/i

// Invoice Number: Various formats
/Invoice\s*(?:No|Number)[:\s]+([A-Z0-9\-\/]+)/i

// Invoice Date: Common date formats
/Invoice\s*Date[:\s]+(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i

// Tracking/AWB: Alphanumeric tracking codes
/(?:AWB|Tracking)[:\s]+([A-Z0-9]+)/i

// SKU: FSN or SKU patterns
/SKU[:\s]+([A-Z0-9\-]+)/i
/FSN[A-Z0-9]+/i

// Quantity
/(?:Qty|Quantity)[:\s]+(\d+)/i

// Amount: Rupee symbol or Rs
/(?:Total|Amount|Price)[:\s]+(?:Rs\.?|₹)\s*(\d+(?:\.\d{2})?)/i
```

### Improving Parsing Accuracy

1. **Collect Sample PDFs**: Gather real Flipkart invoices to test and refine patterns
2. **Add Validation**: Implement checks to ensure extracted data makes sense
3. **Error Handling**: Provide detailed error messages when parsing fails
4. **Manual Review**: Allow users to review and correct parsed data before saving

### Alternative Approaches

For production use, consider:

1. **OCR Services**: Use cloud OCR services (Google Vision API, AWS Textract)
2. **Edge Function Processing**: Move PDF parsing to backend for better performance
3. **AI-Based Extraction**: Use AI models trained on invoice formats
4. **Template Matching**: Create templates for different marketplace formats

## Master SKU Mapping

The system attempts to map marketplace SKUs to Master SKUs in two ways:

1. **Via sku_aliases table**: Direct mapping from marketplace SKU to product
2. **Via products table**: Fallback lookup by barcode or partial master_sku match

### Unmapped SKUs

Orders with unmapped SKUs:
- Are still saved to the database
- Use the marketplace SKU as master_sku
- Are flagged in the picklist for manual review
- Should be mapped in the Master SKUs section before packaging

## Next Steps

1. Test with real Flipkart PDFs and adjust patterns
2. Add manual data correction interface
3. Implement bulk SKU mapping workflow
4. Add validation rules for extracted data
5. Consider backend processing for complex PDFs
