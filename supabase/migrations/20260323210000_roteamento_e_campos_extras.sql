-- ============================================================
-- Campos extras em contacts + Tabela de regras de roteamento
-- ============================================================

-- 1. Campos extras em contacts para classificação mais rica
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS cargo text,
  ADD COLUMN IF NOT EXISTS cidade text,
  ADD COLUMN IF NOT EXISTS relevancia text DEFAULT 'media';

-- Índice para filtros por relevância
CREATE INDEX IF NOT EXISTS idx_contacts_relevancia ON contacts(relevancia);
CREATE INDEX IF NOT EXISTS idx_contacts_cidade ON contacts(cidade);

-- 2. Tabela de regras de roteamento automático
CREATE TABLE IF NOT EXISTS regras_roteamento (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  perfis_profissionais text[] NOT NULL,
  responsavel_user_id uuid REFERENCES profiles(id),
  ativo boolean DEFAULT true,
  prioridade int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_regras_roteamento_ativo
  ON regras_roteamento(ativo, prioridade DESC);

-- RLS
ALTER TABLE regras_roteamento ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Todos autenticados podem ver regras"
  ON regras_roteamento FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin pode inserir regras"
  ON regras_roteamento FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin_geral'));

CREATE POLICY "Admin pode atualizar regras"
  ON regras_roteamento FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin_geral'));

CREATE POLICY "Admin pode deletar regras"
  ON regras_roteamento FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin_geral'));
