-- Limpar todos os dados de mensagens, conversas e instâncias
-- TRUNCATE é mais eficiente e CASCADE cuida das foreign keys

-- Desabilitar triggers temporariamente para performance
SET session_replication_role = replica;

-- Limpar tabelas de mensagens
TRUNCATE TABLE mensagens CASCADE;
TRUNCATE TABLE messages CASCADE;
TRUNCATE TABLE message_reactions CASCADE;

-- Limpar conversas
TRUNCATE TABLE conversas CASCADE;

-- Limpar eventos de instância
TRUNCATE TABLE instance_events CASCADE;

-- Limpar histórico e números
TRUNCATE TABLE historico_numero_instancia CASCADE;
TRUNCATE TABLE numeros_whatsapp CASCADE;

-- Limpar disparos agendados
TRUNCATE TABLE scheduled_messages_log CASCADE;
TRUNCATE TABLE scheduled_messages CASCADE;

-- Limpar campanhas
TRUNCATE TABLE campanha_envios CASCADE;
TRUNCATE TABLE envios_disparo CASCADE;
TRUNCATE TABLE lead_campanha_historico CASCADE;
TRUNCATE TABLE campanhas_disparo CASCADE;

-- Limpar instâncias
TRUNCATE TABLE instancias_whatsapp CASCADE;

-- Reativar triggers
SET session_replication_role = DEFAULT;