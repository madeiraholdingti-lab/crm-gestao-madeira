-- Corrigir search_path da função calculate_next_run
CREATE OR REPLACE FUNCTION public.calculate_next_run(
  p_frequency TEXT,
  p_send_time TIME,
  p_week_days INTEGER[],
  p_month_day INTEGER,
  p_current_time TIMESTAMP WITH TIME ZONE DEFAULT now()
) RETURNS TIMESTAMP WITH TIME ZONE
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
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