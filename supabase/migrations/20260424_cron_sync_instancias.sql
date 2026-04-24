-- pg_cron pra sincronizar status Supabase ↔ Evolution a cada 5min.
-- Edge function `sync-instancias-evolution` é conservadora — só detecta queda
-- (ativa→inativa) e remoção (sem existir → deletada). Retorno pra 'ativa'
-- só acontece via polling da UI de conectar (QR escaneado).

SELECT cron.schedule(
  'sync_instancias_evolution_job',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://yycpctrcefxemgahhxgx.supabase.co/functions/v1/sync-instancias-evolution',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer SERVICE_ROLE_KEY_HERE'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
