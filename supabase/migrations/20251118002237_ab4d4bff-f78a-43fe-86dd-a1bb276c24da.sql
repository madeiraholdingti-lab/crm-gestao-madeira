-- Criar tabela de eventos da agenda
CREATE TABLE public.eventos_agenda (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  titulo TEXT NOT NULL,
  descricao TEXT,
  tipo_evento TEXT NOT NULL DEFAULT 'consulta',
  data_hora_inicio TIMESTAMP WITH TIME ZONE NOT NULL,
  data_hora_fim TIMESTAMP WITH TIME ZONE NOT NULL,
  medico_id UUID NOT NULL,
  paciente_id UUID,
  status TEXT NOT NULL DEFAULT 'pendente',
  google_event_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.eventos_agenda ENABLE ROW LEVEL SECURITY;

-- Políticas RLS
CREATE POLICY "Médicos podem ver seus próprios eventos"
ON public.eventos_agenda
FOR SELECT
USING (
  medico_id = auth.uid() OR 
  has_role(auth.uid(), 'admin_geral'::app_role)
);

CREATE POLICY "Médicos podem criar eventos"
ON public.eventos_agenda
FOR INSERT
WITH CHECK (
  medico_id = auth.uid() OR 
  has_role(auth.uid(), 'admin_geral'::app_role)
);

CREATE POLICY "Médicos podem atualizar seus eventos"
ON public.eventos_agenda
FOR UPDATE
USING (
  medico_id = auth.uid() OR 
  has_role(auth.uid(), 'admin_geral'::app_role)
);

CREATE POLICY "Médicos podem deletar seus eventos"
ON public.eventos_agenda
FOR DELETE
USING (
  medico_id = auth.uid() OR 
  has_role(auth.uid(), 'admin_geral'::app_role)
);

-- Trigger para atualizar updated_at
CREATE TRIGGER update_eventos_agenda_updated_at
BEFORE UPDATE ON public.eventos_agenda
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Índices para performance
CREATE INDEX idx_eventos_agenda_medico_id ON public.eventos_agenda(medico_id);
CREATE INDEX idx_eventos_agenda_data_hora_inicio ON public.eventos_agenda(data_hora_inicio);
CREATE INDEX idx_eventos_agenda_status ON public.eventos_agenda(status);