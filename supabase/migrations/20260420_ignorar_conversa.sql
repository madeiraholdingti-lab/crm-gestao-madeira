-- Feature "Ignorar conversa" — dor do Maikon na reunião de 20/04:
-- "as vezes recebo mensagem que não quero responder (vendedor de móveis, etc)
-- tem um lugar pra jogar fora desse 'sem resposta' pra ela não ficar batendo?"
--
-- Solução: flag de ignorada na conversa + motivo opcional pra auditoria.
-- Conversas ignoradas somem do Monitor/filtro "pendentes" e vão pra aba própria.

ALTER TABLE public.conversas
  ADD COLUMN IF NOT EXISTS ignorada_em TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS ignorada_motivo TEXT NULL,
  ADD COLUMN IF NOT EXISTS ignorada_por UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Index pra filtro rápido de "não ignoradas"
CREATE INDEX IF NOT EXISTS idx_conversas_nao_ignoradas
  ON public.conversas (current_instance_id, ultima_interacao DESC)
  WHERE ignorada_em IS NULL;

COMMENT ON COLUMN public.conversas.ignorada_em IS
  'Timestamp quando usuário marcou a conversa como ignorada. NULL = não ignorada';
COMMENT ON COLUMN public.conversas.ignorada_motivo IS
  'Motivo opcional. Ex: "vendedor", "spam", "resolver depois"';
COMMENT ON COLUMN public.conversas.ignorada_por IS
  'Quem ignorou — auditoria pro Maikon saber qual secretária fez';
