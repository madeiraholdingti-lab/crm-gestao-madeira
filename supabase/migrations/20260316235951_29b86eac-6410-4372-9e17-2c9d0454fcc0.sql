
-- Create junction table for secondary specialties
CREATE TABLE public.lead_especialidades_secundarias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  especialidade_id uuid NOT NULL REFERENCES public.especialidades(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lead_id, especialidade_id)
);

-- Enable RLS
ALTER TABLE public.lead_especialidades_secundarias ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Usuários autenticados podem ver especialidades secundárias"
ON public.lead_especialidades_secundarias FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem inserir especialidades secundárias"
ON public.lead_especialidades_secundarias FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem deletar especialidades secundárias"
ON public.lead_especialidades_secundarias FOR DELETE
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem atualizar especialidades secundárias"
ON public.lead_especialidades_secundarias FOR UPDATE
USING (auth.uid() IS NOT NULL);

-- Index for performance
CREATE INDEX idx_lead_esp_sec_lead_id ON public.lead_especialidades_secundarias(lead_id);
CREATE INDEX idx_lead_esp_sec_esp_id ON public.lead_especialidades_secundarias(especialidade_id);

-- Now parse existing compound specialty text and migrate data
-- Step 1: Extract unique sub-specialties from the text field and insert into especialidades
-- The format is like "PEDIATRIA / Cardiologia Pediátrica, PEDIATRIA / Medicina Intensiva Pediátrica, PEDIATRIA"
-- We need to split by comma, then by " / " to get sub-specialties

DO $$
DECLARE
  lead_rec RECORD;
  part TEXT;
  sub_part TEXT;
  parts TEXT[];
  main_esp TEXT;
  sub_esps TEXT[];
  esp_id UUID;
  main_esp_id UUID;
BEGIN
  FOR lead_rec IN 
    SELECT id, especialidade FROM public.leads 
    WHERE especialidade IS NOT NULL AND especialidade != '' AND especialidade LIKE '%/%'
  LOOP
    -- Split by comma
    parts := string_to_array(lead_rec.especialidade, ',');
    main_esp := NULL;
    sub_esps := ARRAY[]::TEXT[];
    
    FOR i IN 1..array_length(parts, 1) LOOP
      part := TRIM(parts[i]);
      IF part LIKE '%/%' THEN
        -- Has sub-specialty: "PEDIATRIA / Cardiologia Pediátrica"
        DECLARE
          slash_parts TEXT[];
        BEGIN
          slash_parts := string_to_array(part, ' / ');
          IF main_esp IS NULL THEN
            main_esp := UPPER(TRIM(slash_parts[1]));
          END IF;
          IF array_length(slash_parts, 1) > 1 THEN
            FOR j IN 2..array_length(slash_parts, 1) LOOP
              sub_part := TRIM(slash_parts[j]);
              IF sub_part != '' AND NOT sub_part = ANY(sub_esps) THEN
                sub_esps := array_append(sub_esps, sub_part);
              END IF;
            END LOOP;
          END IF;
        END;
      ELSE
        -- Just a main specialty like "PEDIATRIA"
        IF main_esp IS NULL THEN
          main_esp := UPPER(TRIM(part));
        END IF;
      END IF;
    END LOOP;
    
    -- Set the main specialty
    IF main_esp IS NOT NULL THEN
      -- Find or create main specialty
      SELECT id INTO main_esp_id FROM public.especialidades WHERE UPPER(TRIM(nome)) = main_esp LIMIT 1;
      IF main_esp_id IS NULL THEN
        INSERT INTO public.especialidades (nome) VALUES (main_esp) RETURNING id INTO main_esp_id;
      END IF;
      
      -- Update lead's primary specialty
      UPDATE public.leads SET especialidade_id = main_esp_id WHERE id = lead_rec.id;
    END IF;
    
    -- Insert secondary specialties
    IF array_length(sub_esps, 1) > 0 THEN
      FOREACH sub_part IN ARRAY sub_esps LOOP
        -- Find or create sub-specialty
        SELECT id INTO esp_id FROM public.especialidades WHERE UPPER(TRIM(nome)) = UPPER(TRIM(sub_part)) LIMIT 1;
        IF esp_id IS NULL THEN
          INSERT INTO public.especialidades (nome) VALUES (sub_part) RETURNING id INTO esp_id;
        END IF;
        
        -- Insert into junction table (ignore duplicates)
        INSERT INTO public.lead_especialidades_secundarias (lead_id, especialidade_id)
        VALUES (lead_rec.id, esp_id)
        ON CONFLICT (lead_id, especialidade_id) DO NOTHING;
      END LOOP;
    END IF;
  END LOOP;
END $$;
