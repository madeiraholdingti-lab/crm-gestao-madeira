-- Suporte a cron one-shot.
-- Worker desativa o cron (ativo=false) após a primeira execução bem-sucedida
-- quando apenas_uma_vez=true. Evita lembretes pontuais virando spam diário.

BEGIN;

ALTER TABLE public.assistente_crons
  ADD COLUMN IF NOT EXISTS apenas_uma_vez BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.assistente_crons.apenas_uma_vez IS
  'Se true, worker seta ativo=false após a 1ª execução. Pra lembretes pontuais ("hoje 18h30").';

COMMIT;
