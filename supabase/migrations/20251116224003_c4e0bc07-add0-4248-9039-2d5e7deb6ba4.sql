-- Adicionar campos de metadados HTTP na tabela messages
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS http_headers jsonb,
ADD COLUMN IF NOT EXISTS http_params jsonb,
ADD COLUMN IF NOT EXISTS http_query jsonb,
ADD COLUMN IF NOT EXISTS http_meta jsonb,
ADD COLUMN IF NOT EXISTS http_client_ip text,
ADD COLUMN IF NOT EXISTS http_user_agent text;

-- Adicionar campos de metadados da Evolution/evento
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS event text,
ADD COLUMN IF NOT EXISTS destination text,
ADD COLUMN IF NOT EXISTS server_url text,
ADD COLUMN IF NOT EXISTS apikey_hash text;

-- Adicionar campo de contexto da mensagem
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS message_context_info jsonb;

-- Criar índices para consultas de auditoria
CREATE INDEX IF NOT EXISTS idx_messages_event ON public.messages(event);
CREATE INDEX IF NOT EXISTS idx_messages_http_client_ip ON public.messages(http_client_ip);
CREATE INDEX IF NOT EXISTS idx_messages_destination ON public.messages(destination);