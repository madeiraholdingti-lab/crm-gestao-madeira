-- =====================================================
-- CORREÇÕES DE SEGURANÇA - POLÍTICAS RLS
-- =====================================================

-- 1. CORRIGIR POLÍTICAS RLS DA TABELA CONVERSAS
-- Remover políticas permissivas atuais
DROP POLICY IF EXISTS "Usuários podem ver todas as conversas" ON public.conversas;
DROP POLICY IF EXISTS "Usuários podem atualizar conversas" ON public.conversas;
DROP POLICY IF EXISTS "Usuários podem criar conversas" ON public.conversas;

-- Criar políticas restritivas
-- 1.1 SELECT: Usuários podem ver apenas suas conversas atribuídas ou não atribuídas + admins
CREATE POLICY "Usuários podem ver apenas suas conversas atribuídas ou não atribuídas"
ON public.conversas
FOR SELECT
USING (
  responsavel_atual = auth.uid() OR 
  responsavel_atual IS NULL OR
  public.has_role(auth.uid(), 'admin_geral')
);

-- 1.2 UPDATE: Usuários podem atualizar apenas suas conversas atribuídas + admins
CREATE POLICY "Usuários podem atualizar apenas suas conversas atribuídas"
ON public.conversas
FOR UPDATE
USING (
  responsavel_atual = auth.uid() OR 
  public.has_role(auth.uid(), 'admin_geral')
);

-- 1.3 INSERT: Usuários autenticados podem criar conversas
CREATE POLICY "Usuários autenticados podem criar conversas"
ON public.conversas
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- 1.4 DELETE: Apenas admins podem deletar conversas
CREATE POLICY "Apenas admins podem deletar conversas"
ON public.conversas
FOR DELETE
USING (public.has_role(auth.uid(), 'admin_geral'));

-- 2. CORRIGIR POLÍTICAS RLS DA TABELA MENSAGENS
-- Remover políticas permissivas atuais
DROP POLICY IF EXISTS "Usuários podem ver mensagens de todas as conversas" ON public.mensagens;
DROP POLICY IF EXISTS "Usuários podem atualizar mensagens" ON public.mensagens;
DROP POLICY IF EXISTS "Usuários podem criar mensagens" ON public.mensagens;

-- Criar políticas restritivas
-- 2.1 SELECT: Usuários podem ver mensagens apenas das conversas atribuídas a eles
CREATE POLICY "Usuários podem ver mensagens apenas de suas conversas"
ON public.mensagens
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.conversas
    WHERE conversas.id = mensagens.conversa_id
    AND (
      conversas.responsavel_atual = auth.uid() OR 
      public.has_role(auth.uid(), 'admin_geral')
    )
  )
);

-- 2.2 INSERT: Usuários podem criar mensagens apenas em suas conversas atribuídas
CREATE POLICY "Usuários podem criar mensagens apenas em suas conversas"
ON public.mensagens
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.conversas
    WHERE conversas.id = mensagens.conversa_id
    AND (
      conversas.responsavel_atual = auth.uid() OR
      public.has_role(auth.uid(), 'admin_geral')
    )
  )
);

-- 2.3 UPDATE: Usuários podem atualizar apenas mensagens que enviaram + admins
CREATE POLICY "Usuários podem atualizar apenas suas próprias mensagens"
ON public.mensagens
FOR UPDATE
USING (
  enviado_por = auth.uid() OR 
  public.has_role(auth.uid(), 'admin_geral')
);

-- 2.4 DELETE: Mensagens não podem ser deletadas (trilha de auditoria)
CREATE POLICY "Mensagens não podem ser deletadas"
ON public.mensagens
FOR DELETE
USING (false);

-- 3. PROTEGER TOKENS DA API WHATSAPP
-- Remover política que permite todos usuários verem instâncias
DROP POLICY IF EXISTS "Todos usuários autenticados podem ver instâncias" ON public.instancias_whatsapp;

-- A política "Apenas admins e médicos podem gerenciar instâncias" já existe e cobre SELECT, INSERT, UPDATE, DELETE
-- Não é necessário criar nova política