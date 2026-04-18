-- Adicionar coluna is_edited na tabela messages
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS is_edited boolean DEFAULT false;

-- Atualizar mensagens já editadas (que têm texto diferente do original não é possível detectar retroativamente)
COMMENT ON COLUMN public.messages.is_edited IS 'Indica se a mensagem foi editada após envio';