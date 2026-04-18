-- Add ativo column to envios_disparo
ALTER TABLE public.envios_disparo 
ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;