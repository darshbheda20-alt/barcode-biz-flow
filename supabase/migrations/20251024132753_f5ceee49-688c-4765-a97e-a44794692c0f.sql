-- Remove unique constraint from barcode to allow multiple NULL values during import
-- Barcodes can be updated after import
ALTER TABLE public.products 
DROP CONSTRAINT IF EXISTS products_barcode_key;