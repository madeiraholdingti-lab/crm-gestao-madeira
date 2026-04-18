-- FASE 1: SCHEMA CHANGES

-- 1.1 - Adicionar contact_id na tabela conversas
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES contacts(id);

-- Criar índice para performance
CREATE INDEX IF NOT EXISTS idx_conversas_contact_id ON conversas(contact_id);

-- Popular contact_id existente baseado em numero_contato
UPDATE conversas c
SET contact_id = ct.id
FROM contacts ct
WHERE c.numero_contato = ct.phone AND c.contact_id IS NULL;

-- 1.2 - Adicionar wa_message_id na tabela mensagens
ALTER TABLE mensagens ADD COLUMN IF NOT EXISTS wa_message_id text;

-- Criar índice único para evitar duplicatas
CREATE UNIQUE INDEX IF NOT EXISTS idx_mensagens_wa_message_id ON mensagens(wa_message_id) WHERE wa_message_id IS NOT NULL;

-- FASE 4: LIMPEZA DE DADOS

-- Limpar contacts com name = jid ou lid
UPDATE contacts 
SET name = NULL 
WHERE name LIKE '%@s.whatsapp.net%' OR name LIKE '%@lid%' OR name LIKE '%@g.us%';

-- Atualizar nome_contato nas conversas para refletir nomes corretos
UPDATE conversas c
SET nome_contato = COALESCE(ct.name, ct.phone)
FROM contacts ct
WHERE c.contact_id = ct.id;

-- Popular contact_id em conversas que ainda não têm (por segurança)
UPDATE conversas c
SET contact_id = ct.id
FROM contacts ct
WHERE c.numero_contato = ct.phone AND c.contact_id IS NULL;