-- Reescreve a lógica de "conversas pendentes de atendimento" pra ser baseada
-- em FONTE DE VERDADE (tabela messages), não em cache (conversas.last_message_from_me).
--
-- Background: 947 conversas apareciam como pendentes no Briefing IA. Realidade:
-- só ~80 estão. Causa: msgs @lid que chegavam antes do fix 25/04 caíam em branch
-- do webhook que não atualizava last_message_from_me — o cache ficou rotten.
--
-- Solução em 3 camadas:
--   1. Backfill: corrige cache existente com verdade da tabela messages
--   2. Trigger: garante sincronia daqui pra frente em todo INSERT em messages
--   3. RPC: query de "pendentes" lê messages diretamente (não confia no cache)

-- ===========================================================================
-- CAMADA 1: Backfill — usa a última msg REAL pra corrigir o flag
-- ===========================================================================
WITH ultima_msg AS (
  SELECT DISTINCT ON (m.contact_id, m.instancia_whatsapp_id)
    m.contact_id,
    m.instancia_whatsapp_id,
    m.from_me,
    m.created_at
  FROM public.messages m
  WHERE m.contact_id IS NOT NULL
    AND m.instancia_whatsapp_id IS NOT NULL
  ORDER BY m.contact_id, m.instancia_whatsapp_id, m.created_at DESC
)
UPDATE public.conversas c
SET last_message_from_me = u.from_me,
    updated_at = now()
FROM ultima_msg u
WHERE c.contact_id = u.contact_id
  AND c.current_instance_id = u.instancia_whatsapp_id
  AND c.last_message_from_me IS DISTINCT FROM u.from_me;

-- ===========================================================================
-- CAMADA 2: Trigger — sincroniza last_message_from_me em todo INSERT
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.sync_conversa_last_msg()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só atualiza se a msg nova é mais recente que a última registrada na conversa
  -- (evita race quando msgs antigas chegam fora de ordem)
  UPDATE public.conversas c
  SET last_message_from_me = NEW.from_me,
      ultima_interacao = GREATEST(c.ultima_interacao, NEW.created_at),
      updated_at = now()
  WHERE c.contact_id = NEW.contact_id
    AND c.current_instance_id = NEW.instancia_whatsapp_id
    AND (c.ultima_interacao IS NULL OR NEW.created_at >= c.ultima_interacao);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_conversa_last_msg ON public.messages;
CREATE TRIGGER trg_sync_conversa_last_msg
  AFTER INSERT ON public.messages
  FOR EACH ROW
  WHEN (NEW.contact_id IS NOT NULL AND NEW.instancia_whatsapp_id IS NOT NULL)
  EXECUTE FUNCTION public.sync_conversa_last_msg();

-- ===========================================================================
-- CAMADA 3: RPC — fonte de verdade pra "pendentes de atendimento"
--
-- Critério "pendente":
--   1. Conversa em status ativo (novo / Aguardando Contato / Em Atendimento)
--   2. Não está ignorada
--   3. Chip é de atendimento (não disparo)
--   4. Última msg REAL em messages é do contato (from_me=false)
--   5. Última msg foi há mais de p_min_minutos (default 30min — evita
--      flagar conversa que está sendo respondida agora mesmo)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.conversas_pendentes_atendimento(
  p_min_minutos INTEGER DEFAULT 30,
  p_lookback_dias INTEGER DEFAULT 14
)
RETURNS TABLE (
  conversa_id UUID,
  contact_id UUID,
  numero_contato TEXT,
  nome_contato TEXT,
  responsavel_atual UUID,
  responsavel_nome TEXT,
  instancia_id UUID,
  instancia_nome TEXT,
  ultima_msg_em TIMESTAMPTZ,
  ultima_msg_texto TEXT,
  minutos_sem_resposta INTEGER,
  status TEXT,
  unread_count INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ult AS (
    SELECT DISTINCT ON (m.contact_id, m.instancia_whatsapp_id)
      m.contact_id,
      m.instancia_whatsapp_id,
      m.from_me,
      m.text,
      m.created_at
    FROM messages m
    WHERE m.created_at > now() - make_interval(days => p_lookback_dias)
      AND m.contact_id IS NOT NULL
      AND m.instancia_whatsapp_id IS NOT NULL
    ORDER BY m.contact_id, m.instancia_whatsapp_id, m.created_at DESC
  )
  SELECT
    c.id AS conversa_id,
    c.contact_id,
    c.numero_contato,
    c.nome_contato,
    c.responsavel_atual,
    p.nome AS responsavel_nome,
    c.current_instance_id AS instancia_id,
    i.nome_instancia AS instancia_nome,
    u.created_at AS ultima_msg_em,
    LEFT(COALESCE(u.text, ''), 200) AS ultima_msg_texto,
    EXTRACT(EPOCH FROM (now() - u.created_at))::INTEGER / 60 AS minutos_sem_resposta,
    c.status,
    c.unread_count
  FROM ult u
  JOIN conversas c
    ON c.contact_id = u.contact_id
   AND c.current_instance_id = u.instancia_whatsapp_id
  JOIN instancias_whatsapp i
    ON i.id = c.current_instance_id
  LEFT JOIN profiles p
    ON p.id = c.responsavel_atual
  WHERE c.status IN ('novo', 'Aguardando Contato', 'Em Atendimento')
    AND c.ignorada_em IS NULL
    AND COALESCE(i.finalidade, 'atendimento') = 'atendimento'
    AND u.from_me = false
    AND u.created_at < now() - make_interval(mins => p_min_minutos)
  ORDER BY u.created_at ASC;
$$;

REVOKE ALL ON FUNCTION public.conversas_pendentes_atendimento(INTEGER, INTEGER) FROM public;
GRANT EXECUTE ON FUNCTION public.conversas_pendentes_atendimento(INTEGER, INTEGER) TO authenticated, service_role;

COMMENT ON FUNCTION public.conversas_pendentes_atendimento IS
'Retorna conversas com mensagens não respondidas, baseado na ÚLTIMA msg REAL da tabela messages (não no cache last_message_from_me que pode estar desatualizado). Filtra: chip de atendimento, status ativo, não ignorada, última msg do contato há mais de p_min_minutos.';
