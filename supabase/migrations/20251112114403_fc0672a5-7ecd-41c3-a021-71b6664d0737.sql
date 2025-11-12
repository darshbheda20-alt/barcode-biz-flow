-- Create process_orders table to store parsed order data from all platforms
CREATE TABLE public.process_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('flipkart', 'amazon', 'myntra')),
  order_id TEXT NOT NULL,
  invoice_number TEXT,
  invoice_date DATE,
  tracking_id TEXT,
  packet_id TEXT,
  tag_id TEXT,
  marketplace_sku TEXT,
  product_id UUID REFERENCES public.products(id),
  master_sku TEXT,
  product_name TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  amount NUMERIC,
  payment_type TEXT,
  workflow_status TEXT NOT NULL DEFAULT 'pending' CHECK (workflow_status IN ('pending', 'picklist_generated', 'printed', 'packaging', 'completed')),
  uploaded_file_path TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create printing_status table to track printing for each order
CREATE TABLE public.printing_status (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  process_order_id UUID NOT NULL REFERENCES public.process_orders(id) ON DELETE CASCADE,
  label_printed BOOLEAN NOT NULL DEFAULT false,
  invoice_printed BOOLEAN NOT NULL DEFAULT false,
  label_file_path TEXT,
  invoice_file_path TEXT,
  printed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(process_order_id)
);

-- Enable Row Level Security
ALTER TABLE public.process_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.printing_status ENABLE ROW LEVEL SECURITY;

-- RLS Policies for process_orders
CREATE POLICY "Authenticated users can view process orders"
ON public.process_orders
FOR SELECT
USING (auth.role() = 'authenticated'::text);

CREATE POLICY "Authenticated users can create process orders"
ON public.process_orders
FOR INSERT
WITH CHECK (auth.role() = 'authenticated'::text);

CREATE POLICY "Authenticated users can update process orders"
ON public.process_orders
FOR UPDATE
USING (auth.role() = 'authenticated'::text);

CREATE POLICY "Admins can delete process orders"
ON public.process_orders
FOR DELETE
USING (has_role(auth.uid(), 'admin'));

-- RLS Policies for printing_status
CREATE POLICY "Authenticated users can view printing status"
ON public.printing_status
FOR SELECT
USING (auth.role() = 'authenticated'::text);

CREATE POLICY "Authenticated users can manage printing status"
ON public.printing_status
FOR ALL
USING (auth.role() = 'authenticated'::text);

-- Create trigger for updated_at
CREATE TRIGGER update_process_orders_updated_at
BEFORE UPDATE ON public.process_orders
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for better query performance
CREATE INDEX idx_process_orders_platform ON public.process_orders(platform);
CREATE INDEX idx_process_orders_workflow_status ON public.process_orders(workflow_status);
CREATE INDEX idx_process_orders_order_id ON public.process_orders(order_id);
CREATE INDEX idx_process_orders_master_sku ON public.process_orders(master_sku);
CREATE INDEX idx_printing_status_process_order_id ON public.printing_status(process_order_id);

-- Create storage buckets for order documents and printed files
INSERT INTO storage.buckets (id, name, public) 
VALUES 
  ('order-documents', 'order-documents', false),
  ('printed-labels', 'printed-labels', false),
  ('printed-invoices', 'printed-invoices', false);

-- Storage policies for order-documents bucket
CREATE POLICY "Authenticated users can upload order documents"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'order-documents' 
  AND auth.role() = 'authenticated'::text
);

CREATE POLICY "Authenticated users can view order documents"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'order-documents' 
  AND auth.role() = 'authenticated'::text
);

CREATE POLICY "Authenticated users can update order documents"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'order-documents' 
  AND auth.role() = 'authenticated'::text
);

-- Storage policies for printed-labels bucket
CREATE POLICY "Authenticated users can upload printed labels"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'printed-labels' 
  AND auth.role() = 'authenticated'::text
);

CREATE POLICY "Authenticated users can view printed labels"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'printed-labels' 
  AND auth.role() = 'authenticated'::text
);

-- Storage policies for printed-invoices bucket
CREATE POLICY "Authenticated users can upload printed invoices"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'printed-invoices' 
  AND auth.role() = 'authenticated'::text
);

CREATE POLICY "Authenticated users can view printed invoices"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'printed-invoices' 
  AND auth.role() = 'authenticated'::text
);