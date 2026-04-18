-- Adicionar coluna para URL da foto de perfil na tabela contacts
ALTER TABLE public.contacts 
ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;

-- Adicionar coluna para foto na tabela conversas também (para exibição rápida)
ALTER TABLE public.conversas
ADD COLUMN IF NOT EXISTS foto_contato TEXT;