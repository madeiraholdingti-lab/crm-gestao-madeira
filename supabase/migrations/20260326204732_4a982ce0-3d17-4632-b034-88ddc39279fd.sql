CREATE OR REPLACE FUNCTION public.listar_leads_disponiveis_disparo(
  p_campanha_id uuid,
  p_current_envio_id uuid DEFAULT NULL,
  p_filter_tipo_lead text DEFAULT NULL,
  p_filter_especialidade uuid DEFAULT NULL,
  p_filter_busca text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_per_page integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_page integer := GREATEST(COALESCE(p_page, 1), 1);
  v_per_page integer := LEAST(GREATEST(COALESCE(p_per_page, 500), 1), 500);
  v_offset integer;
  v_search text := NULLIF(TRIM(regexp_replace(COALESCE(p_filter_busca, ''), '[%(),]+', ' ', 'g')), '');
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_offset := (v_page - 1) * v_per_page;

  WITH base AS (
    SELECT
      l.id,
      l.nome,
      l.telefone,
      l.tipo_lead,
      l.especialidade_id,
      l.created_at
    FROM public.leads l
    WHERE l.ativo = true
      AND (p_filter_tipo_lead IS NULL OR p_filter_tipo_lead = '' OR l.tipo_lead = p_filter_tipo_lead)
      AND (
        v_search IS NULL
        OR COALESCE(l.nome, '') ILIKE '%' || v_search || '%'
        OR l.telefone ILIKE '%' || v_search || '%'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.lead_blacklist lb
        WHERE lb.lead_id = l.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.campanha_envios ce_same
        WHERE ce_same.lead_id = l.id
          AND ce_same.campanha_id = p_campanha_id
          AND (p_current_envio_id IS NULL OR ce_same.envio_id IS DISTINCT FROM p_current_envio_id)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.campanha_envios ce_recent
        WHERE ce_recent.lead_id = l.id
          AND ce_recent.created_at >= now() - interval '7 days'
          AND ce_recent.campanha_id IS DISTINCT FROM p_campanha_id
      )
  ),
  counts AS (
    SELECT
      e.id,
      e.nome,
      COUNT(*)::int AS count
    FROM base b
    JOIN public.especialidades e ON e.id = b.especialidade_id
    GROUP BY e.id, e.nome
  ),
  filtered AS (
    SELECT
      b.id,
      b.nome,
      b.telefone,
      b.tipo_lead,
      b.especialidade_id,
      b.created_at
    FROM base b
    WHERE p_filter_especialidade IS NULL OR b.especialidade_id = p_filter_especialidade
  ),
  paged AS (
    SELECT
      f.id,
      f.nome,
      f.telefone,
      f.tipo_lead,
      f.especialidade_id
    FROM filtered f
    ORDER BY f.created_at DESC
    LIMIT v_per_page OFFSET v_offset
  )
  SELECT jsonb_build_object(
    'leads', COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM paged p), '[]'::jsonb),
    'total', (SELECT COUNT(*)::int FROM filtered),
    'especialidades', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'count', c.count) ORDER BY c.nome)
      FROM counts c
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_lead_blacklist_lead_id ON public.lead_blacklist (lead_id);
CREATE INDEX IF NOT EXISTS idx_campanha_envios_lead_campanha_envio_created ON public.campanha_envios (lead_id, campanha_id, envio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_modal_disparo_filters ON public.leads (ativo, tipo_lead, especialidade_id, created_at DESC);