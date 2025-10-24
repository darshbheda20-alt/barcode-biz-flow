-- Make barcode field nullable to allow imports without barcode
ALTER TABLE public.products 
ALTER COLUMN barcode DROP NOT NULL;