-- Create purchase_orders table to track ordered inventory
CREATE TABLE public.purchase_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity_ordered INTEGER NOT NULL,
  quantity_received INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'partially_received', 'received', 'cancelled')),
  ordered_by UUID REFERENCES auth.users(id),
  ordered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  received_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Authenticated users can view purchase orders"
ON public.purchase_orders FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can create purchase orders"
ON public.purchase_orders FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update purchase orders"
ON public.purchase_orders FOR UPDATE
USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can delete purchase orders"
ON public.purchase_orders FOR DELETE
USING (has_role(auth.uid(), 'admin'));

-- Add trigger for updated_at
CREATE TRIGGER update_purchase_orders_updated_at
BEFORE UPDATE ON public.purchase_orders
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_orders;