-- Config do assistente IA (Stage 6)
--
-- Maikon (ou qualquer admin na whitelist) manda msg começando com "/m "
-- OU "!bot " pra uma das instâncias conectadas. O webhook detecta, rotea
-- pra edge function assistente-maikon que responde com tool-calling.

ALTER TABLE public.config_global
  ADD COLUMN IF NOT EXISTS bot_admin_phones TEXT[] NULL,
  ADD COLUMN IF NOT EXISTS bot_ativo BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS bot_trigger_prefixes TEXT[] NOT NULL DEFAULT ARRAY['/m', '!bot', '/maikonect'];

COMMENT ON COLUMN public.config_global.bot_admin_phones IS
  'Whitelist de phones (só dígitos, sem +) autorizados a usar o bot via comando /m';
COMMENT ON COLUMN public.config_global.bot_trigger_prefixes IS
  'Prefixos que ativam o bot (case-insensitive). Default: /m, !bot, /maikonect';
