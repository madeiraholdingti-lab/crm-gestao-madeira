-- Dedup de webhook por wa_message_id.
--
-- Caso real (print 16/05 09:12-09:14): Maikon mandou 2 replies a lembretes
-- e Madeira respondeu 6 vezes em 2 minutos. Causa: Evolution retransmite o
-- webhook se a edge function demora >25s pra responder (Gemini + tools fazem
-- isso). Sem dedup por wa_message_id, cada retransmissão vira uma resposta
-- duplicada.
--
-- Fix:
--  1) Madeira-router agora responde 200 IMEDIATAMENTE (EdgeRuntime.waitUntil
--     mantém o fan-out vivo). Reduz drasticamente retransmissão.
--  2) assistente-maikon-pessoal checa wa_message_id no audit_log no START
--     do handler — se já processado, skip. Backup contra retransmissões que
--     vencerem o item (1).
--
-- Sem índice o check faz seq scan na tabela inteira. Partial index com
-- WHERE wa_message_id IS NOT NULL evita inflar o índice com NULLs dos
-- testes diretos (modo {text:...} não tem wamid).
CREATE INDEX IF NOT EXISTS idx_audit_wa_message_id
  ON public.assistente_audit_log(wa_message_id)
  WHERE wa_message_id IS NOT NULL;
