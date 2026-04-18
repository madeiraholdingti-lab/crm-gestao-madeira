-- Remove a coluna icone da tabela instancias_whatsapp
ALTER TABLE public.instancias_whatsapp 
DROP COLUMN IF EXISTS icone;