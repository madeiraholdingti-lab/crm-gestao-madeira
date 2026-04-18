-- Remover o check constraint antigo
ALTER TABLE public.conversas DROP CONSTRAINT IF EXISTS conversas_status_check;

-- Adicionar novo check constraint com valores atualizados
ALTER TABLE public.conversas ADD CONSTRAINT conversas_status_check 
CHECK (status IN (
  'novo',
  'Aguardando Contato',
  'Em Atendimento', 
  'Finalizado',
  'Perdido'
));

-- Adicionar check constraint para status_qualificacao
ALTER TABLE public.conversas DROP CONSTRAINT IF EXISTS conversas_status_qualificacao_check;
ALTER TABLE public.conversas ADD CONSTRAINT conversas_status_qualificacao_check
CHECK (status_qualificacao IN (
  'Aguardando Triagem',
  'Pronto para Atendimento',
  'Em Qualificação',
  'Qualificado',
  'Desqualificado'
));