-- Adicionar campos para controle de mensagens não lidas e status
ALTER TABLE conversas 
ADD COLUMN IF NOT EXISTS unread_count INTEGER DEFAULT 0;

-- Adicionar status à tabela mensagens (para compatibilidade com Evolution API)
ALTER TABLE mensagens 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PENDING';

-- Adicionar índice para melhor performance nas consultas de não lidas
CREATE INDEX IF NOT EXISTS idx_mensagens_conversa_lida 
ON mensagens(conversa_id, lida);

-- Adicionar índice para status
CREATE INDEX IF NOT EXISTS idx_mensagens_status 
ON mensagens(status);

-- Comentários para documentação
COMMENT ON COLUMN conversas.unread_count IS 'Contador de mensagens não lidas para esta conversa';
COMMENT ON COLUMN mensagens.status IS 'Status da mensagem: PENDING, SERVER_ACK, DELIVERED, READ';