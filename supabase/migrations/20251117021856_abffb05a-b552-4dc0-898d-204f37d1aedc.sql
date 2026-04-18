-- Adicionar colunas para rastrear instância de origem e instância atual de resposta
ALTER TABLE public.conversas 
  ADD COLUMN IF NOT EXISTS orig_instance_id uuid REFERENCES public.instancias_whatsapp(id),
  ADD COLUMN IF NOT EXISTS current_instance_id uuid REFERENCES public.instancias_whatsapp(id);

-- Criar índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_conversas_orig_instance ON public.conversas(orig_instance_id);
CREATE INDEX IF NOT EXISTS idx_conversas_current_instance ON public.conversas(current_instance_id);

-- Comentários para documentação
COMMENT ON COLUMN public.conversas.orig_instance_id IS 'Instância pela qual o lead entrou (origem)';
COMMENT ON COLUMN public.conversas.current_instance_id IS 'Instância pela qual a próxima mensagem será enviada';