-- Separação clara entre chips de atendimento (clínica/consultas) e chips de
-- disparo (prospecção em massa). Decisão estratégica do Maikon: se chip de
-- disparo for banido, atendimento NÃO pode parar.
--
-- finalidade:
--   'atendimento' — Maikon, Iza, Mariana, Consultório (NUNCA usar pra disparo)
--   'disparo'     — chips dedicados pra campanhas (podem queimar e ser trocados)
--   'geral'       — chips usados pra ambos (caso especial, evitar)

ALTER TABLE public.instancias_whatsapp
  ADD COLUMN IF NOT EXISTS finalidade TEXT;

ALTER TABLE public.instancias_whatsapp
  DROP CONSTRAINT IF EXISTS instancias_whatsapp_finalidade_check;
ALTER TABLE public.instancias_whatsapp
  ADD CONSTRAINT instancias_whatsapp_finalidade_check
  CHECK (finalidade IS NULL OR finalidade IN ('atendimento','disparo','geral'));

-- Classifica chips conhecidos
UPDATE public.instancias_whatsapp SET finalidade='atendimento'
WHERE nome_instancia IN ('Maikon GSS','isadoraVolek','Mariana-Chiarello','Consultorio');

UPDATE public.instancias_whatsapp SET finalidade='disparo'
WHERE nome_instancia ILIKE 'disparos%'
   OR nome_instancia ILIKE 'bruna wpp%'
   OR nome_instancia IN ('PacientesRafaela','Rafaela','Raphaela','RUBI','Disparos3367','Amanda Prospecção');

-- Index pra filtrar rápido no wizard
CREATE INDEX IF NOT EXISTS idx_instancias_finalidade_status
  ON public.instancias_whatsapp(finalidade, status)
  WHERE finalidade IS NOT NULL;

-- Limpeza de duplicados não pode deletar registros referenciados por
-- messages/conversas (FK). Em vez disso, esconde os duplicados quebrados
-- da UI marcando-os como 'oculta' e tirando da consulta padrão.
-- Critério: status='deletada' E instancia_id não é UUID válido (lixo de seed antigo).

UPDATE public.instancias_whatsapp
SET ativo = false
WHERE status = 'deletada'
  AND ativo = true
  AND instancia_id IS NOT NULL
  AND instancia_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
