-- Fix: contatos contaminados com nome de instâncias da equipe
-- Dor do user em 21/04: "não sei quem é quem entre Isadora e Maikon em
-- várias conversas". Causa: em 13/04 um contacts.set do Evolution
-- sincronizou a agenda pessoal da Isadora e aplicou o pushName dela
-- ("Isadora Cristina Volek") em múltiplos contatos com números diferentes.
--
-- Contaminação identificada:
-- - 6 contatos com name='Isadora Cristina Volek' e phone ≠ 554799486377
-- - Potencial mesmo problema com "Dr. Maikon Madeira" se outros phones
--   tiverem o nome dele (investigar caso a caso)

BEGIN;

-- 1. Isadora — só preserva a contact real (phone 554799486377)
UPDATE public.contacts
SET name = NULL, updated_at = now()
WHERE name = 'Isadora Cristina Volek'
  AND phone <> '554799486377';

-- 2. Dr. Maikon Madeira variações — preserva só o real (554792153480)
UPDATE public.contacts
SET name = NULL, updated_at = now()
WHERE (name = 'Dr. Maikon Madeira' OR name = 'Dr Maikon Madeira Gss Saúde .:')
  AND phone <> '554792153480';

-- 3. Atualizar nome_contato nas conversas que herdaram o nome contaminado
-- Se a conversa aponta pra contact_id cujo name foi zerado, zera também
-- o nome_contato pra refazer o display com phone.
UPDATE public.conversas c
   SET nome_contato = NULL, updated_at = now()
  FROM public.contacts ct
 WHERE c.contact_id = ct.id
   AND ct.name IS NULL
   AND c.nome_contato IN ('Isadora Cristina Volek', 'Dr. Maikon Madeira', 'Dr Maikon Madeira Gss Saúde .:');

-- 4. Relatório
SELECT
  'contatos_limpos' AS ref,
  count(*)::text AS val
FROM public.contacts
WHERE name IS NULL
  AND updated_at::date = CURRENT_DATE
  AND phone IN (
    '551128902121','554796643717','554891171728','554799700769','554896737911'
  )
UNION ALL
SELECT 'contatos_isadora_restantes', count(*)::text
FROM public.contacts WHERE name = 'Isadora Cristina Volek'
UNION ALL
SELECT 'contatos_maikon_restantes', count(*)::text
FROM public.contacts WHERE name ILIKE '%maikon madeira%' AND name NOT ILIKE '%consultório%';

COMMIT;
