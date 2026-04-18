-- Adicionar coluna de relacionamento com instancias_whatsapp na tabela messages
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS instancia_whatsapp_id uuid REFERENCES public.instancias_whatsapp(id);

-- Criar índice para melhorar performance de queries
CREATE INDEX IF NOT EXISTS idx_messages_instancia_whatsapp_id 
ON public.messages(instancia_whatsapp_id);

-- Tentar popular os registros existentes baseado no instance_uuid
UPDATE public.messages m
SET instancia_whatsapp_id = i.id
FROM public.instancias_whatsapp i
WHERE m.instance_uuid = i.instancia_id
  AND m.instancia_whatsapp_id IS NULL;