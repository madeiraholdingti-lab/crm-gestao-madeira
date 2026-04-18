-- Criar tabela para tipos de lead personalizados
CREATE TABLE public.tipos_lead (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  cor TEXT NOT NULL DEFAULT '#6366F1',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Habilitar RLS
ALTER TABLE public.tipos_lead ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso
CREATE POLICY "Usuários autenticados podem ver tipos de lead"
ON public.tipos_lead
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem criar tipos de lead"
ON public.tipos_lead
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Inserir tipos padrão com cores
INSERT INTO public.tipos_lead (nome, cor) VALUES
  ('medico', '#14B8A6'),
  ('estudante_medicina', '#8B5CF6'),
  ('empresario', '#F59E0B'),
  ('negocios', '#3B82F6'),
  ('hospital', '#EC4899'),
  ('paciente', '#06B6D4'),
  ('secretaria', '#A855F7'),
  ('fornecedor', '#6366F1'),
  ('parceiro', '#F472B6'),
  ('novo', '#3B82F6'),
  ('qualificado', '#22C55E'),
  ('interessado', '#EAB308'),
  ('convertido', '#10B981'),
  ('perdido', '#EF4444')
ON CONFLICT (nome) DO NOTHING;