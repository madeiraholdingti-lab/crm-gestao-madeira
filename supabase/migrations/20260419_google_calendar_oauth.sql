-- Google Calendar OAuth — MVP só leitura
-- Cria infraestrutura pra Dr. Maikon conectar suas 2 contas Google em /perfil.
-- A cada 10min um cron chama google-calendar-sync que popula eventos_agenda.
-- Tokens OAuth são criptografados com pgcrypto (pgp_sym_encrypt).

BEGIN;

-- ============================================================
-- 1) Extensão de criptografia simétrica
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ============================================================
-- 2) Tabela de contas Google conectadas (uma por email por user)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.google_accounts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  email                   text NOT NULL,
  refresh_token_encrypted bytea NOT NULL,
  access_token_encrypted  bytea,
  expires_at              timestamptz,
  scopes                  text NOT NULL DEFAULT 'https://www.googleapis.com/auth/calendar.readonly',
  ativo                   boolean NOT NULL DEFAULT true,
  last_sync_at            timestamptz,
  last_sync_error         text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_accounts_user_email_unique UNIQUE (user_id, email)
);

COMMENT ON TABLE public.google_accounts IS
  'Contas Google OAuth conectadas por user. Tokens criptografados com pgp_sym_encrypt + GOOGLE_TOKEN_ENCRYPTION_KEY.';

-- ============================================================
-- 3) Extensões em eventos_agenda (rastrear origem e timezone)
-- ============================================================
ALTER TABLE public.eventos_agenda
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Sao_Paulo';

ALTER TABLE public.eventos_agenda
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'crm';

-- Check constraint pra origem (idempotente — só cria se ainda não existe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'eventos_agenda_origem_check'
  ) THEN
    ALTER TABLE public.eventos_agenda
      ADD CONSTRAINT eventos_agenda_origem_check
      CHECK (origem IN ('crm', 'google_sync'));
  END IF;
END $$;

ALTER TABLE public.eventos_agenda
  ADD COLUMN IF NOT EXISTS google_account_id uuid NULL;

-- FK pra google_accounts (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'eventos_agenda_google_account_fkey'
  ) THEN
    ALTER TABLE public.eventos_agenda
      ADD CONSTRAINT eventos_agenda_google_account_fkey
      FOREIGN KEY (google_account_id) REFERENCES public.google_accounts(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.eventos_agenda.origem IS
  'Origem do evento: crm (criado manualmente ou via n8n) ou google_sync (puxado do Google Calendar). Eventos google_sync são sobrescritos pelo sync; eventos crm nunca são tocados pelo sync.';

COMMENT ON COLUMN public.eventos_agenda.google_account_id IS
  'Qual conta Google trouxe este evento (se origem=google_sync). NULL para eventos origem=crm.';

-- ============================================================
-- 4) Índices
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_google_accounts_user_ativo
  ON public.google_accounts(user_id) WHERE ativo;

-- Unique parcial: uma conta não repete o mesmo evento do Google
CREATE UNIQUE INDEX IF NOT EXISTS idx_eventos_google_unique
  ON public.eventos_agenda(google_account_id, google_event_id)
  WHERE google_event_id IS NOT NULL;

-- ============================================================
-- 5) RLS em google_accounts
--    - SELECT/DELETE: user vê/deleta só suas; admin_geral vê tudo
--    - INSERT/UPDATE: somente service_role (edge functions) — policies ausentes bloqueiam por default
-- ============================================================
ALTER TABLE public.google_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_select_own_google_accounts" ON public.google_accounts;
CREATE POLICY "user_select_own_google_accounts"
  ON public.google_accounts
  FOR SELECT
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin_geral'::app_role));

DROP POLICY IF EXISTS "user_delete_own_google_accounts" ON public.google_accounts;
CREATE POLICY "user_delete_own_google_accounts"
  ON public.google_accounts
  FOR DELETE
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin_geral'::app_role));

