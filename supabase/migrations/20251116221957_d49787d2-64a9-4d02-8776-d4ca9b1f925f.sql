-- Remover políticas antigas que restringem apenas a admins
DROP POLICY IF EXISTS "Admins podem ver todos os contatos" ON public.contacts;
DROP POLICY IF EXISTS "Admins podem inserir contatos" ON public.contacts;
DROP POLICY IF EXISTS "Admins podem atualizar contatos" ON public.contacts;
DROP POLICY IF EXISTS "Admins podem ver todas as mensagens" ON public.messages;
DROP POLICY IF EXISTS "Admins podem inserir mensagens" ON public.messages;
DROP POLICY IF EXISTS "Admins podem atualizar mensagens" ON public.messages;

-- Criar novas políticas para usuários autenticados
CREATE POLICY "Usuários autenticados podem ver contatos"
ON public.contacts
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem inserir contatos"
ON public.contacts
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem atualizar contatos"
ON public.contacts
FOR UPDATE
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem ver mensagens"
ON public.messages
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem inserir mensagens"
ON public.messages
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem atualizar mensagens"
ON public.messages
FOR UPDATE
USING (auth.uid() IS NOT NULL);