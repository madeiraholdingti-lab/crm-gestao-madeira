-- Enable realtime for campanha_envios table
ALTER TABLE public.campanha_envios REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.campanha_envios;