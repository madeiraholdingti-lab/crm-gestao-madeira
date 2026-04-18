
ALTER TABLE public.campanhas_disparo
ADD COLUMN script_ia_id uuid REFERENCES public.ia_scripts(id) ON DELETE SET NULL;
