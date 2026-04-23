-- View agregada com métricas por campanha, usada no relatório /relatorios/campanhas
-- e que pode servir como fonte pro openclaw/agente futuro analisar campanhas.

CREATE OR REPLACE VIEW public.vw_metricas_campanha AS
SELECT
  c.id AS campanha_id,
  c.nome,
  c.tipo,
  c.status AS campanha_status,
  c.created_at,
  c.mensagem AS mensagem_inicial,
  c.envios_por_dia,
  COUNT(e.id)                                                            AS total_envios,
  COUNT(*) FILTER (WHERE e.status = 'pendente')                          AS pendentes,
  COUNT(*) FILTER (WHERE e.status = 'enviado')                           AS enviados,
  COUNT(*) FILTER (WHERE e.status = 'em_conversa')                       AS em_conversa,
  COUNT(*) FILTER (WHERE e.status = 'qualificado')                       AS qualificados,
  COUNT(*) FILTER (WHERE e.status = 'descartado')                        AS descartados,
  COUNT(*) FILTER (WHERE e.respondeu_em IS NOT NULL)                     AS responderam,
  COUNT(*) FILTER (WHERE e.enviado_em >= (CURRENT_DATE::timestamp))      AS enviados_hoje,
  COUNT(*) FILTER (WHERE e.respondeu_em >= (CURRENT_DATE::timestamp))    AS respostas_hoje,
  COUNT(*) FILTER (WHERE e.erro IS NOT NULL)                             AS com_erro,
  MAX(e.enviado_em)                                                      AS ultimo_envio,
  MAX(e.respondeu_em)                                                    AS ultima_resposta,
  -- Taxa de resposta sobre efetivamente enviados
  CASE
    WHEN COUNT(*) FILTER (WHERE e.status IN ('enviado','em_conversa','qualificado','descartado')) > 0
    THEN ROUND(
      100.0 * COUNT(*) FILTER (WHERE e.respondeu_em IS NOT NULL)::numeric
      / NULLIF(COUNT(*) FILTER (WHERE e.status IN ('enviado','em_conversa','qualificado','descartado')), 0),
      1
    )
    ELSE 0
  END AS taxa_resposta_pct,
  -- Taxa de qualificação sobre respondidos
  CASE
    WHEN COUNT(*) FILTER (WHERE e.respondeu_em IS NOT NULL) > 0
    THEN ROUND(
      100.0 * COUNT(*) FILTER (WHERE e.status = 'qualificado')::numeric
      / NULLIF(COUNT(*) FILTER (WHERE e.respondeu_em IS NOT NULL), 0),
      1
    )
    ELSE 0
  END AS taxa_qualificacao_pct
FROM public.campanhas_disparo c
LEFT JOIN public.campanha_envios e ON e.campanha_id = c.id
GROUP BY c.id, c.nome, c.tipo, c.status, c.created_at, c.mensagem, c.envios_por_dia;

GRANT SELECT ON public.vw_metricas_campanha TO authenticated, service_role;

COMMENT ON VIEW public.vw_metricas_campanha IS
  'Agregado de métricas por campanha_disparo — total/status/respostas/taxas, usado no /relatorios/campanhas';
