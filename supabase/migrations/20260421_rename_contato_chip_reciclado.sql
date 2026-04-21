-- Fix: contato com nome antigo preso a um número que virou chip de
-- instância nova. Caso específico: contact_id feca3054...
-- - phone 554788342543 = chip atual da Mariana-Chiarello
-- - name "Ewerton Rubí" (dono anterior do número)
-- - profile_picture_url sincronizada pro da Mariana (foto atual do número)
-- - 2.272 mensagens híbridas (Ewerton antigo + Mariana atual)
--
-- Sem forma segura de separar, rename pro dono atual do número.

UPDATE public.contacts
SET
  name = 'Mariana Chiarello',
  updated_at = now()
WHERE id = 'feca3054-110b-40e2-8d29-f38ed3b6284c';

-- Atualizar conversas que herdaram o nome antigo
UPDATE public.conversas
SET
  nome_contato = 'Mariana Chiarello',
  updated_at = now()
WHERE contact_id = 'feca3054-110b-40e2-8d29-f38ed3b6284c'
  AND nome_contato = 'Ewerton Rubí';

SELECT 'contato_final' AS ref, name || ' | ' || phone AS val
FROM public.contacts WHERE id = 'feca3054-110b-40e2-8d29-f38ed3b6284c'
UNION ALL
SELECT 'conversas_atualizadas', count(*)::text
FROM public.conversas WHERE contact_id = 'feca3054-110b-40e2-8d29-f38ed3b6284c' AND nome_contato = 'Mariana Chiarello';
