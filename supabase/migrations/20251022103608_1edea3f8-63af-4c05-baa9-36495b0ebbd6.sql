-- Fix function search path security issues
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_scan_log_insert()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;