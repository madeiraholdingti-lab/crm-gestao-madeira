-- Adicionar coluna tipo_jid na tabela contacts para identificar tipo de JID
ALTER TABLE public.contacts 
ADD COLUMN IF NOT EXISTS tipo_jid text;

-- Adicionar coluna tipo_jid na tabela messages (log)
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS tipo_jid text;

-- Comentários para documentação
COMMENT ON COLUMN public.contacts.tipo_jid IS 'Tipo do JID: lid, pessoa, grupo, outro';
COMMENT ON COLUMN public.messages.tipo_jid IS 'Tipo do JID: lid, pessoa, grupo, outro';