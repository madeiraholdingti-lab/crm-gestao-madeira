-- Criar tabela de blacklist de leads
CREATE TABLE public.lead_blacklist (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  motivo TEXT,
  adicionado_por UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(lead_id)
);

-- Habilitar RLS
ALTER TABLE public.lead_blacklist ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso
CREATE POLICY "Usuários autenticados podem ver blacklist"
ON public.lead_blacklist
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem adicionar à blacklist"
ON public.lead_blacklist
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admins podem remover da blacklist"
ON public.lead_blacklist
FOR DELETE
USING (has_role(auth.uid(), 'admin_geral'::app_role));

-- Índice para busca rápida
CREATE INDEX idx_lead_blacklist_lead_id ON public.lead_blacklist(lead_id);