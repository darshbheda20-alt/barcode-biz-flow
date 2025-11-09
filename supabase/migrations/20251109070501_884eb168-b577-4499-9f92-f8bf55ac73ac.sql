-- Add marketplace_sku column to sku_aliases table
ALTER TABLE public.sku_aliases
ADD COLUMN marketplace_sku text;