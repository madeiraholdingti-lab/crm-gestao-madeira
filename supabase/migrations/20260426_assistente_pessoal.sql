-- Suporte ao agente pessoal do Maikon (assistente-maikon-pessoal).
-- Roda em chip WhatsApp dedicado, conversa só com whitelist (Maikon),
-- usa Claude Sonnet 4.6 com tool use pra operar o CRM por linguagem natural.
--
-- Tabelas:
--   assistente_memoria   — preferências/fatos longos prazo descobertos pelo agente
--   assistente_audit_log — registro de cada turno (entrada, tools chamadas, saída)
--   assistente_g4_chunks — chunks vetorizados das aulas G4 (RAG, fase 2 — placeholder)

-- Memória de longo prazo do agente. Ex: "Maikon prefere mensagens curtas",
-- "Maikon trata todos como 'doutor'", "Maikon opera Itajaí + Brusque".
-- O próprio agente pode chamar uma tool 'salvar_memoria' pra registrar
-- o que aprendeu sobre o usuário, e 'buscar_memoria' pra consultar.
CREATE TABLE IF NOT EXISTS public.assistente_memoria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  chave TEXT NOT NULL,
  valor TEXT NOT NULL,
  categoria TEXT,  -- preferencia | fato | contato | rotina
  importancia INT NOT NULL DEFAULT 1 CHECK (importancia BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, chave)
);

CREATE INDEX IF NOT EXISTS idx_assistente_memoria_user
  ON public.assistente_memoria(user_id, importancia DESC);

-- Auditoria: 1 linha por mensagem do user. Guarda input, tools chamadas
-- (com args + result), resposta final, custo, latência. Importante pra
-- debug e pra Maikon revisar o que o agente fez em seu nome.
CREATE TABLE IF NOT EXISTS public.assistente_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  wa_message_id TEXT,
  input_text TEXT NOT NULL,
  input_type TEXT NOT NULL DEFAULT 'text',  -- text | audio | image
  tool_calls JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{name, input, result, error?}]
  resposta_final TEXT,
  modelo TEXT,
  tokens_input INT,
  tokens_output INT,
  duracao_ms INT,
  erro TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assistente_audit_user_recent
  ON public.assistente_audit_log(user_id, created_at DESC);

-- Placeholder pra RAG das aulas G4 (fase 2). Estrutura pgvector.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.assistente_g4_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aula_titulo TEXT NOT NULL,
  aula_url TEXT,
  chunk_idx INT NOT NULL,
  texto TEXT NOT NULL,
  -- 1536 = OpenAI text-embedding-3-small (barato, ótima qualidade)
  embedding vector(1536),
  timestamp_inicio_seg INT,  -- pra deep-link do tipo "aula X aos 12:34"
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (aula_titulo, chunk_idx)
);

-- Index ivfflat pra busca rápida por similaridade.
-- lists=100 é bom pra <100k chunks; aumentar se Maikon indexar muitas aulas.
CREATE INDEX IF NOT EXISTS idx_assistente_g4_embedding
  ON public.assistente_g4_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- RLS: só admin_geral pode ver dados (por enquanto Maikon é o único user)
ALTER TABLE public.assistente_memoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistente_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistente_g4_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_proprio_memoria" ON public.assistente_memoria
  FOR SELECT USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin_geral'::app_role));
CREATE POLICY "user_proprio_audit" ON public.assistente_audit_log
  FOR SELECT USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin_geral'::app_role));
CREATE POLICY "admin_g4_chunks" ON public.assistente_g4_chunks
  FOR SELECT USING (has_role(auth.uid(), 'admin_geral'::app_role));
