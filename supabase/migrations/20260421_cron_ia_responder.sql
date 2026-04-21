-- Cron a cada 2min: varre envios em_conversa com msg do contato >15s atrás
-- e processa via IA. Anti-debounce: se lead tá picando mensagens, espera
-- pausar antes de responder.

SELECT cron.schedule(
  'campanha_ia_responder_job',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://yycpctrcefxemgahhxgx.supabase.co/functions/v1/campanha-ia-responder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5Y3BjdHJjZWZ4ZW1nYWhoeGd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjMxMjMzMCwiZXhwIjoyMDkxODg4MzMwfQ.F5lztxPnQeBsHLx6ujKluad3EUTSmZbeglc9iseF-ZI'
    ),
    body := '{}'::jsonb
  );
  $$
);
