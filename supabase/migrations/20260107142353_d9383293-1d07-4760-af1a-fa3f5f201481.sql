-- Habilitar REPLICA IDENTITY FULL para capturar dados completos das alterações
ALTER TABLE public.scheduled_messages REPLICA IDENTITY FULL;
ALTER TABLE public.scheduled_messages_log REPLICA IDENTITY FULL;

-- Adicionar as tabelas à publicação realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.scheduled_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.scheduled_messages_log;