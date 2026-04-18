-- Remover o CHECK constraint antigo de remetente
ALTER TABLE public.mensagens DROP CONSTRAINT IF EXISTS mensagens_remetente_check;

-- Criar novo CHECK constraint com os valores 'recebida' e 'enviada'
ALTER TABLE public.mensagens 
ADD CONSTRAINT mensagens_remetente_check 
CHECK (remetente IN ('recebida', 'enviada'));