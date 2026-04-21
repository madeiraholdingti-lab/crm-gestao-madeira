-- disparos_logs — observabilidade do engine de campanhas v2
--
-- 1 linha por tentativa de envio (seja sucesso, falha, nozap, skip).
-- Usado pra: (a) dashboard de saúde, (b) auto-pause de chip,
-- (c) debugging quando alguma campanha não dispara.

CREATE TABLE IF NOT EXISTS public.disparos_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id UUID REFERENCES public.campanhas_disparo(id) ON DELETE CASCADE,
  campanha_envio_id UUID REFERENCES public.campanha_envios(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  instancia_id UUID REFERENCES public.instancias_whatsapp(id) ON DELETE SET NULL,
  telefone TEXT,
  mensagem_enviada TEXT,
  resultado TEXT NOT NULL CHECK (resultado IN ('enviado','erro','nozap','skip')),
  http_status INT,
  erro_texto TEXT,
  duracao_ms INT,
  tentativa INT DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_disparos_logs_campanha_recente
  ON public.disparos_logs (campanha_id, created_at DESC);
CREATE INDEX idx_disparos_logs_chip_recente
  ON public.disparos_logs (instancia_id, created_at DESC);
CREATE INDEX idx_disparos_logs_resultado
  ON public.disparos_logs (resultado, created_at DESC);

-- RLS
ALTER TABLE public.disparos_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_logs" ON public.disparos_logs
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- View: saúde do chip nas últimas 24h (usado pra auto-pause + dashboard)
CREATE OR REPLACE VIEW public.vw_chip_saude_24h AS
SELECT
  iw.id AS instancia_id,
  iw.nome_instancia,
  iw.numero_chip,
  iw.cor_identificacao,
  count(*) FILTER (WHERE l.resultado = 'enviado') AS enviados,
  count(*) FILTER (WHERE l.resultado = 'erro') AS erros,
  count(*) FILTER (WHERE l.resultado = 'nozap') AS nozap,
  count(*) AS total,
  CASE
    WHEN count(*) = 0 THEN 0
    ELSE round(100.0 * count(*) FILTER (WHERE l.resultado = 'erro') / count(*), 1)
  END AS taxa_erro_pct,
  max(l.created_at) AS ultimo_uso
FROM public.instancias_whatsapp iw
LEFT JOIN public.disparos_logs l
  ON l.instancia_id = iw.id AND l.created_at > now() - interval '24 hours'
WHERE iw.ativo
GROUP BY iw.id, iw.nome_instancia, iw.numero_chip, iw.cor_identificacao;

COMMENT ON TABLE public.disparos_logs IS
  'Log atômico de cada tentativa de envio. Alimenta dashboard e auto-pause.';
