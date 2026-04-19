-- Sprint 1: Visibilidade de atendimento WhatsApp
-- Reset unread_count stale da migração + adicionar tracking de resposta

-- 1. Reset todos os unread_count (valores stale da migração)
UPDATE conversas SET unread_count = 0;

-- 2. Adicionar coluna para tracking de direção da última mensagem
-- NULL = neutro/encerramento (não requer resposta)
-- true = última msg é nossa (aguardando cliente)
-- false = última msg é do contato E requer resposta (aguardando nossa resposta)
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS last_message_from_me BOOLEAN DEFAULT NULL;

-- 3. Backfill: para cada conversa, buscar a mensagem mais recente
-- Se a última mensagem do contato é um padrão de encerramento, marcar como NULL (neutro)
UPDATE conversas c
SET last_message_from_me = sub.needs_response
FROM (
  SELECT DISTINCT ON (conversa_id)
    conversa_id,
    CASE
      WHEN remetente = 'enviada' THEN true
      WHEN remetente = 'recebida' AND conteudo IS NOT NULL AND lower(trim(conteudo)) ~ '^(ok|okay|obrigad[oa]|obg|vlw|valeu|blz|beleza|perfeito|combinado|certo|entendi|show|top|massa|boa|bom dia|boa tarde|boa noite|tá|ta|sim|não|nao|haha|kk|rs|kkk|👍|👌|🙏|😊|😁|❤|🤝|👏)$'
        THEN NULL
      ELSE false
    END AS needs_response
  FROM mensagens
  WHERE conversa_id IS NOT NULL
  ORDER BY conversa_id, created_at DESC
) sub
WHERE c.id = sub.conversa_id;

-- 4. Índice parcial para queries de "aguardando resposta"
CREATE INDEX IF NOT EXISTS idx_conversas_aguardando
  ON conversas(responsavel_atual, ultima_interacao)
  WHERE last_message_from_me = false
  AND status IN ('novo', 'Aguardando Contato', 'Em Atendimento');
