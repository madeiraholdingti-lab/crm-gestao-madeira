-- Histórico estruturado da conversa (humano + IA) por envio,
-- e maturidade do lead avaliada pela IA.
-- Permite que a IA pegue contexto sem JOIN entre messages+contacts+envios,
-- e dá base pra handoff automático em "quente".

ALTER TABLE public.campanha_envios
  ADD COLUMN IF NOT EXISTS historico_conversa JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS maturidade TEXT NULL,
  ADD COLUMN IF NOT EXISTS handoff_disparado BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS handoff_disparado_em TIMESTAMPTZ NULL;

-- maturidade: frio (apenas leu/respondeu superficial), morno (engajamento),
--             quente (objeções respondidas + sinais de fechamento)
ALTER TABLE public.campanha_envios
  DROP CONSTRAINT IF EXISTS campanha_envios_maturidade_check;
ALTER TABLE public.campanha_envios
  ADD CONSTRAINT campanha_envios_maturidade_check
  CHECK (maturidade IS NULL OR maturidade IN ('frio','morno','quente'));

-- Índice pra dashboard "leads quentes pendentes de handoff"
CREATE INDEX IF NOT EXISTS idx_envios_quente_handoff
  ON public.campanha_envios (campanha_id, maturidade)
  WHERE maturidade = 'quente' AND handoff_disparado = false;
