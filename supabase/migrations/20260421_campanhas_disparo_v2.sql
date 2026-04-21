-- Campanhas v2 — engine genérico multi-tipo (prospecção / evento / reativação / etc)
-- Adiciona só o que faltava. Campos existentes (envios_por_dia, intervalo_*,
-- horario_*, dias_semana, proximo_envio_em) permanecem como source-of-truth.

ALTER TABLE public.campanhas_disparo
  ADD COLUMN IF NOT EXISTS briefing_ia JSONB NULL,
  ADD COLUMN IF NOT EXISTS chip_ids UUID[] NULL,
  ADD COLUMN IF NOT EXISTS spintax_ativo BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;

-- CHECK constraint em 'tipo' (valor default já é null/texto livre hoje)
-- Aceita os 6 tipos canônicos + 'custom' (fallback). Ignore rows com tipo null.
-- Normaliza tipos antigos pro enum ANTES de criar o CHECK
UPDATE public.campanhas_disparo SET tipo = 'prospeccao'
 WHERE tipo IN ('prospecao','prospeccao-medica','prospec','captacao');
UPDATE public.campanhas_disparo SET tipo = 'divulgacao'
 WHERE tipo IN ('divulg','broadcast');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'campanhas_disparo' AND constraint_name = 'campanhas_disparo_tipo_check'
  ) THEN
    ALTER TABLE public.campanhas_disparo
      ADD CONSTRAINT campanhas_disparo_tipo_check
      CHECK (tipo IS NULL OR tipo IN (
        'prospeccao', 'evento', 'reativacao', 'divulgacao',
        'pos_operatorio', 'custom'
      ));
  END IF;
END $$;

-- Index pra queries do cron (pegar campanhas elegíveis agora)
CREATE INDEX IF NOT EXISTS idx_campanhas_disparo_ativa_proximo
  ON public.campanhas_disparo (ativo, status, proximo_envio_em)
  WHERE status IN ('ativa', 'em_andamento') AND ativo = true;

COMMENT ON COLUMN public.campanhas_disparo.briefing_ia IS
  'JSONB com config da IA: persona, fluxo, objeções, handoff. Opcional.';
COMMENT ON COLUMN public.campanhas_disparo.chip_ids IS
  'Array de instancias_whatsapp.id pra rotation + fallback. Se null, usa instancia_id singular.';
COMMENT ON COLUMN public.campanhas_disparo.spintax_ativo IS
  'Se true, processa {Bom dia|Olá|E aí} na mensagem. Default true.';
COMMENT ON COLUMN public.campanhas_disparo.ativo IS
  'Soft-disable sem mudar status. Se false, cron ignora mesmo se status=ativa.';
