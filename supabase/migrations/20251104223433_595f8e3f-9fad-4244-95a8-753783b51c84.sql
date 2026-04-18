-- Adicionar campos de personalização na tabela instancias_whatsapp
ALTER TABLE public.instancias_whatsapp 
ADD COLUMN IF NOT EXISTS cor_identificacao TEXT DEFAULT '#3B82F6',
ADD COLUMN IF NOT EXISTS icone TEXT DEFAULT '📱';