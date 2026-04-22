-- Fila de mensagens recebidas pra debounce de 10s antes de chamar a IA.
-- Evita que IA responda 3 vezes quando lead manda 3 msgs seguidas ("oi", "tô interessado", "pode falar?").
-- Padrão "owner": a última msg do phone é a "dona" e processa todas as anteriores até ela, aí limpa.

CREATE TABLE IF NOT EXISTS public.campanha_msg_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  wa_message_id TEXT,
  text TEXT,
  message_type TEXT DEFAULT 'text',  -- text, audio, image, document, etc.
  media_url TEXT,
  instance_name TEXT,
  instance_uuid UUID,
  from_me BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_msg_queue_phone_created
  ON public.campanha_msg_queue(phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_msg_queue_created
  ON public.campanha_msg_queue(created_at);

ALTER TABLE public.campanha_msg_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_msg_queue" ON public.campanha_msg_queue
  FOR ALL USING (auth.role() = 'service_role');

-- Limpeza: cron que apaga registros > 5min (evita lixo se algo der errado)
SELECT cron.schedule(
  'limpar_campanha_msg_queue',
  '*/5 * * * *',
  $$DELETE FROM public.campanha_msg_queue WHERE created_at < now() - interval '5 minutes';$$
);
