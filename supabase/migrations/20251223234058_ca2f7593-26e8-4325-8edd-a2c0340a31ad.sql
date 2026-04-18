-- Criar tabela de envios separada das campanhas
CREATE TABLE public.envios_disparo (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campanha_id UUID NOT NULL REFERENCES public.campanhas_disparo(id) ON DELETE CASCADE,
  instancia_id UUID REFERENCES public.instancias_whatsapp(id),
  status TEXT DEFAULT 'pendente',
  total_leads INTEGER DEFAULT 0,
  enviados INTEGER DEFAULT 0,
  sucesso INTEGER DEFAULT 0,
  falhas INTEGER DEFAULT 0,
  filtro_tipo_lead TEXT[] DEFAULT NULL,
  agendado_para TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  iniciado_em TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  concluido_em TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  envios_por_dia INTEGER DEFAULT 70,
  intervalo_min_minutos INTEGER DEFAULT 10,
  intervalo_max_minutos INTEGER DEFAULT 15,
  horario_inicio TIME DEFAULT '08:00:00',
  horario_fim TIME DEFAULT '18:00:00',
  dias_semana INTEGER[] DEFAULT '{1,2,3,4,5}',
  proximo_envio_em TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  created_by UUID DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.envios_disparo ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Usuários autenticados podem ver envios"
  ON public.envios_disparo FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem criar envios"
  ON public.envios_disparo FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem atualizar envios"
  ON public.envios_disparo FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins podem deletar envios"
  ON public.envios_disparo FOR DELETE
  USING (has_role(auth.uid(), 'admin_geral'::app_role));

-- Add envio_id to campanha_envios to track which envio each message belongs to
ALTER TABLE public.campanha_envios ADD COLUMN envio_id UUID REFERENCES public.envios_disparo(id) ON DELETE CASCADE;

-- Create index for performance
CREATE INDEX idx_envios_disparo_campanha ON public.envios_disparo(campanha_id);
CREATE INDEX idx_envios_disparo_status ON public.envios_disparo(status);
CREATE INDEX idx_campanha_envios_envio ON public.campanha_envios(envio_id);