# Process Orders - PDF Parsing Guide

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
