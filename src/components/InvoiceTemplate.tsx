import { format } from "date-fns";

interface InvoiceLineItem {
  description: string;
  sku?: string;
  hsn?: string;
  qty: number;
  rate: number;
  taxable_value: number;
  gst_rate?: number;
  gst_amount?: number;
}

interface InvoiceData {
  invoice_number?: string;
  invoice_date?: string;
  billing_name?: string;
  billing_address?: string;
  shipping_name?: string;
  shipping_address?: string;
  line_items?: InvoiceLineItem[];
  subtotal?: number;
  tax_total?: number;
  grand_total?: number;
  currency?: string;
  order_id: string;
  platform: string;
}

interface InvoiceTemplateProps {
  data: InvoiceData;
}

export function InvoiceTemplate({ data }: InvoiceTemplateProps) {
  const lineItems = data.line_items || [];
  const subtotal = data.subtotal || lineItems.reduce((sum, item) => sum + item.taxable_value, 0);
  const taxTotal = data.tax_total || lineItems.reduce((sum, item) => sum + (item.gst_amount || 0), 0);
  const grandTotal = data.grand_total || (subtotal + taxTotal);

  return (
    <div className="bg-background p-8 max-w-4xl mx-auto" id="invoice-template">
      {/* Header */}
      <div className="border-b-2 border-border pb-4 mb-6">
        <h1 className="text-3xl font-bold text-foreground mb-2">TAX INVOICE</h1>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="font-semibold text-foreground">Your Company Name</p>
            <p className="text-muted-foreground">Your Company Address</p>
            <p className="text-muted-foreground">GSTIN: [Your GSTIN]</p>
          </div>
          <div className="text-right">
            <p className="text-muted-foreground">
              <span className="font-semibold text-foreground">Invoice No:</span> {data.invoice_number || 'N/A'}
            </p>
            <p className="text-muted-foreground">
              <span className="font-semibold text-foreground">Date:</span>{' '}
              {data.invoice_date ? format(new Date(data.invoice_date), 'dd-MMM-yyyy') : 'N/A'}
            </p>
            <p className="text-muted-foreground">
              <span className="font-semibold text-foreground">Order ID:</span> {data.order_id}
            </p>
            <p className="text-muted-foreground">
              <span className="font-semibold text-foreground">Platform:</span> {data.platform}
            </p>
          </div>
        </div>
      </div>

      {/* Billing & Shipping */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div>
          <h3 className="font-semibold text-foreground mb-2">Bill To:</h3>
          <p className="font-medium text-foreground">{data.billing_name || 'N/A'}</p>
          <p className="text-muted-foreground whitespace-pre-line text-sm">
            {data.billing_address || 'Address not available'}
          </p>
        </div>
        <div>
          <h3 className="font-semibold text-foreground mb-2">Ship To:</h3>
          <p className="font-medium text-foreground">{data.shipping_name || data.billing_name || 'N/A'}</p>
          <p className="text-muted-foreground whitespace-pre-line text-sm">
            {data.shipping_address || data.billing_address || 'Address not available'}
          </p>
        </div>
      </div>

      {/* Line Items Table */}
      <table className="w-full border-collapse mb-6">
        <thead>
          <tr className="bg-muted">
            <th className="border border-border p-2 text-left text-xs font-semibold text-foreground">Description</th>
            <th className="border border-border p-2 text-left text-xs font-semibold text-foreground">HSN</th>
            <th className="border border-border p-2 text-right text-xs font-semibold text-foreground">Qty</th>
            <th className="border border-border p-2 text-right text-xs font-semibold text-foreground">Rate</th>
            <th className="border border-border p-2 text-right text-xs font-semibold text-foreground">Taxable Value</th>
            <th className="border border-border p-2 text-right text-xs font-semibold text-foreground">GST %</th>
            <th className="border border-border p-2 text-right text-xs font-semibold text-foreground">GST Amount</th>
            <th className="border border-border p-2 text-right text-xs font-semibold text-foreground">Total</th>
          </tr>
        </thead>
        <tbody>
          {lineItems.length > 0 ? (
            lineItems.map((item, idx) => (
              <tr key={idx}>
                <td className="border border-border p-2 text-sm text-foreground">
                  {item.description}
                  {item.sku && <span className="text-muted-foreground text-xs block">SKU: {item.sku}</span>}
                </td>
                <td className="border border-border p-2 text-sm text-foreground">{item.hsn || '-'}</td>
                <td className="border border-border p-2 text-right text-sm text-foreground">{item.qty}</td>
                <td className="border border-border p-2 text-right text-sm text-foreground">
                  {item.rate.toFixed(2)}
                </td>
                <td className="border border-border p-2 text-right text-sm text-foreground">
                  {item.taxable_value.toFixed(2)}
                </td>
                <td className="border border-border p-2 text-right text-sm text-foreground">
                  {item.gst_rate || 0}%
                </td>
                <td className="border border-border p-2 text-right text-sm text-foreground">
                  {(item.gst_amount || 0).toFixed(2)}
                </td>
                <td className="border border-border p-2 text-right text-sm text-foreground">
                  {(item.taxable_value + (item.gst_amount || 0)).toFixed(2)}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={8} className="border border-border p-4 text-center text-muted-foreground">
                No line items available
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Totals */}
      <div className="flex justify-end mb-8">
        <div className="w-64">
          <div className="flex justify-between py-2 border-b border-border">
            <span className="text-muted-foreground">Subtotal:</span>
            <span className="font-semibold text-foreground">
              {data.currency || '₹'} {subtotal.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between py-2 border-b border-border">
            <span className="text-muted-foreground">Total Tax:</span>
            <span className="font-semibold text-foreground">
              {data.currency || '₹'} {taxTotal.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between py-2 border-t-2 border-foreground">
            <span className="font-bold text-foreground">Grand Total:</span>
            <span className="font-bold text-foreground text-lg">
              {data.currency || '₹'} {grandTotal.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t-2 border-border pt-4 mt-8">
        <p className="text-sm text-muted-foreground mb-4">
          This is a computer-generated invoice and does not require a signature.
        </p>
        <div className="text-xs text-muted-foreground">
          <p>Terms & Conditions apply</p>
        </div>
      </div>
    </div>
  );
}
