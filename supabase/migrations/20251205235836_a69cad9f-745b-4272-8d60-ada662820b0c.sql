-- Adicionar colunas de mídia na tabela messages
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS media_url text,
ADD COLUMN IF NOT EXISTS media_mime_type text;

-- Criar bucket para armazenar mídias de mensagens
INSERT INTO storage.buckets (id, name, public)
VALUES ('message-media', 'message-media', true)
ON CONFLICT (id) DO NOTHING;

-- Políticas para o bucket de mídia
CREATE POLICY "Mídia acessível publicamente" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'message-media');

CREATE POLICY "Service role pode inserir mídia" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'message-media');

CREATE POLICY "Service role pode deletar mídia" 
ON storage.objects FOR DELETE 
USING (bucket_id = 'message-media');

-- Comentários para documentação
COMMENT ON COLUMN public.messages.media_url IS 'URL pública do arquivo de mídia no Supabase Storage';
COMMENT ON COLUMN public.messages.media_mime_type IS 'MIME type do arquivo de mídia (ex: image/jpeg, audio/ogg)';