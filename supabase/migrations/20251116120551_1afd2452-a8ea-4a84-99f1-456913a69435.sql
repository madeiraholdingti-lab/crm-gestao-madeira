-- Criar tabela de contatos
CREATE TABLE public.contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  jid TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Criar índice no phone para buscas rápidas
CREATE INDEX idx_contacts_phone ON public.contacts(phone);

-- Criar tabela de mensagens
CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  wa_message_id TEXT NOT NULL UNIQUE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  instance TEXT NOT NULL,
  instance_uuid TEXT NOT NULL,
  from_me BOOLEAN NOT NULL DEFAULT false,
  text TEXT,
  status TEXT,
  message_type TEXT,
  wa_timestamp BIGINT,
  webhook_received_at TIMESTAMP WITH TIME ZONE,
  sender_lid TEXT,
  source TEXT,
  sender_jid TEXT,
  raw_payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Criar índices para queries eficientes
CREATE INDEX idx_messages_contact_id ON public.messages(contact_id);
CREATE INDEX idx_messages_instance ON public.messages(instance);
CREATE INDEX idx_messages_wa_timestamp ON public.messages(wa_timestamp DESC);

-- Habilitar RLS
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para contacts (apenas admins podem ver)
CREATE POLICY "Admins podem ver todos os contatos"
ON public.contacts
FOR SELECT
USING (has_role(auth.uid(), 'admin_geral'::app_role));

CREATE POLICY "Admins podem inserir contatos"
ON public.contacts
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin_geral'::app_role));

CREATE POLICY "Admins podem atualizar contatos"
ON public.contacts
FOR UPDATE
USING (has_role(auth.uid(), 'admin_geral'::app_role));

-- Políticas RLS para messages (apenas admins podem ver)
CREATE POLICY "Admins podem ver todas as mensagens"
ON public.messages
FOR SELECT
USING (has_role(auth.uid(), 'admin_geral'::app_role));

CREATE POLICY "Admins podem inserir mensagens"
ON public.messages
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin_geral'::app_role));

CREATE POLICY "Admins podem atualizar mensagens"
ON public.messages
FOR UPDATE
USING (has_role(auth.uid(), 'admin_geral'::app_role));

-- Trigger para atualizar updated_at em contacts
CREATE TRIGGER update_contacts_updated_at
BEFORE UPDATE ON public.contacts
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();