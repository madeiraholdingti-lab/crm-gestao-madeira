-- pg_cron pra healthcheck real do socket Baileys de cada instância ativa.
-- Complementa sync-instancias-evolution (que confia no /fetchInstances que mente).
-- Rodando a cada 5min — se Baileys morrer entre cron e cron, dispara descobre.

SELECT cron.schedule(
  'healthcheck_instancias_job',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://yycpctrcefxemgahhxgx.supabase.co/functions/v1/healthcheck-instancias',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
