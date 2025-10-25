-- Fix RLS policies for all tables to require authentication and proper access control

-- ============================================
-- PRODUCTS TABLE: Require authentication
-- ============================================
DROP POLICY IF EXISTS "Allow all operations on products" ON products;

CREATE POLICY "Authenticated users can view products" ON products
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage products" ON products
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update products" ON products
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete products" ON products
FOR DELETE USING (auth.role() = 'authenticated');

-- ============================================
-- SALES ORDERS TABLE: Require authentication
-- ============================================
DROP POLICY IF EXISTS "Allow all operations on sales_orders" ON sales_orders;

CREATE POLICY "Authenticated users can view orders" ON sales_orders
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can create orders" ON sales_orders
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update orders" ON sales_orders
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete orders" ON sales_orders
FOR DELETE USING (auth.role() = 'authenticated');

-- ============================================
-- SCAN LOGS TABLE: Require authentication, restrict modifications to admins
-- ============================================
DROP POLICY IF EXISTS "Allow all operations on scan_logs" ON scan_logs;

CREATE POLICY "Authenticated users can view scan logs" ON scan_logs
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can create scan logs" ON scan_logs
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Prevent modification/deletion of historical logs for audit integrity
CREATE POLICY "Admins can update scan logs" ON scan_logs
FOR UPDATE USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete scan logs" ON scan_logs
FOR DELETE USING (has_role(auth.uid(), 'admin'::app_role));

-- ============================================
-- PROFILES TABLE: Users can only view own profile, admins can view all
-- ============================================
DROP POLICY IF EXISTS "Users can view all profiles" ON profiles;

CREATE POLICY "Users can view own profile" ON profiles
FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles" ON profiles
FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

-- ============================================
-- SECURITY DEFINER FUNCTION: Add access checks
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_scan_log_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Ensure caller is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Validate quantity is positive
  IF NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be positive';
  END IF;
  
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
$function$;