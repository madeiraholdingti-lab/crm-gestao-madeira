-- Adicionar policy de SELECT para que disparadores (e todos autenticados) possam ver instâncias
CREATE POLICY "Usuários autenticados podem ver instâncias"
ON public.instancias_whatsapp
FOR SELECT
USING (auth.uid() IS NOT NULL);