-- Lembretes unificados como task
-- Toda "me lembre em X dias" ou "criar lembrete pro Maikon" vira uma row em
-- task_flow_tasks com tipo='lembrete'. Um cron de 5min varre e manda WA pelo
-- responsável quando o prazo se aproxima.

BEGIN;

-- ============================================================
-- 1) Novos campos em task_flow_tasks
-- ============================================================

ALTER TABLE public.task_flow_tasks
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'tarefa';

-- Check constraint idempotente (só cria se não existe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'task_flow_tasks_tipo_check'
  ) THEN
    ALTER TABLE public.task_flow_tasks
      ADD CONSTRAINT task_flow_tasks_tipo_check
      CHECK (tipo IN ('tarefa', 'lembrete'));
  END IF;
END $$;

-- Campo pra rastrear quando lembrete foi notificado via WA (evita repetir)
ALTER TABLE public.task_flow_tasks
  ADD COLUMN IF NOT EXISTS notificado_em timestamptz NULL;

COMMENT ON COLUMN public.task_flow_tasks.tipo IS
  'Tipo da task: "tarefa" (padrão) ou "lembrete" (gera WA pro responsável quando se aproxima do prazo)';

COMMENT ON COLUMN public.task_flow_tasks.notificado_em IS
  'Quando o lembrete foi enviado via WA pro responsável. Usado pra não notificar 2x.';

-- Índice pra query do cron (apenas lembretes pendentes não notificados)
CREATE INDEX IF NOT EXISTS idx_task_flow_lembretes_pendentes
  ON public.task_flow_tasks(prazo)
  WHERE tipo = 'lembrete'
    AND notificado_em IS NULL
    AND deleted_at IS NULL;

-- ============================================================
-- 2) pg_cron schedule
-- ============================================================

-- Remove job anterior se existir (idempotente)
SELECT cron.unschedule('enviar_lembretes_wa_job')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'enviar_lembretes_wa_job');

-- Agenda a cada 5 minutos
SELECT cron.schedule(
  'enviar_lembretes_wa_job',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://yycpctrcefxemgahhxgx.supabase.co/functions/v1/enviar-lembretes-wa',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5Y3BjdHJjZWZ4ZW1nYWhoeGd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjMxMjMzMCwiZXhwIjoyMDkxODg4MzMwfQ.F5lztxPnQeBsHLx6ujKluad3EUTSmZbeglc9iseF-ZI'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);

COMMIT;
