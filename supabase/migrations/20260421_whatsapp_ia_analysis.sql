-- Análise de conversa com IA (Gemini) — Dor #6 da reunião:
-- "Maikon quer que a IA qualifique conversas pra ele bater o olho e saber
--  sentimento, urgência e sugestão de perfil profissional do contato."
--
-- Uma linha POR análise (histórico preservado pra A/B com modelos futuros).
-- A mais recente é a que o UI mostra.

CREATE TABLE IF NOT EXISTS public.whatsapp_conversa_analise (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id UUID NOT NULL REFERENCES public.conversas(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  analyzed_by_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Saídas da IA
  sentimento TEXT NOT NULL CHECK (sentimento IN ('positivo','neutro','negativo','urgente','frustrado','curioso')),
  confianca NUMERIC(3,2) NOT NULL CHECK (confianca >= 0 AND confianca <= 1),
  resumo TEXT NOT NULL,
  pontos_chave TEXT[] NOT NULL DEFAULT '{}',
  proxima_acao_sugerida TEXT,
  perfil_sugerido TEXT, -- ex: 'cirurgiao_cardiaco', 'paciente', 'gestor_hospital'
  perfil_sugerido_confianca NUMERIC(3,2),
  urgencia_nivel INT CHECK (urgencia_nivel BETWEEN 1 AND 5),

  -- Metadata
  model_version TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
  tokens_usados INT,
  mensagens_analisadas INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_wa_analise_conversa_recente
  ON public.whatsapp_conversa_analise (conversa_id, analyzed_at DESC);
CREATE INDEX idx_wa_analise_contact
  ON public.whatsapp_conversa_analise (contact_id) WHERE contact_id IS NOT NULL;

-- RLS: todo usuário autenticado pode LER (igual conversas); só service_role insere
ALTER TABLE public.whatsapp_conversa_analise ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_can_read_analysis" ON public.whatsapp_conversa_analise
  FOR SELECT USING (auth.uid() IS NOT NULL);
