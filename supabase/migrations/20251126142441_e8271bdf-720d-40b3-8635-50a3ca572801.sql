
-- Remover política antiga restritiva de UPDATE
DROP POLICY IF EXISTS "Usuários podem atualizar apenas suas conversas atribuídas" ON public.conversas;

-- Criar nova política permitindo todos usuários autenticados atualizarem conversas
-- Isso é necessário para que secretárias possam transferir conversas entre si
CREATE POLICY "Usuários autenticados podem atualizar conversas"
ON public.conversas
FOR UPDATE
TO authenticated
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);
