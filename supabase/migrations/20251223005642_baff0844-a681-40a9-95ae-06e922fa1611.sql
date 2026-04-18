-- Add gemini_api_key column to config_global table
ALTER TABLE public.config_global
ADD COLUMN IF NOT EXISTS gemini_api_key TEXT DEFAULT NULL;