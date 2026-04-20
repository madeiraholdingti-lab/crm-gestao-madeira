-- Fix: o ON CONFLICT do supabase-js com onConflict:'col1,col2' não está
-- conseguindo usar um UNIQUE partial index (com WHERE google_event_id IS NOT NULL)
-- como arbiter. Resultado: 180 eventos vindo da Google API, 0 upsertados.
--
-- Solução: substituir por UNIQUE index sem predicado. Isso é seguro porque:
-- - NULLs são tratados como distintos em UNIQUE (multiple NULLs OK)
-- - Eventos de outras origens (origem='crm') não têm google_event_id setado
--   → ficam todos como NULL, distintos entre si, sem violação.

BEGIN;

-- Remove o teste que inseri manualmente
DELETE FROM public.eventos_agenda WHERE google_event_id = 'test-event-001';

-- Substituir o índice parcial por um completo
DROP INDEX IF EXISTS public.idx_eventos_google_unique;

CREATE UNIQUE INDEX idx_eventos_google_unique
  ON public.eventos_agenda (google_account_id, google_event_id);

COMMIT;
