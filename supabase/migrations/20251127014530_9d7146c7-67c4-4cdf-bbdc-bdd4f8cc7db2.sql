-- Tabela para disparos automáticos agendados
CREATE TABLE IF NOT EXISTS public.scheduled_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_disparo TEXT NOT NULL,
  instance_id UUID NOT NULL REFERENCES public.instancias_whatsapp(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  message_text TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('once', 'daily', 'weekly', 'monthly')),
  week_days INTEGER[], -- Array com dias da semana: 0=domingo, 1=segunda, ..., 6=sábado
  month_day INTEGER CHECK (month_day >= 1 AND month_day <= 31),
  send_time TIME NOT NULL,
  next_run_at TIMESTAMP WITH TIME ZONE,
  last_run_at TIMESTAMP WITH TIME ZONE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Índices para performance
CREATE INDEX idx_scheduled_messages_next_run ON public.scheduled_messages(next_run_at) WHERE active = true;
CREATE INDEX idx_scheduled_messages_instance ON public.scheduled_messages(instance_id);
CREATE INDEX idx_scheduled_messages_contact ON public.scheduled_messages(contact_id);
CREATE INDEX idx_scheduled_messages_active ON public.scheduled_messages(active);

-- Tabela de log de disparos
CREATE TABLE IF NOT EXISTS public.scheduled_messages_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_message_id UUID NOT NULL REFERENCES public.scheduled_messages(id) ON DELETE CASCADE,
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  success BOOLEAN NOT NULL,
  error_message TEXT,
  wa_message_id TEXT
);

CREATE INDEX idx_scheduled_messages_log_scheduled ON public.scheduled_messages_log(scheduled_message_id);
CREATE INDEX idx_scheduled_messages_log_sent_at ON public.scheduled_messages_log(sent_at);

-- RLS Policies
ALTER TABLE public.scheduled_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_messages_log ENABLE ROW LEVEL SECURITY;

-- Usuários autenticados podem ver seus próprios disparos ou todos se for admin
CREATE POLICY "Usuários podem ver disparos"
  ON public.scheduled_messages
  FOR SELECT
  USING (
    auth.uid() = created_by OR 
    has_role(auth.uid(), 'admin_geral'::app_role)
  );

-- Usuários autenticados podem criar disparos
CREATE POLICY "Usuários podem criar disparos"
  ON public.scheduled_messages
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL AND
    auth.uid() = created_by
  );

-- Usuários podem atualizar seus próprios disparos ou admins podem atualizar todos
CREATE POLICY "Usuários podem atualizar disparos"
  ON public.scheduled_messages
  FOR UPDATE
  USING (
    auth.uid() = created_by OR 
    has_role(auth.uid(), 'admin_geral'::app_role)
  );

-- Usuários podem deletar seus próprios disparos ou admins podem deletar todos
CREATE POLICY "Usuários podem deletar disparos"
  ON public.scheduled_messages
  FOR DELETE
  USING (
    auth.uid() = created_by OR 
    has_role(auth.uid(), 'admin_geral'::app_role)
  );

-- Policies para log
CREATE POLICY "Usuários podem ver logs de seus disparos"
  ON public.scheduled_messages_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.scheduled_messages sm
      WHERE sm.id = scheduled_messages_log.scheduled_message_id
      AND (sm.created_by = auth.uid() OR has_role(auth.uid(), 'admin_geral'::app_role))
    )
  );

-- Service role pode inserir logs
CREATE POLICY "Service role pode inserir logs"
  ON public.scheduled_messages_log
  FOR INSERT
  WITH CHECK (true);

-- Trigger para atualizar updated_at
CREATE TRIGGER update_scheduled_messages_updated_at
  BEFORE UPDATE ON public.scheduled_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Função para calcular próximo agendamento
CREATE OR REPLACE FUNCTION public.calculate_next_run(
  p_frequency TEXT,
  p_send_time TIME,
  p_week_days INTEGER[],
  p_month_day INTEGER,
  p_current_time TIMESTAMP WITH TIME ZONE DEFAULT now()
) RETURNS TIMESTAMP WITH TIME ZONE
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_next_run TIMESTAMP WITH TIME ZONE;
  v_base_date DATE;
  v_current_weekday INTEGER;
  v_days_to_add INTEGER;
  v_found BOOLEAN;
  v_day INTEGER;
BEGIN
  -- Para 'once', executa uma vez
  IF p_frequency = 'once' THEN
    v_base_date := CURRENT_DATE;
    v_next_run := v_base_date + p_send_time;
    IF v_next_run <= p_current_time THEN
      v_next_run := v_next_run + INTERVAL '1 day';
    END IF;
    RETURN v_next_run;
  END IF;

  -- Para 'daily'
  IF p_frequency = 'daily' THEN
    v_base_date := CURRENT_DATE;
    v_next_run := v_base_date + p_send_time;
    IF v_next_run <= p_current_time THEN
      v_next_run := v_next_run + INTERVAL '1 day';
    END IF;
    RETURN v_next_run;
  END IF;

  -- Para 'weekly'
  IF p_frequency = 'weekly' THEN
    v_base_date := CURRENT_DATE;
    v_current_weekday := EXTRACT(DOW FROM v_base_date)::INTEGER;
    v_found := FALSE;
    
    -- Procurar próximo dia da semana válido
    FOR v_days_to_add IN 0..7 LOOP
      v_day := (v_current_weekday + v_days_to_add) % 7;
      IF v_day = ANY(p_week_days) THEN
        v_next_run := (v_base_date + (v_days_to_add || ' days')::INTERVAL) + p_send_time;
        IF v_next_run > p_current_time THEN
          v_found := TRUE;
          EXIT;
        END IF;
      END IF;
    END LOOP;
    
    IF v_found THEN
      RETURN v_next_run;
    END IF;
  END IF;

  -- Para 'monthly'
  IF p_frequency = 'monthly' THEN
    v_base_date := CURRENT_DATE;
    -- Tentar no mês atual
    BEGIN
      v_next_run := make_date(EXTRACT(YEAR FROM v_base_date)::INTEGER, 
                              EXTRACT(MONTH FROM v_base_date)::INTEGER, 
                              p_month_day) + p_send_time;
    EXCEPTION WHEN OTHERS THEN
      -- Se o dia não existe neste mês, pega o último dia do mês
      v_next_run := (date_trunc('month', v_base_date) + INTERVAL '1 month' - INTERVAL '1 day')::DATE + p_send_time;
    END;
    
    -- Se já passou, vai para o próximo mês
    IF v_next_run <= p_current_time THEN
      BEGIN
        v_next_run := make_date(EXTRACT(YEAR FROM v_base_date + INTERVAL '1 month')::INTEGER, 
                                EXTRACT(MONTH FROM v_base_date + INTERVAL '1 month')::INTEGER, 
                                p_month_day) + p_send_time;
      EXCEPTION WHEN OTHERS THEN
        v_next_run := (date_trunc('month', v_base_date + INTERVAL '1 month') + INTERVAL '1 month' - INTERVAL '1 day')::DATE + p_send_time;
      END;
    END IF;
    
    RETURN v_next_run;
  END IF;

  RETURN NULL;
END;
$$;