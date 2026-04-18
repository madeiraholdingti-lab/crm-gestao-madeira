-- Criar tabela para registrar eventos de instância
CREATE TABLE public.instance_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_name TEXT NOT NULL,
  instance_uuid TEXT,
  event TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Índices para consultas frequentes
CREATE INDEX idx_instance_events_instance_name ON public.instance_events(instance_name);
CREATE INDEX idx_instance_events_event ON public.instance_events(event);
CREATE INDEX idx_instance_events_created_at ON public.instance_events(created_at DESC);

-- Adicionar campos de QRCode e status detalhado na tabela de instâncias
ALTER TABLE public.instancias_whatsapp 
ADD COLUMN IF NOT EXISTS qrcode_base64 TEXT,
ADD COLUMN IF NOT EXISTS qrcode_updated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS connection_status TEXT DEFAULT 'disconnected';

-- Enable RLS
ALTER TABLE public.instance_events ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para instance_events
CREATE POLICY "Usuários autenticados podem ver eventos" 
ON public.instance_events 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role pode inserir eventos" 
ON public.instance_events 
FOR INSERT 
WITH CHECK (true);