-- Adicionar novos campos à tabela instancias_whatsapp para sincronização com Evolution API
ALTER TABLE public.instancias_whatsapp
ADD COLUMN IF NOT EXISTS token_instancia TEXT,
ADD COLUMN IF NOT EXISTS tipo_canal TEXT DEFAULT 'whatsapp',
ADD COLUMN IF NOT EXISTS numero_chip TEXT;

-- Atualizar a coluna token_zapi para ser nullable (já que agora temos token_instancia)
ALTER TABLE public.instancias_whatsapp
ALTER COLUMN token_zapi DROP NOT NULL;