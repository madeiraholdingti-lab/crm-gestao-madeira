-- Adicionar campo para configurar se deve ignorar mensagens internas
ALTER TABLE public.config_global 
ADD COLUMN IF NOT EXISTS ignorar_mensagens_internas boolean DEFAULT true;

COMMENT ON COLUMN public.config_global.ignorar_mensagens_internas IS 'Se true, mensagens entre instâncias internas não criam conversas CRM, mas ainda são salvas no histórico';