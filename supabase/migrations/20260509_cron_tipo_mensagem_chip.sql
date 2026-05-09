-- Adiciona 'mensagem_chip' ao CHECK constraint de assistente_crons.tipo.
--
-- Tool enviar_mensagem_pelo_chip cria crons com tipo='mensagem_chip', mas o
-- constraint original só aceitava ('mensagem', 'briefing', 'versiculo'). INSERT
-- falhava silenciosamente com erro 23514 ("violates check constraint
-- assistente_crons_tipo_check") — Madeira só conseguia mandar mensagem imediata,
-- nunca agendar.
--
-- Detectado em 09/05 quando Maikon tentou agendar "Boa tarde mamãe Feliz dia
-- das mães" pra esposa Thaís de Bom (48 99050279) com 30min de antecedência.
-- 2 tentativas falharam.

BEGIN;

ALTER TABLE public.assistente_crons
  DROP CONSTRAINT IF EXISTS assistente_crons_tipo_check;

ALTER TABLE public.assistente_crons
  ADD CONSTRAINT assistente_crons_tipo_check
  CHECK (tipo IN ('mensagem', 'briefing', 'versiculo', 'mensagem_chip'));

COMMIT;
