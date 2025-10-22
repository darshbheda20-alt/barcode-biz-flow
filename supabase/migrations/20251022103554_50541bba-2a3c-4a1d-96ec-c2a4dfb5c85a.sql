-- Create products table
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  master_sku TEXT NOT NULL UNIQUE,
  color TEXT,
  brand_size TEXT,
  standard_size TEXT,
  barcode TEXT NOT NULL UNIQUE,
  mrp DECIMAL(10, 2) NOT NULL,
  cost_price DECIMAL(10, 2) NOT NULL,
  reorder_level INTEGER NOT NULL DEFAULT 10,
  vendor_name TEXT NOT NULL,
  available_units INTEGER NOT NULL DEFAULT 0,
  damaged_units INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create scan_logs table
CREATE TABLE public.scan_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  scan_mode TEXT NOT NULL CHECK (scan_mode IN ('receive', 'pick', 'damage')),
  quantity INTEGER NOT NULL,
  order_id TEXT,
  packet_id TEXT,
  tag_id TEXT,
  platform TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create sales_orders table
CREATE TABLE public.sales_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL,
  packet_id TEXT,
  tag_id TEXT,
  platform TEXT NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (no auth required for this app)
CREATE POLICY "Allow all operations on products" ON public.products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on scan_logs" ON public.scan_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on sales_orders" ON public.sales_orders FOR ALL USING (true) WITH CHECK (true);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_products_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to handle scan log insertions and update inventory
CREATE OR REPLACE FUNCTION public.handle_scan_log_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Update product inventory based on scan mode
  IF NEW.scan_mode = 'receive' THEN
    UPDATE public.products
    SET available_units = available_units + NEW.quantity
    WHERE id = NEW.product_id;
  ELSIF NEW.scan_mode = 'pick' THEN
    UPDATE public.products
    SET available_units = available_units - NEW.quantity
    WHERE id = NEW.product_id;
  ELSIF NEW.scan_mode = 'damage' THEN
    UPDATE public.products
    SET damaged_units = damaged_units + NEW.quantity
    WHERE id = NEW.product_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for scan log inventory updates
CREATE TRIGGER handle_scan_log_inventory
AFTER INSERT ON public.scan_logs
FOR EACH ROW
EXECUTE FUNCTION public.handle_scan_log_insert();

-- Create indexes for better performance
CREATE INDEX idx_products_barcode ON public.products(barcode);
CREATE INDEX idx_products_master_sku ON public.products(master_sku);
CREATE INDEX idx_scan_logs_product_id ON public.scan_logs(product_id);
CREATE INDEX idx_scan_logs_created_at ON public.scan_logs(created_at DESC);
CREATE INDEX idx_sales_orders_product_id ON public.sales_orders(product_id);
CREATE INDEX idx_sales_orders_order_id ON public.sales_orders(order_id);