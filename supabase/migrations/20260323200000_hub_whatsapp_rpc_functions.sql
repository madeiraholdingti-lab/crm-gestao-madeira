-- ============================================================
-- Hub WhatsApp: RPCs para Central de Inteligência de Contatos
-- ============================================================

-- 1. hub_contacts_summary()
-- Retorna métricas gerais: totais, por perfil e por instância
CREATE OR REPLACE FUNCTION public.hub_contacts_summary()
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  result json;
BEGIN
  WITH totals AS (
    SELECT
      count(*) AS total_contacts,
      count(*) FILTER (WHERE perfil_profissional IS NOT NULL) AS classified,
      count(*) FILTER (WHERE perfil_profissional IS NULL) AS unclassified
    FROM contacts
  ),
  by_profile AS (
    SELECT
      coalesce(perfil_profissional, 'nao_classificado') AS perfil,
      count(*) AS total
    FROM contacts
    GROUP BY perfil_profissional
    ORDER BY total DESC
  ),
  by_instance AS (
    SELECT
      iw.id AS instance_id,
      iw.nome_instancia AS nome,
      iw.cor_identificacao AS cor,
      count(DISTINCT c.contact_id) AS contact_count,
      count(c.id) AS conversa_count
    FROM instancias_whatsapp iw
    LEFT JOIN conversas c ON c.current_instance_id = iw.id OR c.orig_instance_id = iw.id
    WHERE iw.ativo = true AND iw.status != 'deletada'
    GROUP BY iw.id, iw.nome_instancia, iw.cor_identificacao
    ORDER BY contact_count DESC
  )
  SELECT json_build_object(
    'total_contacts', (SELECT total_contacts FROM totals),
    'classified', (SELECT classified FROM totals),
    'unclassified', (SELECT unclassified FROM totals),
    'by_profile', (SELECT coalesce(json_agg(json_build_object('perfil', perfil, 'total', total)), '[]'::json) FROM by_profile),
    'by_instance', (SELECT coalesce(json_agg(json_build_object(
      'instance_id', instance_id,
      'nome', nome,
      'cor', cor,
      'contact_count', contact_count,
      'conversa_count', conversa_count
    )), '[]'::json) FROM by_instance)
  ) INTO result;

  RETURN result;
END;
$$;

-- 2. hub_contacts_activity(p_days)
-- Retorna atividade de contatos no período: timeline, por perfil e por instância
CREATE OR REPLACE FUNCTION public.hub_contacts_activity(p_days integer DEFAULT 30)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  result json;
  cutoff timestamptz;
BEGIN
  cutoff := now() - (p_days || ' days')::interval;

  WITH active_total AS (
    SELECT count(DISTINCT c.contact_id) AS active_contacts
    FROM conversas c
    WHERE c.ultima_interacao >= cutoff
      AND c.contact_id IS NOT NULL
  ),
  timeline AS (
    SELECT
      d.dia::date AS date,
      count(DISTINCT c.id) AS conversations
    FROM generate_series(cutoff::date, now()::date, '1 day'::interval) AS d(dia)
    LEFT JOIN conversas c ON c.ultima_interacao::date = d.dia::date
    GROUP BY d.dia
    ORDER BY d.dia
  ),
  by_profile_active AS (
    SELECT
      coalesce(ct.perfil_profissional, 'nao_classificado') AS perfil,
      count(DISTINCT ct.id) AS active_count
    FROM conversas c
    JOIN contacts ct ON ct.id = c.contact_id
    WHERE c.ultima_interacao >= cutoff
    GROUP BY ct.perfil_profissional
    ORDER BY active_count DESC
  ),
  by_instance_active AS (
    SELECT
      iw.nome_instancia AS instance_name,
      iw.cor_identificacao AS cor,
      count(DISTINCT c.contact_id) AS active_contacts,
      count(c.id) AS total_conversas
    FROM conversas c
    JOIN instancias_whatsapp iw ON iw.id = coalesce(c.current_instance_id, c.orig_instance_id)
    WHERE c.ultima_interacao >= cutoff
    GROUP BY iw.nome_instancia, iw.cor_identificacao
    ORDER BY active_contacts DESC
  )
  SELECT json_build_object(
    'active_contacts', (SELECT active_contacts FROM active_total),
    'timeline', (SELECT coalesce(json_agg(json_build_object('date', date, 'conversations', conversations)), '[]'::json) FROM timeline),
    'by_profile_active', (SELECT coalesce(json_agg(json_build_object('perfil', perfil, 'active_count', active_count)), '[]'::json) FROM by_profile_active),
    'by_instance_active', (SELECT coalesce(json_agg(json_build_object('instance_name', instance_name, 'cor', cor, 'active_contacts', active_contacts, 'total_conversas', total_conversas)), '[]'::json) FROM by_instance_active)
  ) INTO result;

  RETURN result;
END;
$$;

-- 3. hub_contacts_filter(...)
-- Busca inteligente de contatos com filtros combinados
CREATE OR REPLACE FUNCTION public.hub_contacts_filter(
  p_perfil text DEFAULT NULL,
  p_especialidade text DEFAULT NULL,
  p_instituicao text DEFAULT NULL,
  p_instance_id uuid DEFAULT NULL,
  p_days integer DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  result json;
  cutoff timestamptz;
BEGIN
  IF p_days IS NOT NULL THEN
    cutoff := now() - (p_days || ' days')::interval;
  END IF;

  WITH filtered AS (
    SELECT
      ct.id AS contact_id,
      ct.name,
      ct.phone,
      ct.perfil_profissional,
      ct.especialidade,
      ct.instituicao,
      ct.perfil_confirmado,
      max(c.ultima_interacao) AS last_interaction,
      iw.nome_instancia AS instance_name,
      iw.cor_identificacao AS instance_color,
      count(DISTINCT c.id) AS conversation_count
    FROM contacts ct
    LEFT JOIN conversas c ON c.contact_id = ct.id
    LEFT JOIN instancias_whatsapp iw ON iw.id = coalesce(c.current_instance_id, c.orig_instance_id)
    WHERE
      (p_perfil IS NULL OR ct.perfil_profissional = p_perfil)
      AND (p_especialidade IS NULL OR ct.especialidade ILIKE '%' || p_especialidade || '%')
      AND (p_instituicao IS NULL OR ct.instituicao ILIKE '%' || p_instituicao || '%')
      AND (p_instance_id IS NULL OR coalesce(c.current_instance_id, c.orig_instance_id) = p_instance_id)
      AND (cutoff IS NULL OR c.ultima_interacao >= cutoff)
    GROUP BY ct.id, ct.name, ct.phone, ct.perfil_profissional, ct.especialidade,
             ct.instituicao, ct.perfil_confirmado, iw.nome_instancia, iw.cor_identificacao
    ORDER BY last_interaction DESC NULLS LAST
  ),
  total AS (
    SELECT count(*) AS total_count FROM filtered
  )
  SELECT json_build_object(
    'total_count', (SELECT total_count FROM total),
    'contacts', (
      SELECT coalesce(json_agg(json_build_object(
        'contact_id', contact_id,
        'name', name,
        'phone', phone,
        'perfil_profissional', perfil_profissional,
        'especialidade', especialidade,
        'instituicao', instituicao,
        'perfil_confirmado', perfil_confirmado,
        'last_interaction', last_interaction,
        'instance_name', instance_name,
        'instance_color', instance_color,
        'conversation_count', conversation_count
      )), '[]'::json)
      FROM (SELECT * FROM filtered LIMIT p_limit OFFSET p_offset) sub
    )
  ) INTO result;

  RETURN result;
END;
$$;
