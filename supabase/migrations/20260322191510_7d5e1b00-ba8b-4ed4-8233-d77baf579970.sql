CREATE TABLE public.briefings_home (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  conteudo text NOT NULL,
  links_acao jsonb DEFAULT '[]'::jsonb,
  gerado_em timestamptz DEFAULT now()
);

ALTER TABLE public.briefings_home ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuários podem ver seus próprios briefings"
  ON public.briefings_home FOR SELECT
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin_geral'::app_role));

CREATE POLICY "Service role pode inserir briefings"
  ON public.briefings_home FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role pode deletar briefings"
  ON public.briefings_home FOR DELETE
  USING (true);

CREATE INDEX idx_briefings_home_user_gerado ON public.briefings_home(user_id, gerado_em DESC);