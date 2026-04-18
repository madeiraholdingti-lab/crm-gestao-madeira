
-- Clean up duplicate leads, keep the most recent one
DELETE FROM public.leads
WHERE id NOT IN (
  SELECT DISTINCT ON (telefone) id
  FROM public.leads
  ORDER BY telefone, updated_at DESC
);

-- Now add unique constraint
CREATE UNIQUE INDEX leads_telefone_unique ON public.leads(telefone);
