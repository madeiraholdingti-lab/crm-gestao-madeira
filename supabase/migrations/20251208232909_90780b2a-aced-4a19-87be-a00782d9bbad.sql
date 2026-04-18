-- Adicionar colunas para agendamento de envios na tabela campanhas_disparo
ALTER TABLE public.campanhas_disparo 
ADD COLUMN IF NOT EXISTS agendado_para timestamp with time zone,
ADD COLUMN IF NOT EXISTS envios_por_dia integer DEFAULT 70,
ADD COLUMN IF NOT EXISTS intervalo_min_minutos integer DEFAULT 10,
ADD COLUMN IF NOT EXISTS intervalo_max_minutos integer DEFAULT 15,
ADD COLUMN IF NOT EXISTS horario_inicio time DEFAULT '08:00:00',
ADD COLUMN IF NOT EXISTS horario_fim time DEFAULT '18:00:00',
ADD COLUMN IF NOT EXISTS dias_semana integer[] DEFAULT '{1,2,3,4,5}'::integer[],
ADD COLUMN IF NOT EXISTS proximo_envio_em timestamp with time zone;

-- Adicionar coluna de anotações na tabela leads
ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS anotacoes text;

-- Criar tabela para histórico de participação de leads em campanhas
CREATE TABLE IF NOT EXISTS public.lead_campanha_historico (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  campanha_id uuid NOT NULL REFERENCES public.campanhas_disparo(id) ON DELETE CASCADE,
  status text DEFAULT 'pendente',
  enviado_em timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(lead_id, campanha_id)
);

-- Enable RLS
ALTER TABLE public.lead_campanha_historico ENABLE ROW LEVEL SECURITY;

-- RLS policies for lead_campanha_historico
CREATE POLICY "Usuários autenticados podem ver histórico"
  ON public.lead_campanha_historico FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem inserir histórico"
  ON public.lead_campanha_historico FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem atualizar histórico"
  ON public.lead_campanha_historico FOR UPDATE
  USING (auth.uid() IS NOT NULL);