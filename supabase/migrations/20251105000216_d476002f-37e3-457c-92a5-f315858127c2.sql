-- Adicionar campo anotacao_transferencia na tabela conversas
ALTER TABLE public.conversas
ADD COLUMN anotacao_transferencia text;