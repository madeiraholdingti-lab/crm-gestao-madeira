-- pg_cron 1h pra reconciliar conversas.unread_count com Evolution Chat.unreadMessages
-- Resolve casos de race no handler messages.update READ + acúmulo histórico.

SELECT cron.schedule(
  'sync_unread_evolution_job',
  '17 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://yycpctrcefxemgahhxgx.supabase.co/functions/v1/sync-unread-evolution',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
