-- Habilitar realtime para a tabela mensagens
ALTER TABLE public.mensagens REPLICA IDENTITY FULL;

-- Adicionar tabela à publicação realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.mensagens;

-- Habilitar realtime para conversas também
ALTER TABLE public.conversas REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversas;