-- Callback de resposta: quando lead responde, engine marca em_conversa
--
-- Adiciona coluna respondeu_em em campanha_envios + amplia enum de status.
-- Status flow: pendente → enviado → em_conversa → (qualificado | descartado)
--              (ou direto: pendente → erro | nozap)

ALTER TABLE public.campanha_envios
  ADD COLUMN IF NOT EXISTS respondeu_em TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS primeira_msg_contato_em TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_campanha_envios_contato_status
  ON public.campanha_envios (lead_id, status)
  WHERE status IN ('enviado', 'em_conversa');

-- View: envios aguardando resposta IA (em_conversa sem processamento recente)
CREATE OR REPLACE VIEW public.vw_envios_aguardando_ia AS
SELECT
  e.id AS envio_id,
  e.campanha_id,
  e.lead_id,
  e.telefone,
  e.respondeu_em,
  e.primeira_msg_contato_em,
  c.nome AS campanha_nome,
  c.briefing_ia,
  c.status AS campanha_status
FROM public.campanha_envios e
JOIN public.campanhas_disparo c ON c.id = e.campanha_id
WHERE e.status = 'em_conversa'
  AND e.respondeu_em > now() - interval '24 hours'
  AND c.status IN ('ativa', 'em_andamento')
  AND c.briefing_ia IS NOT NULL;

COMMENT ON COLUMN public.campanha_envios.respondeu_em IS
  'Timestamp da PRIMEIRA resposta do lead após envio. Dispara flow de IA.';
COMMENT ON COLUMN public.campanha_envios.primeira_msg_contato_em IS
  'Última msg do contato recebida (atualiza a cada resposta). Anti-debounce.';
