
ALTER TABLE public.conversas
  ADD COLUMN IF NOT EXISTS follow_up_em timestamptz,
  ADD COLUMN IF NOT EXISTS follow_up_nota text;

CREATE INDEX IF NOT EXISTS idx_conversas_follow_up
  ON public.conversas(follow_up_em)
  WHERE follow_up_em IS NOT NULL;
