-- Criar tabela para especialidades personalizadas
CREATE TABLE public.especialidades (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Habilitar RLS
ALTER TABLE public.especialidades ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso
CREATE POLICY "Usuários autenticados podem ver especialidades"
ON public.especialidades
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem criar especialidades"
ON public.especialidades
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Inserir especialidades padrão
INSERT INTO public.especialidades (nome) VALUES
  ('Cardiologia'),
  ('Dermatologia'),
  ('Endocrinologia'),
  ('Gastroenterologia'),
  ('Ginecologia'),
  ('Neurologia'),
  ('Oftalmologia'),
  ('Ortopedia'),
  ('Otorrinolaringologia'),
  ('Pediatria'),
  ('Psiquiatria'),
  ('Urologia'),
  ('Clínico Geral'),
  ('Cirurgia Geral'),
  ('Anestesiologia'),
  ('Medicina do Trabalho'),
  ('Medicina Esportiva'),
  ('Geriatria'),
  ('Reumatologia'),
  ('Pneumologia')
ON CONFLICT (nome) DO NOTHING;