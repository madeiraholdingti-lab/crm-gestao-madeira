-- Add DELETE policy for campanha_envios to allow removing leads not yet sent
CREATE POLICY "Usuários autenticados podem deletar envios não enviados"
ON public.campanha_envios
FOR DELETE
USING (
  auth.uid() IS NOT NULL 
  AND status IN ('enviar', 'reenviar', 'pendente')
);