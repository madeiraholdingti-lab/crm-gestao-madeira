-- Adicionar novos campos à tabela contacts
ALTER TABLE public.contacts
ADD COLUMN IF NOT EXISTS tipo_contato TEXT DEFAULT 'Outros',
ADD COLUMN IF NOT EXISTS observacoes TEXT,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Criar tabela de anexos
CREATE TABLE IF NOT EXISTS public.contact_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  file_size BIGINT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  uploaded_by UUID REFERENCES auth.users(id)
);

-- Índice para buscar anexos por contato
CREATE INDEX IF NOT EXISTS idx_contact_attachments_contact_id ON public.contact_attachments(contact_id);

-- RLS para anexos
ALTER TABLE public.contact_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuários autenticados podem ver anexos"
  ON public.contact_attachments FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem inserir anexos"
  ON public.contact_attachments FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem deletar anexos"
  ON public.contact_attachments FOR DELETE
  USING (auth.uid() IS NOT NULL);