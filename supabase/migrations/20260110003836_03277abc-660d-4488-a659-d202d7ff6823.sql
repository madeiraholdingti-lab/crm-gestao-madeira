-- Criar tabela de notificações do sistema
CREATE TABLE public.notificacoes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo TEXT NOT NULL, -- 'instancia_caiu', 'disparo_concluido', 'erro', etc.
  titulo TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  dados JSONB, -- dados adicionais (envio_id, instancia_id, etc.)
  lida BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;

-- Política: todos os usuários autenticados podem ver notificações
CREATE POLICY "Usuários autenticados podem ver notificações" 
ON public.notificacoes 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

-- Política: usuários podem marcar como lida
CREATE POLICY "Usuários podem atualizar notificações" 
ON public.notificacoes 
FOR UPDATE 
USING (auth.uid() IS NOT NULL);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notificacoes;