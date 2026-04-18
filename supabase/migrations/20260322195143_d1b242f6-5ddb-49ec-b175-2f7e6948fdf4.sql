-- Adicionar campos de perfil profissional na tabela contacts
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS perfil_profissional text,
  ADD COLUMN IF NOT EXISTS especialidade text,
  ADD COLUMN IF NOT EXISTS instituicao text,
  ADD COLUMN IF NOT EXISTS perfil_sugerido_ia text,
  ADD COLUMN IF NOT EXISTS perfil_confirmado boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS classificado_em timestamptz;

-- Índice para filtros de disparo por perfil
CREATE INDEX IF NOT EXISTS idx_contacts_perfil ON public.contacts(perfil_profissional);

-- Adicionar filtros de perfil em campanhas_disparo
ALTER TABLE public.campanhas_disparo
  ADD COLUMN IF NOT EXISTS filtro_perfil_profissional text[],
  ADD COLUMN IF NOT EXISTS filtro_especialidade text[];