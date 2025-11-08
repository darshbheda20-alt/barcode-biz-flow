-- Drop existing table if it exists
DROP TABLE IF EXISTS public.sku_aliases CASCADE;

-- Create sku_aliases table for marketplace SKU mapping
-- Using product_id as foreign key for reliability
CREATE TABLE public.sku_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  marketplace TEXT NOT NULL, -- 'flipkart', 'amazon', 'myntra'
  alias_type TEXT NOT NULL, -- 'fsn', 'asin', 'seller_sku', etc.
  alias_value TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(marketplace, alias_type, alias_value)
);

-- Enable RLS
ALTER TABLE public.sku_aliases ENABLE ROW LEVEL SECURITY;

-- Policies (admin-only management, authenticated read)
CREATE POLICY "Authenticated users can view aliases"
ON public.sku_aliases
FOR SELECT
USING (auth.role() = 'authenticated'::text);

CREATE POLICY "Admins can insert aliases"
ON public.sku_aliases
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update aliases"
ON public.sku_aliases
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete aliases"
ON public.sku_aliases
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Trigger for updated_at
CREATE TRIGGER update_sku_aliases_updated_at
BEFORE UPDATE ON public.sku_aliases
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Index for fast lookups
CREATE INDEX idx_sku_aliases_product_id ON public.sku_aliases(product_id);
CREATE INDEX idx_sku_aliases_lookup ON public.sku_aliases(marketplace, alias_type, alias_value);