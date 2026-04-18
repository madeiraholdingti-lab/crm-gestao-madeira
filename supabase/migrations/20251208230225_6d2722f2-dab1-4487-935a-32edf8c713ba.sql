-- Tabela de Leads para disparos em massa
CREATE TABLE public.leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT,
  telefone TEXT NOT NULL,
  email TEXT,
  tipo_lead TEXT DEFAULT 'novo',
  origem TEXT,
  tags TEXT[] DEFAULT '{}',
  dados_extras JSONB DEFAULT '{}',
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de Campanhas de Disparo em Massa
CREATE TABLE public.campanhas_disparo (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT,
  mensagem TEXT NOT NULL,
  instancia_id UUID REFERENCES public.instancias_whatsapp(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'rascunho', -- rascunho, em_andamento, concluida, pausada, cancelada
  total_leads INTEGER DEFAULT 0,
  enviados INTEGER DEFAULT 0,
  sucesso INTEGER DEFAULT 0,
  falhas INTEGER DEFAULT 0,
  filtro_tipo_lead TEXT[],
  created_by UUID,
  iniciado_em TIMESTAMP WITH TIME ZONE,
  concluido_em TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de Log de Envios de Campanha
CREATE TABLE public.campanha_envios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campanha_id UUID NOT NULL REFERENCES public.campanhas_disparo(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  telefone TEXT NOT NULL,
  status TEXT DEFAULT 'pendente', -- pendente, enviando, enviado, falha
  erro TEXT,
  wa_message_id TEXT,
  enviado_em TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Índices para performance
CREATE INDEX idx_leads_telefone ON public.leads(telefone);
CREATE INDEX idx_leads_tipo_lead ON public.leads(tipo_lead);
CREATE INDEX idx_leads_ativo ON public.leads(ativo);
CREATE INDEX idx_campanhas_status ON public.campanhas_disparo(status);
CREATE INDEX idx_campanha_envios_campanha ON public.campanha_envios(campanha_id);
CREATE INDEX idx_campanha_envios_status ON public.campanha_envios(status);

-- Enable RLS
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campanhas_disparo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campanha_envios ENABLE ROW LEVEL SECURITY;

-- RLS Policies para leads
CREATE POLICY "Usuários autenticados podem ver leads"
  ON public.leads FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem inserir leads"
  ON public.leads FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem atualizar leads"
  ON public.leads FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins podem deletar leads"
  ON public.leads FOR DELETE
  USING (has_role(auth.uid(), 'admin_geral'::app_role));

-- RLS Policies para campanhas
CREATE POLICY "Usuários autenticados podem ver campanhas"
  ON public.campanhas_disparo FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem criar campanhas"
  ON public.campanhas_disparo FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem atualizar campanhas"
  ON public.campanhas_disparo FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins podem deletar campanhas"
  ON public.campanhas_disparo FOR DELETE
  USING (has_role(auth.uid(), 'admin_geral'::app_role));

-- RLS Policies para envios
CREATE POLICY "Usuários autenticados podem ver envios"
  ON public.campanha_envios FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Sistema pode inserir envios"
  ON public.campanha_envios FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Sistema pode atualizar envios"
  ON public.campanha_envios FOR UPDATE
  USING (true);

-- Trigger para updated_at
CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_campanhas_updated_at
  BEFORE UPDATE ON public.campanhas_disparo
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();