-- Adicionar campo de status de qualificação na tabela conversas
ALTER TABLE public.conversas 
ADD COLUMN status_qualificacao text DEFAULT 'Aguardando Triagem';

-- Adicionar campo de tags para suportar tags múltiplas
ALTER TABLE public.conversas 
ADD COLUMN tags text[] DEFAULT '{}';

-- Criar índice para melhorar performance de busca por tags
CREATE INDEX idx_conversas_tags ON public.conversas USING GIN(tags);

-- Criar índice para status de qualificação
CREATE INDEX idx_conversas_status_qualificacao ON public.conversas(status_qualificacao);