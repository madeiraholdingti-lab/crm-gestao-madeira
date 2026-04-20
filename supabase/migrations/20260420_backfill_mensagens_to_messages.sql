-- Backfill mensagens (PT legacy) → messages (EN nova)
-- Contexto: n8n estava gravando em `mensagens` até 19/04 ~22:07 BRT. O SDR Zap
-- lê de `messages`. Essa migration traz o histórico pra frente não perder contexto.
--
-- Regras:
-- 1. Pega apenas mensagens com wa_message_id não nulo (identificador único)
-- 2. Pula mensagens "mirror" (sufixo _dest) que eram só pra conversa espelho
-- 3. Pula se já existe em `messages` (ON CONFLICT)
-- 4. Exige contact_id + instance info via conversa → evita órfãos
-- 5. Janela: últimos 30 dias (ajustável — mudar o interval abaixo se precisar)

INSERT INTO public.messages (
  wa_message_id,
  contact_id,
  instancia_whatsapp_id,
  instance,
  instance_uuid,
  from_me,
  text,
  status,
  message_type,
  created_at
)
SELECT DISTINCT ON (m.wa_message_id)
  m.wa_message_id,
  c.contact_id,
  iw.id                    AS instancia_whatsapp_id,
  iw.nome_instancia        AS instance,
  iw.instancia_id          AS instance_uuid,
  (m.remetente = 'enviada') AS from_me,
  m.conteudo               AS text,
  COALESCE(m.status, 'DELIVERED') AS status,
  CASE m.tipo_mensagem
    WHEN 'texto'     THEN 'text'
    WHEN 'imagem'    THEN 'image'
    WHEN 'audio'     THEN 'audio'
    WHEN 'video'     THEN 'video'
    WHEN 'documento' THEN 'document'
    ELSE 'text'
  END                      AS message_type,
  m.created_at
FROM public.mensagens m
JOIN public.conversas c
  ON c.id = m.conversa_id
JOIN public.instancias_whatsapp iw
  ON iw.id = COALESCE(c.current_instance_id, c.orig_instance_id, c.instancia_id)
WHERE m.wa_message_id IS NOT NULL
  AND m.wa_message_id NOT LIKE '%\_dest' ESCAPE '\'  -- ignora mirrors
  AND c.contact_id IS NOT NULL
  AND m.created_at > now() - interval '30 days'
ON CONFLICT (wa_message_id) DO NOTHING;

-- Log de quanto foi migrado
DO $$
DECLARE
  migrated_count INT;
  total_mensagens INT;
BEGIN
  SELECT count(*) INTO total_mensagens
    FROM public.mensagens
    WHERE wa_message_id IS NOT NULL
      AND wa_message_id NOT LIKE '%\_dest' ESCAPE '\'
      AND created_at > now() - interval '30 days';

  SELECT count(*) INTO migrated_count
    FROM public.messages m
    WHERE EXISTS (
      SELECT 1 FROM public.mensagens mens
      WHERE mens.wa_message_id = m.wa_message_id
        AND mens.created_at > now() - interval '30 days'
    );

  RAISE NOTICE 'Backfill mensagens → messages: % de % elegíveis agora em messages',
    migrated_count, total_mensagens;
END $$;
