-- RAG completo das aulas G4 do Maikon.
-- Estende a tabela placeholder assistente_g4_chunks (criada em 20260426)
-- com metadados de aula (assistente_g4_aulas) e RPCs de busca/listagem.
--
-- Fluxo de ingestão (edge indexar-aula-g4):
--   1. Recebe áudio (base64 do WhatsApp) ou file_id do Drive
--   2. Whisper transcreve em pt-BR
--   3. Chunking 800 tokens, overlap 150
--   4. Embeddings batch (text-embedding-3-small)
--   5. INSERT em assistente_g4_aulas + N rows em assistente_g4_chunks
--
-- Consulta (tool buscar_aulas_g4):
--   1. Embedding da pergunta do Maikon
--   2. RPC buscar_aulas_g4_similar(query_emb, top_k) — cosine similarity
--   3. Retorna trechos com título da aula + timestamp pra deep-link

BEGIN;

-- ============================================================================
-- 1. Tabela de metadados de aulas indexadas
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.assistente_g4_aulas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  -- Origem: como o áudio chegou no sistema.
  --   audio_whatsapp - Maikon mandou áudio direto no chip
  --   drive_video    - vídeo extraído de uma pasta do Google Drive dele
  --   upload_manual  - upload via SQL/CLI
  fonte TEXT NOT NULL CHECK (fonte IN ('audio_whatsapp', 'drive_video', 'upload_manual')),
  -- Identificadores externos pra evitar reindexar
  drive_file_id TEXT,
  wa_message_id TEXT,
  duracao_seg INT,
  total_chunks INT NOT NULL DEFAULT 0,
  -- Texto completo da transcrição. Caro mas útil pra debug e re-chunk se mudar parâmetros.
  transcricao_completa TEXT,
  -- Status do pipeline
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'transcrevendo', 'indexando', 'concluida', 'erro')),
  erro TEXT,
  custo_estimado_brl NUMERIC(10, 4),
  indexada_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Evita reindexar mesmo arquivo Drive pra mesmo user
  UNIQUE (user_id, drive_file_id),
  UNIQUE (user_id, wa_message_id)
);

CREATE INDEX IF NOT EXISTS idx_g4_aulas_user_status
  ON public.assistente_g4_aulas(user_id, status, created_at DESC);

-- ============================================================================
-- 2. Adicionar FK aula_id em assistente_g4_chunks
-- ============================================================================
ALTER TABLE public.assistente_g4_chunks
  ADD COLUMN IF NOT EXISTS aula_id UUID REFERENCES public.assistente_g4_aulas(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_g4_chunks_aula
  ON public.assistente_g4_chunks(aula_id);

-- ============================================================================
-- 3. RLS
-- ============================================================================
ALTER TABLE public.assistente_g4_aulas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_proprio_g4_aulas" ON public.assistente_g4_aulas;
CREATE POLICY "user_proprio_g4_aulas"
  ON public.assistente_g4_aulas
  FOR SELECT
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin_geral'::app_role));

-- ============================================================================
-- 4. RPC pra busca semântica
--    SECURITY DEFINER porque service_role chama do edge.
--    Filtra por user_id (Maikon não vê aulas de outros e vice-versa).
-- ============================================================================
-- Recebemos p_query_emb como TEXT (literal "[0.1,0.2,...]") porque o cliente
-- supabase-js não tem tipo vector — fica trivial passar como string e cast aqui.
CREATE OR REPLACE FUNCTION public.buscar_aulas_g4_similar(
  p_user_id UUID,
  p_query_emb TEXT,
  p_top_k INT DEFAULT 5,
  p_min_similarity FLOAT DEFAULT 0.65
)
RETURNS TABLE (
  chunk_id UUID,
  aula_id UUID,
  aula_titulo TEXT,
  texto TEXT,
  timestamp_inicio_seg INT,
  similarity FLOAT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  WITH q AS (SELECT p_query_emb::extensions.vector(1536) AS emb)
  SELECT
    c.id AS chunk_id,
    c.aula_id,
    a.titulo AS aula_titulo,
    c.texto,
    c.timestamp_inicio_seg,
    1 - (c.embedding <=> q.emb) AS similarity
  FROM assistente_g4_chunks c
  JOIN assistente_g4_aulas a ON a.id = c.aula_id
  CROSS JOIN q
  WHERE a.user_id = p_user_id
    AND a.status = 'concluida'
    AND c.embedding IS NOT NULL
    AND (1 - (c.embedding <=> q.emb)) >= p_min_similarity
  ORDER BY c.embedding <=> q.emb
  LIMIT p_top_k;
$$;

REVOKE ALL ON FUNCTION public.buscar_aulas_g4_similar(UUID, TEXT, INT, FLOAT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_aulas_g4_similar(UUID, TEXT, INT, FLOAT) TO service_role;

-- ============================================================================
-- 5. RPC pra listar aulas (sem chunks, pra agente responder "quais aulas tenho")
-- ============================================================================
CREATE OR REPLACE FUNCTION public.listar_aulas_g4_indexadas(
  p_user_id UUID,
  p_status TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  titulo TEXT,
  fonte TEXT,
  duracao_seg INT,
  total_chunks INT,
  status TEXT,
  indexada_em TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, titulo, fonte, duracao_seg, total_chunks, status, indexada_em
  FROM assistente_g4_aulas
  WHERE user_id = p_user_id
    AND (p_status IS NULL OR status = p_status)
  ORDER BY indexada_em DESC NULLS LAST, created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.listar_aulas_g4_indexadas(UUID, TEXT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.listar_aulas_g4_indexadas(UUID, TEXT) TO service_role, authenticated;

-- ============================================================================
-- 6. Trigger updated_at
-- ============================================================================
DROP TRIGGER IF EXISTS update_g4_aulas_updated_at ON public.assistente_g4_aulas;
CREATE TRIGGER update_g4_aulas_updated_at
  BEFORE UPDATE ON public.assistente_g4_aulas
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

COMMIT;
