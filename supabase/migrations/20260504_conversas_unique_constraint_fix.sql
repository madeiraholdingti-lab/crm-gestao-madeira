-- Hotfix: substituir índice partial UNIQUE por constraint UNIQUE full em
-- conversas (numero_contato, current_instance_id).
--
-- Bug: o índice partial `uq_conversas_numero_instancia` (com WHERE
-- current_instance_id IS NOT NULL) quebrava todos os UPSERTs de conversa
-- via webhook. supabase-js upsert(...{onConflict}) não casa com índice
-- parcial — Postgres retorna erro 42P10 "no unique or exclusion constraint
-- matching the ON CONFLICT specification".
--
-- Resultado: evolution-messages-webhook tentava criar conversa, falhava
-- silenciosamente (erro era logado mas só status=200 retornado), conversa
-- ficava sem ser criada → mensagens órfãs (sem aparecer no SDR Zap).
--
-- Detectado em 04/05/2026 ao investigar por que mensagens da Madeira não
-- apareciam no SDR Zap mesmo com Pipeline A funcionando. Bug GERAL —
-- afetava todas as instâncias, mas só ficou aparente nas novas.
--
-- Validação prévia (todas zero):
--   - 0 rows com current_instance_id IS NULL (UNIQUE full sem perda)
--   - 0 duplicados em (numero_contato, current_instance_id)

BEGIN;

DROP INDEX IF EXISTS public.uq_conversas_numero_instancia;

ALTER TABLE public.conversas
  ADD CONSTRAINT conversas_numero_instance_unique
  UNIQUE (numero_contato, current_instance_id);

COMMIT;
