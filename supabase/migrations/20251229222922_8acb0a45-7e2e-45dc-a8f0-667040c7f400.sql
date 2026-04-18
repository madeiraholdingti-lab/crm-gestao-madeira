-- Adicionar campo tipo na tabela campanhas_disparo
ALTER TABLE public.campanhas_disparo 
ADD COLUMN tipo TEXT DEFAULT 'prospecção';

-- Comentário para documentar os valores possíveis
COMMENT ON COLUMN public.campanhas_disparo.tipo IS 'Tipo da campanha: prospecção, informativo, reengajamento, follow-up';