-- ============================================================
-- 6) Trigger updated_at
-- ============================================================
DROP TRIGGER IF EXISTS update_google_accounts_updated_at ON public.google_accounts;
CREATE TRIGGER update_google_accounts_updated_at
  BEFORE UPDATE ON public.google_accounts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- 7) RPC pro edge function sync buscar contas ativas com tokens decriptados
--    - SECURITY DEFINER porque lê bytea criptografado
--    - REVOKE default — só service_role chama
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_active_google_accounts_decrypted(key text)
RETURNS TABLE(
  id uuid,
  user_id uuid,
  email text,
  refresh_token text,
  access_token text,
  expires_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    id,
    user_id,
    email,
    pgp_sym_decrypt(refresh_token_encrypted, key)::text AS refresh_token,
    COALESCE(pgp_sym_decrypt(access_token_encrypted, key)::text, '') AS access_token,
    expires_at
  FROM google_accounts
  WHERE ativo = true;
$$;

REVOKE ALL ON FUNCTION public.get_active_google_accounts_decrypted(text) FROM public, anon, authenticated;

COMMENT ON FUNCTION public.get_active_google_accounts_decrypted(text) IS
  'Retorna contas ativas com tokens decriptados. Apenas service_role pode chamar (edge functions).';

-- ============================================================
-- 7b) RPC pro edge function google-oauth-callback inserir/atualizar
--     com tokens JÁ criptografados via pgp_sym_encrypt.
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_google_account(
  p_user_id uuid,
  p_email text,
  p_refresh_token text,
  p_access_token text,
  p_expires_at timestamptz,
  p_scopes text,
  p_encryption_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO google_accounts (
    user_id, email,
    refresh_token_encrypted, access_token_encrypted,
    expires_at, scopes,
    ativo, last_sync_error
  ) VALUES (
    p_user_id, p_email,
    pgp_sym_encrypt(p_refresh_token, p_encryption_key),
    pgp_sym_encrypt(p_access_token, p_encryption_key),
    p_expires_at, p_scopes,
    true, NULL
  )
  ON CONFLICT (user_id, email) DO UPDATE SET
    refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
    access_token_encrypted  = EXCLUDED.access_token_encrypted,
    expires_at              = EXCLUDED.expires_at,
    scopes                  = EXCLUDED.scopes,
    ativo                   = true,
    last_sync_error         = NULL,
    updated_at              = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_google_account(uuid, text, text, text, timestamptz, text, text) FROM public, anon, authenticated;

COMMENT ON FUNCTION public.upsert_google_account IS
  'Upserta conta Google criptografando tokens. Apenas service_role pode chamar (edge function google-oauth-callback).';

-- ============================================================
-- 7c) RPC pro sync atualizar tokens decriptados após refresh
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_google_account_tokens(
  p_account_id uuid,
  p_access_token text,
  p_expires_at timestamptz,
  p_encryption_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE google_accounts
  SET access_token_encrypted = pgp_sym_encrypt(p_access_token, p_encryption_key),
      expires_at = p_expires_at,
      updated_at = now()
  WHERE id = p_account_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_google_account_tokens(uuid, text, timestamptz, text) FROM public, anon, authenticated;

COMMIT;

-- ============================================================
-- 8) pg_cron schedule (fora da transação — cron.schedule commita internamente)
--    Nota: service_role_key precisa estar setada via
--    ALTER DATABASE postgres SET app.service_role_key = '<chave>';
--    (executar uma vez no dashboard do Supabase)
-- ============================================================

-- Remove job anterior se existir (idempotente)
SELECT cron.unschedule('google_calendar_sync_job')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'google_calendar_sync_job');

-- Agenda o job a cada 10 minutos
SELECT cron.schedule(
  'google_calendar_sync_job',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://yycpctrcefxemgahhxgx.supabase.co/functions/v1/google-calendar-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
