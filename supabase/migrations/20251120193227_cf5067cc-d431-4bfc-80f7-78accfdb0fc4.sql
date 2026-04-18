-- Add webhook_url to config_global table
ALTER TABLE public.config_global 
ADD COLUMN IF NOT EXISTS webhook_url TEXT;