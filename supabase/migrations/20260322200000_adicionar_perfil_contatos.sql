-- Fase 3: Campos de perfil profissional nos contatos
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS perfil_profissional text,
  ADD COLUMN IF NOT EXISTS especialidade text,
  ADD COLUMN IF NOT EXISTS instituicao text,
  ADD COLUMN IF NOT EXISTS perfil_sugerido_ia text,
  ADD COLUMN IF NOT EXISTS perfil_confirmado boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS classificado_em timestamptz;

-- Índice para filtros de disparo por perfil
CREATE INDEX IF NOT EXISTS idx_contacts_perfil
  ON contacts(perfil_profissional);

-- Filtros de perfil nas campanhas de disparo
ALTER TABLE campanhas_disparo
  ADD COLUMN IF NOT EXISTS filtro_perfil_profissional text[],
  ADD COLUMN IF NOT EXISTS filtro_especialidade text[];
