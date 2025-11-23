-- Create order_packing table
CREATE TABLE IF NOT EXISTS public.order_packing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('flipkart', 'amazon', 'myntra')),
  marketplace_sku TEXT,
  master_sku TEXT,
  product_id UUID REFERENCES public.products(id),
  quantity_required INTEGER NOT NULL DEFAULT 1,
  quantity_scanned INTEGER NOT NULL DEFAULT 0,
  uploaded_file_path TEXT,
  label_file_path TEXT,
  invoice_file_path TEXT,
  packet_id TEXT,
  product_barcode TEXT,
  tag_barcode TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'packing', 'packed', 'dispatched')),
  packed_by UUID REFERENCES auth.users(id),
  packed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create packing_scan_audit table
CREATE TABLE IF NOT EXISTS public.packing_scan_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_packing_id UUID NOT NULL REFERENCES public.order_packing(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  scanned_barcode TEXT NOT NULL,
  resolved_master_sku TEXT,
  product_id UUID REFERENCES public.products(id),
  delta INTEGER NOT NULL DEFAULT 1,
  action TEXT NOT NULL CHECK (action IN ('scan', 'undo', 'manual_adjust')),
  source TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create crop_queue table for tracking crop operations
CREATE TABLE IF NOT EXISTS public.crop_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file_path TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  order_packing_ids UUID[],
  crop_metadata JSONB,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Update sales_orders table to include new fields
ALTER TABLE public.sales_orders 
ADD COLUMN IF NOT EXISTS invoice_number TEXT,
ADD COLUMN IF NOT EXISTS invoice_date DATE,
ADD COLUMN IF NOT EXISTS buyer_name TEXT,
ADD COLUMN IF NOT EXISTS billing_address TEXT,
ADD COLUMN IF NOT EXISTS line_items JSONB,
ADD COLUMN IF NOT EXISTS total_tax NUMERIC,
ADD COLUMN IF NOT EXISTS total_invoice_value NUMERIC,
ADD COLUMN IF NOT EXISTS invoice_data_missing BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS label_file_path TEXT,
ADD COLUMN IF NOT EXISTS invoice_file_path TEXT,
ADD COLUMN IF NOT EXISTS marketplace_sku TEXT,
ADD COLUMN IF NOT EXISTS master_sku TEXT,
ADD COLUMN IF NOT EXISTS packed_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS packed_at TIMESTAMP WITH TIME ZONE;

-- Enable RLS
ALTER TABLE public.order_packing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packing_scan_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crop_queue ENABLE ROW LEVEL SECURITY;

-- RLS Policies for order_packing
CREATE POLICY "Authenticated users can view order packing"
ON public.order_packing FOR SELECT
TO authenticated
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can create order packing"
ON public.order_packing FOR INSERT
TO authenticated
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update order packing"
ON public.order_packing FOR UPDATE
TO authenticated
USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can delete order packing"
ON public.order_packing FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'));

-- RLS Policies for packing_scan_audit
CREATE POLICY "Authenticated users can view scan audit"
ON public.packing_scan_audit FOR SELECT
TO authenticated
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can create scan audit"
ON public.packing_scan_audit FOR INSERT
TO authenticated
WITH CHECK (auth.role() = 'authenticated');

-- RLS Policies for crop_queue
CREATE POLICY "Authenticated users can view crop queue"
ON public.crop_queue FOR SELECT
TO authenticated
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage crop queue"
ON public.crop_queue FOR ALL
TO authenticated
USING (auth.role() = 'authenticated');

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_order_packing_order_id ON public.order_packing(order_id);
CREATE INDEX IF NOT EXISTS idx_order_packing_status ON public.order_packing(status);
CREATE INDEX IF NOT EXISTS idx_order_packing_product_id ON public.order_packing(product_id);
CREATE INDEX IF NOT EXISTS idx_packing_scan_audit_order_packing_id ON public.packing_scan_audit(order_packing_id);
CREATE INDEX IF NOT EXISTS idx_packing_scan_audit_user_id ON public.packing_scan_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_crop_queue_status ON public.crop_queue(status);

-- Create trigger for updated_at
CREATE TRIGGER update_order_packing_updated_at
BEFORE UPDATE ON public.order_packing
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();