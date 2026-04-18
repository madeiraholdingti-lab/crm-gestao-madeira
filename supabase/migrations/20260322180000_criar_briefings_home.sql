-- Tabela para armazenar briefings gerados por IA no Home
CREATE TABLE IF NOT EXISTS briefings_home (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES profiles(id),
  conteudo text NOT NULL,
  links_acao jsonb DEFAULT '[]',
  gerado_em timestamptz DEFAULT now()
);

ALTER TABLE briefings_home ENABLE ROW LEVEL SECURITY;

-- Usuários veem apenas seus próprios briefings
CREATE POLICY "Usuários veem próprios briefings"
  ON briefings_home FOR SELECT
  USING (user_id = auth.uid());

-- Edge functions (service role) podem inserir briefings
CREATE POLICY "Sistema pode inserir briefings"
  ON briefings_home FOR INSERT
  WITH CHECK (true);

-- Índice para buscar último briefing do usuário rapidamente
CREATE INDEX idx_briefings_home_user_gerado
  ON briefings_home(user_id, gerado_em DESC);
