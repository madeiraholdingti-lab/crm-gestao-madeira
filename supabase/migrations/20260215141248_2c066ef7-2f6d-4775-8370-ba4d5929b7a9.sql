
ALTER TABLE public.notificacoes ADD COLUMN user_id uuid REFERENCES auth.users(id);

CREATE INDEX idx_notificacoes_user_id ON public.notificacoes(user_id);
