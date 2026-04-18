
-- 1. Adicionar constraint UNIQUE para evitar que o mesmo lead seja adicionado mais de uma vez na mesma campanha
-- Primeiro, limpar duplicatas existentes (manter apenas o registro mais recente)
DELETE FROM campanha_envios a
USING campanha_envios b
WHERE a.lead_id = b.lead_id 
  AND a.campanha_id = b.campanha_id 
  AND a.created_at < b.created_at;

-- 2. Criar a constraint unique
ALTER TABLE campanha_envios 
ADD CONSTRAINT unique_lead_per_campanha UNIQUE (lead_id, campanha_id);
