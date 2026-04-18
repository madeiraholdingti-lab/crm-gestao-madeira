-- Criar tabela de configuração global (singleton)
CREATE TABLE IF NOT EXISTS public.config_global (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evolution_base_url text NOT NULL DEFAULT 'https://honourless-reusable-mercedez.ngrok-free.dev',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.config_global ENABLE ROW LEVEL SECURITY;

-- Políticas: Todos podem ler, apenas admin_geral pode atualizar
CREATE POLICY "Todos podem ler configurações globais"
ON public.config_global
FOR SELECT
USING (true);

CREATE POLICY "Apenas admins podem atualizar configurações"
ON public.config_global
FOR UPDATE
USING (has_role(auth.uid(), 'admin_geral'::app_role));

CREATE POLICY "Apenas admins podem inserir configurações"
ON public.config_global
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin_geral'::app_role));

-- Inserir registro inicial (singleton)
INSERT INTO public.config_global (evolution_base_url)
VALUES ('https://honourless-reusable-mercedez.ngrok-free.dev')
ON CONFLICT DO NOTHING;

-- Trigger para updated_at
CREATE TRIGGER update_config_global_updated_at
BEFORE UPDATE ON public.config_global
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();