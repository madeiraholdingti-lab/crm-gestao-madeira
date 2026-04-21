-- Cron job: a cada 10min, chama processar-campanha-v2 em modo "cron"
-- (sem campanha_id específica) pra ele varrer campanhas ativas e elegíveis.
-- A função por si só já valida janela horário/dia da semana na campanha.

SELECT cron.schedule(
  'processar_campanhas_v2_job',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://yycpctrcefxemgahhxgx.supabase.co/functions/v1/processar-campanha-v2',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5Y3BjdHJjZWZ4ZW1nYWhoeGd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjMxMjMzMCwiZXhwIjoyMDkxODg4MzMwfQ.F5lztxPnQeBsHLx6ujKluad3EUTSmZbeglc9iseF-ZI'
    ),
    body := '{}'::jsonb
  );
  $$
);
