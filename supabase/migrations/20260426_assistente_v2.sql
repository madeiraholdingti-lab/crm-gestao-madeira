-- Robustez v2 do agente pessoal Maikon: compactação de histórico, crons
-- gerenciáveis pelo agente, sistema de aprendizado por correção, e
-- estrutura pra feature de versículo diário.

-- ============================================================================
-- 1. Histórico de conversa COMPACTADO
--    Em vez de mandar 100 turns inteiros pro Claude (caro), guardamos resumos
--    de blocos antigos. system prompt no edge passa a injetar:
--      [SUMÁRIO 30 dias]: resumo
--      [SUMÁRIO últimos 7 dias]: resumo
--      [TURNOS RECENTES]: últimos 8 turns crus
--    Compactação roda em cron 1x/dia.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.assistente_conversa_resumo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- janela: 'dia' (24h), 'semana' (7d), 'mes' (30d), 'longo' (>30d agregado)
  janela TEXT NOT NULL CHECK (janela IN ('dia','semana','mes','longo')),
  periodo_inicio TIMESTAMPTZ NOT NULL,
  periodo_fim TIMESTAMPTZ NOT NULL,
  resumo TEXT NOT NULL,
  fatos_extraidos JSONB DEFAULT '[]'::jsonb,
  num_turnos_resumidos INT,
  tokens_economizados INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, janela, periodo_inicio)
);

CREATE INDEX IF NOT EXISTS idx_resumo_user_janela
  ON public.assistente_conversa_resumo(user_id, janela, periodo_fim DESC);

-- ============================================================================
-- 2. Crons gerenciáveis pelo próprio agente.
--    O agente tem tool 'criar_cron' que insere aqui. pg_cron worker varre
--    essa tabela a cada minuto e dispara os ativos.
--    Casos: versículo diário às 6h, lembrete recorrente, follow-up,
--    relatório matinal, etc.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.assistente_crons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  descricao TEXT,
  -- Tipo controla qual handler executa:
  --  'mensagem' - manda texto pro WhatsApp do user (via Evolution)
  --  'briefing' - chama o assistente com prompt e envia resultado
  --  'versiculo' - feature dedicada (busca verso, gera reflexão, manda)
  tipo TEXT NOT NULL CHECK (tipo IN ('mensagem','briefing','versiculo')),
  -- Cron expression (5 campos: min hora dia mes dia_semana). TZ America/Sao_Paulo.
  cron_expression TEXT NOT NULL,
  -- Payload específico do tipo (texto, prompt, etc)
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ativo BOOLEAN NOT NULL DEFAULT true,
  ultima_execucao_em TIMESTAMPTZ,
  proxima_execucao_em TIMESTAMPTZ,
  total_execucoes INT NOT NULL DEFAULT 0,
  ultima_falha TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assistente_crons_due
  ON public.assistente_crons(proxima_execucao_em)
  WHERE ativo = true;

-- ============================================================================
-- 3. Aprendizado por correção
--    Quando o Maikon corrige o agente ("não, da próxima vez faz Y em vez de X"),
--    o agente registra aqui via tool 'registrar_correcao'. System prompt do
--    próximo turno injeta correções relevantes — assim o agente "aprende".
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.assistente_correcoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  contexto TEXT NOT NULL,         -- o que o agente fez/falou
  correcao TEXT NOT NULL,         -- o que o user pediu pra fazer diferente
  categoria TEXT,                 -- tom, formato, conteudo, processo
  aplicacao TEXT,                 -- "quando criar tarefa", "ao listar agenda", etc.
  ativa BOOLEAN NOT NULL DEFAULT true,
  vezes_aplicada INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assistente_correcoes_ativas
  ON public.assistente_correcoes(user_id, created_at DESC)
  WHERE ativa = true;

-- ============================================================================
-- 4. RPC pra agente buscar histórico compactado pro próximo turno.
--    Retorna sumários (30d, 7d, 1d) + últimos N turnos crus.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.contexto_assistente(
  p_user_id UUID,
  p_turnos_recentes INT DEFAULT 8
)
RETURNS TABLE (
  resumo_longo TEXT,
  resumo_mes TEXT,
  resumo_semana TEXT,
  correcoes_ativas JSONB,
  memorias_top JSONB,
  turnos_recentes JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (SELECT resumo FROM assistente_conversa_resumo
       WHERE user_id = p_user_id AND janela = 'longo'
       ORDER BY periodo_fim DESC LIMIT 1) AS resumo_longo,
    (SELECT resumo FROM assistente_conversa_resumo
       WHERE user_id = p_user_id AND janela = 'mes'
       ORDER BY periodo_fim DESC LIMIT 1) AS resumo_mes,
    (SELECT resumo FROM assistente_conversa_resumo
       WHERE user_id = p_user_id AND janela = 'semana'
       ORDER BY periodo_fim DESC LIMIT 1) AS resumo_semana,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'aplicacao', aplicacao, 'correcao', correcao
       ) ORDER BY created_at DESC), '[]'::jsonb)
       FROM assistente_correcoes
       WHERE user_id = p_user_id AND ativa = true
       LIMIT 20) AS correcoes_ativas,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'chave', chave, 'valor', valor, 'categoria', categoria
       ) ORDER BY importancia DESC), '[]'::jsonb)
       FROM assistente_memoria
       WHERE user_id = p_user_id
       LIMIT 15) AS memorias_top,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'q', input_text, 'a', resposta_final, 'em', created_at
       ) ORDER BY created_at ASC), '[]'::jsonb)
       FROM (
         SELECT input_text, resposta_final, created_at
         FROM assistente_audit_log
         WHERE user_id = p_user_id AND resposta_final IS NOT NULL
         ORDER BY created_at DESC LIMIT p_turnos_recentes
       ) recent) AS turnos_recentes;
$$;

REVOKE ALL ON FUNCTION public.contexto_assistente(UUID, INT) FROM public;
GRANT EXECUTE ON FUNCTION public.contexto_assistente(UUID, INT) TO authenticated, service_role;
