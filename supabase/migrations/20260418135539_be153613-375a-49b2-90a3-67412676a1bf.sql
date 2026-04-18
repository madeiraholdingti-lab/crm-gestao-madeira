-- Consolidated migrations

-- ===== 20251103234555_30c2a057-2672-4c84-ad94-27a4b51ac7e2.sql =====
-- Criar enum para funções dos usuários
CREATE TYPE public.app_role AS ENUM ('admin_geral', 'medico', 'secretaria_medica', 'administrativo');

-- Criar tabela de perfis de usuários (vinculada ao auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  telefone_contato TEXT,
  cor_perfil TEXT NOT NULL DEFAULT '#3B82F6',
  funcao app_role NOT NULL DEFAULT 'secretaria_medica',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Criar tabela de instâncias WhatsApp (Z-API)
CREATE TABLE public.instancias_whatsapp (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_instancia TEXT NOT NULL,
  token_zapi TEXT NOT NULL,
  instancia_id TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_por UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);