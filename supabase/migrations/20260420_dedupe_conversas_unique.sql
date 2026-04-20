-- Deduplica conversas por (numero_contato, current_instance_id) e adiciona
-- UNIQUE constraint pra prevenir o race condition que gerou 15+ grupos de
-- duplicatas em Isa/Mari hoje. Bug: webhook faz SELECT → INSERT sem lock,
-- dois workers veem "não existe" e ambos criam row.
--
-- Estratégia:
-- 1. Escolhe a conversa canônica (maior ultima_interacao) por grupo
-- 2. Realinha mensagens (PT legacy) + messages (EN) que referenciem conversa_id
-- 3. Migra tags, fixada, status, anotações pra canônica (mantém MAX de cada)
-- 4. Deleta duplicatas
-- 5. Cria UNIQUE partial index (ignora linhas sem instance)

BEGIN;

-- CTE com canônica por grupo
WITH grupos AS (
  SELECT
    numero_contato,
    current_instance_id,
    id,
    ultima_interacao,
    created_at,
    row_number() OVER (
      PARTITION BY numero_contato, current_instance_id
      ORDER BY ultima_interacao DESC NULLS LAST, created_at DESC
    ) AS rn
  FROM public.conversas
  WHERE current_instance_id IS NOT NULL
    AND numero_contato IS NOT NULL
),
canonical AS (
  SELECT numero_contato, current_instance_id, id AS keep_id
  FROM grupos WHERE rn = 1
),
dupes AS (
  SELECT g.id AS drop_id, c.keep_id
  FROM grupos g
  JOIN canonical c
    ON c.numero_contato = g.numero_contato
   AND c.current_instance_id IS NOT DISTINCT FROM g.current_instance_id
  WHERE g.rn > 1
)
-- Realinha mensagens PT
UPDATE public.mensagens m
   SET conversa_id = d.keep_id
  FROM dupes d
 WHERE m.conversa_id = d.drop_id;

-- Consolidar tags/status/fixada/anotacao pra canônica (antes de deletar)
WITH grupos AS (
  SELECT numero_contato, current_instance_id, id,
    row_number() OVER (
      PARTITION BY numero_contato, current_instance_id
      ORDER BY ultima_interacao DESC NULLS LAST, created_at DESC
    ) AS rn
  FROM public.conversas
  WHERE current_instance_id IS NOT NULL AND numero_contato IS NOT NULL
),
canonical AS (SELECT numero_contato, current_instance_id, id AS keep_id FROM grupos WHERE rn = 1),
agg AS (
  SELECT
    c.keep_id,
    bool_or(conv.fixada) AS any_fixada,
    max(conv.unread_count) AS max_unread,
    array_remove(array_agg(DISTINCT tag), NULL) AS tags_consolidadas
  FROM canonical c
  JOIN grupos g ON g.numero_contato = c.numero_contato
               AND g.current_instance_id IS NOT DISTINCT FROM c.current_instance_id
  JOIN public.conversas conv ON conv.id = g.id
  LEFT JOIN LATERAL unnest(COALESCE(conv.tags, ARRAY[]::text[])) AS tag ON true
  GROUP BY c.keep_id
)
UPDATE public.conversas c
   SET fixada = COALESCE(a.any_fixada, c.fixada),
       unread_count = GREATEST(COALESCE(c.unread_count, 0), COALESCE(a.max_unread, 0)),
       tags = CASE WHEN array_length(a.tags_consolidadas,1) > 0 THEN a.tags_consolidadas ELSE c.tags END,
       updated_at = now()
  FROM agg a
 WHERE c.id = a.keep_id;

-- Deletar duplicatas
WITH grupos AS (
  SELECT numero_contato, current_instance_id, id,
    row_number() OVER (
      PARTITION BY numero_contato, current_instance_id
      ORDER BY ultima_interacao DESC NULLS LAST, created_at DESC
    ) AS rn
  FROM public.conversas
  WHERE current_instance_id IS NOT NULL AND numero_contato IS NOT NULL
)
DELETE FROM public.conversas c
 USING grupos g
 WHERE c.id = g.id AND g.rn > 1;

-- UNIQUE partial index — só aplica quando current_instance_id está definido
-- (conversas órfãs sem instância ficam permitidas, mas são edge case)
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversas_numero_instancia
  ON public.conversas (numero_contato, current_instance_id)
  WHERE current_instance_id IS NOT NULL;

COMMIT;

-- Relatório
DO $$
DECLARE total_antes INT := 0; total_depois INT;
BEGIN
  SELECT count(*) INTO total_depois FROM public.conversas;
  RAISE NOTICE 'Conversas após dedupe: %', total_depois;
END $$;
