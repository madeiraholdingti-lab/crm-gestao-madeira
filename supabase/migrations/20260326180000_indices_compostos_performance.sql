-- Índices compostos para performance (Fase 1)
-- Otimizam as queries mais frequentes do SDR Zap e Hub

-- Conversas: filtro por instância + status (usado no SDR Zap Kanban)
CREATE INDEX IF NOT EXISTS idx_conversas_instancia_status
  ON conversas(instancia_id, status);

-- Conversas: filtro por current_instance + status (usado no filtro de instâncias)
CREATE INDEX IF NOT EXISTS idx_conversas_current_instance_status
  ON conversas(current_instance_id, status);

-- Messages: busca por instância ordenada por data (usado no chat)
CREATE INDEX IF NOT EXISTS idx_messages_instance_created
  ON messages(instance_id, created_at DESC);

-- Messages: busca por instancia_whatsapp_id ordenada por data
CREATE INDEX IF NOT EXISTS idx_messages_instancia_wa_created
  ON messages(instancia_whatsapp_id, created_at DESC);
