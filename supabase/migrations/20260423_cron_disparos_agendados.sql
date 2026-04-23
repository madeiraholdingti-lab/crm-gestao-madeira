-- Recria o pg_cron pra processar-disparos-agendados.
-- Perdido na migração 18/04 (Supabase antigo -> novo). Desde então, "scheduled_messages"
-- não eram disparados automaticamente. Rodando a cada 5 minutos.
--
-- IMPORTANTE: Ao rodar essa migration num novo ambiente, substitua SERVICE_ROLE_KEY
-- pelo valor real. Ou execute uma vez:
--   ALTER DATABASE postgres SET app.service_role_key = '<service_role_key>';
-- e troque o Authorization pra 'Bearer ' || current_setting('app.service_role_key').
--
-- No Supabase atual (yycpctrcefxemgahhxgx) essa migration foi aplicada diretamente
-- via Management API em 23/04/2026 com o token real — este arquivo é só registro.

SELECT cron.schedule(
  'processar_disparos_agendados_job',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://yycpctrcefxemgahhxgx.supabase.co/functions/v1/processar-disparos-agendados',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer SERVICE_ROLE_KEY_HERE'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
