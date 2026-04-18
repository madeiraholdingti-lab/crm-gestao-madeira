
-- Step 1: Parse compound specialties, create individual ones, and remap leads
DO $$
DECLARE
  compound_rec RECORD;
  part TEXT;
  parts TEXT[];
  clean_name TEXT;
  individual_names TEXT[];
  main_esp_name TEXT;
  main_esp_id UUID;
  sec_esp_id UUID;
  lead_rec RECORD;
  i INT;
BEGIN
  -- Process each compound specialty
  FOR compound_rec IN 
    SELECT id, nome FROM public.especialidades 
    WHERE nome LIKE '%,%' OR nome LIKE '%/%'
  LOOP
    -- Split by comma first
    parts := string_to_array(compound_rec.nome, ', ');
    individual_names := ARRAY[]::TEXT[];
    
    FOR i IN 1..array_length(parts, 1) LOOP
      part := TRIM(parts[i]);
      
      -- Handle "PEDIATRIA / Sub Especialidade" format
      IF part LIKE '%/%' THEN
        DECLARE
          slash_parts TEXT[];
        BEGIN
          slash_parts := string_to_array(part, ' / ');
          -- Add main part (e.g. PEDIATRIA)
          clean_name := UPPER(TRIM(slash_parts[1]));
          IF clean_name != '' AND NOT clean_name = ANY(individual_names) THEN
            individual_names := array_append(individual_names, clean_name);
          END IF;
          -- Add sub-part (e.g. Medicina Intensiva Pediátrica)
          IF array_length(slash_parts, 1) > 1 THEN
            clean_name := TRIM(slash_parts[2]);
            IF clean_name != '' AND NOT UPPER(clean_name) = ANY(
              SELECT UPPER(unnest) FROM unnest(individual_names)
            ) THEN
              individual_names := array_append(individual_names, clean_name);
            END IF;
          END IF;
        END;
      ELSE
        -- Simple specialty name
        clean_name := TRIM(part);
        IF clean_name != '' AND NOT UPPER(clean_name) = ANY(
          SELECT UPPER(unnest) FROM unnest(individual_names)
        ) THEN
          individual_names := array_append(individual_names, clean_name);
        END IF;
      END IF;
    END LOOP;
    
    -- Skip if no names extracted
    IF array_length(individual_names, 1) IS NULL THEN
      CONTINUE;
    END IF;
    
    -- First name is the primary specialty
    main_esp_name := individual_names[1];
    
    -- Ensure main specialty exists
    SELECT id INTO main_esp_id FROM public.especialidades 
    WHERE UPPER(TRIM(nome)) = UPPER(TRIM(main_esp_name)) 
    AND (nome NOT LIKE '%,%' AND nome NOT LIKE '%/%')
    LIMIT 1;
    
    IF main_esp_id IS NULL THEN
      INSERT INTO public.especialidades (nome) VALUES (main_esp_name)
      ON CONFLICT DO NOTHING;
      SELECT id INTO main_esp_id FROM public.especialidades 
      WHERE UPPER(TRIM(nome)) = UPPER(TRIM(main_esp_name))
      AND (nome NOT LIKE '%,%' AND nome NOT LIKE '%/%')
      LIMIT 1;
    END IF;
    
    -- For each lead that uses this compound specialty, remap
    FOR lead_rec IN 
      SELECT id FROM public.leads WHERE especialidade_id = compound_rec.id
    LOOP
      -- Set primary specialty
      IF main_esp_id IS NOT NULL THEN
        UPDATE public.leads SET especialidade_id = main_esp_id WHERE id = lead_rec.id;
      END IF;
      
      -- Add secondary specialties (skip index 1 which is primary)
      IF array_length(individual_names, 1) > 1 THEN
        FOR i IN 2..array_length(individual_names, 1) LOOP
          clean_name := individual_names[i];
          
          -- Ensure secondary specialty exists
          SELECT id INTO sec_esp_id FROM public.especialidades 
          WHERE UPPER(TRIM(nome)) = UPPER(TRIM(clean_name))
          AND (nome NOT LIKE '%,%' AND nome NOT LIKE '%/%')
          LIMIT 1;
          
          IF sec_esp_id IS NULL THEN
            INSERT INTO public.especialidades (nome) VALUES (clean_name)
            ON CONFLICT DO NOTHING;
            SELECT id INTO sec_esp_id FROM public.especialidades 
            WHERE UPPER(TRIM(nome)) = UPPER(TRIM(clean_name))
            AND (nome NOT LIKE '%,%' AND nome NOT LIKE '%/%')
            LIMIT 1;
          END IF;
          
          IF sec_esp_id IS NOT NULL THEN
            INSERT INTO public.lead_especialidades_secundarias (lead_id, especialidade_id)
            VALUES (lead_rec.id, sec_esp_id)
            ON CONFLICT (lead_id, especialidade_id) DO NOTHING;
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;
  
  -- Step 2: Delete compound specialty records that are no longer referenced
  DELETE FROM public.especialidades 
  WHERE (nome LIKE '%,%' OR nome LIKE '%/%')
  AND id NOT IN (SELECT DISTINCT especialidade_id FROM public.leads WHERE especialidade_id IS NOT NULL)
  AND id NOT IN (SELECT DISTINCT especialidade_id FROM public.lead_especialidades_secundarias);
END $$;
