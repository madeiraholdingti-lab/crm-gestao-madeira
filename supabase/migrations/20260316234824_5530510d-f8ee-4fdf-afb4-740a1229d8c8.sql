
-- 1. Adicionar coluna especialidade_id na tabela leads
ALTER TABLE public.leads
ADD COLUMN especialidade_id uuid REFERENCES public.especialidades(id) ON DELETE SET NULL;

-- 2. Popular especialidade_id a partir do texto existente
UPDATE public.leads l
SET especialidade_id = e.id
FROM public.especialidades e
WHERE LOWER(TRIM(l.especialidade)) = LOWER(TRIM(e.nome))
  AND l.especialidade IS NOT NULL
  AND l.especialidade != '';

-- 3. Criar índice para busca rápida por especialidade_id
CREATE INDEX idx_leads_especialidade_id ON public.leads(especialidade_id);

-- 4. Criar índice composto para filtros comuns
CREATE INDEX idx_leads_tipo_especialidade ON public.leads(tipo_lead, especialidade_id);
