-- Adicionar coluna status para instâncias
ALTER TABLE public.instancias_whatsapp 
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ativa' 
CHECK (status IN ('ativa', 'inativa', 'deletada'));

-- Atualizar registros existentes baseado no campo ativo
UPDATE public.instancias_whatsapp 
SET status = CASE 
  WHEN ativo = true THEN 'ativa' 
  ELSE 'inativa' 
END
WHERE status = 'ativa'; -- Apenas para os que ainda estão com valor default

-- Criar índice para performance
CREATE INDEX IF NOT EXISTS idx_instancias_whatsapp_status 
ON public.instancias_whatsapp(status);

-- Comentário explicativo
COMMENT ON COLUMN public.instancias_whatsapp.status IS 'Status da instância: ativa, inativa ou deletada. Instâncias deletadas não aparecem nos filtros mas suas mensagens são preservadas.';