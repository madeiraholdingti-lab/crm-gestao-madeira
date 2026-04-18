-- Renomear coluna gemini_api_key para webhook_ia_disparos
ALTER TABLE public.config_global 
  DROP COLUMN IF EXISTS gemini_api_key;

ALTER TABLE public.config_global 
  ADD COLUMN IF NOT EXISTS webhook_ia_disparos TEXT DEFAULT NULL;