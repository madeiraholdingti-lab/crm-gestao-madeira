-- Deletar registros da tabela messages da instância RUBI
DELETE FROM public.messages 
WHERE instancia_whatsapp_id = 'fb58bdd0-fd1b-4d5d-936e-7affedf31886';

-- Deletar arquivos do storage da pasta RUBI
DELETE FROM storage.objects 
WHERE bucket_id = 'message-media' 
AND name LIKE 'RUBI/%';