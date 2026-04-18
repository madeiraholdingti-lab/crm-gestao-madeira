-- Add webhook_base64_enabled to config_global table
ALTER TABLE public.config_global 
ADD COLUMN IF NOT EXISTS webhook_base64_enabled BOOLEAN DEFAULT false;