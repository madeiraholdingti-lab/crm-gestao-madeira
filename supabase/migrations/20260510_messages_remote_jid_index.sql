-- Índice composto pra acelerar buscar_grupo + qualquer query filtrando por
-- JID de grupo + período de tempo.
--
-- Antes: tabela messages com 105k rows / 3.6 GB → seq scan paralelo levava
-- 11.6s (estourava statement_timeout do Supabase REST). Tool buscar_grupo
-- ficava intermitentemente 'canceling statement due to statement timeout'.
--
-- Depois: index scan em 0.16 ms (74.000× mais rápido). 6 buffers (memória)
-- ao invés de 188.859 buffers (disco).
--
-- Query típica que vai usar este índice:
--   SELECT ... FROM messages
--   WHERE raw_payload->'key'->>'remoteJid' IN ('120363xxx@g.us', ...)
--     AND created_at >= NOW() - INTERVAL 'X days'
--   ORDER BY created_at DESC
--   LIMIT N

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_remote_jid_created
  ON public.messages ((raw_payload->'key'->>'remoteJid'), created_at DESC);

-- Tamanho do índice ~3.9 MB pra 105k rows. Trade-off aceitável:
-- - Custo: ~0.04% do tamanho da tabela
-- - Benefício: queries de grupo virtualmente instantâneas
