-- Habilitar realtime para tabela instancias_whatsapp
ALTER TABLE public.instancias_whatsapp REPLICA IDENTITY FULL;

-- Adicionar tabela à publicação de realtime (se ainda não estiver)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'instancias_whatsapp'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.instancias_whatsapp;
  END IF;
END $$;