-- Add exported_at column to track when picklist was exported
ALTER TABLE public.process_orders 
ADD COLUMN exported_at TIMESTAMP WITH TIME ZONE;

-- Add index for faster queries on exported_at
CREATE INDEX idx_process_orders_exported_at ON public.process_orders(exported_at);

-- Update workflow_status check to include 'archived' status
-- Note: The existing check constraint will be updated to allow 'archived' status