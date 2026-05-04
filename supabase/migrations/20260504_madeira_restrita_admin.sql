-- Restringe visibilidade da instância Agent-Madeira (chip pessoal do Maikon)
-- só pra usuários com role admin_geral.
--
-- Hoje: messages/conversas/instancias_whatsapp são visíveis pra todo authenticated.
-- Após esta migration: instâncias com restrita_admin=true só aparecem pra admin_geral
-- (incluindo as conversas e mensagens vinculadas a elas).

BEGIN;

-- 1) Coluna flag (idempotente — pode já ter sido criada inline)
ALTER TABLE public.instancias_whatsapp
  ADD COLUMN IF NOT EXISTS restrita_admin BOOLEAN NOT NULL DEFAULT false;

-- 2) Marca Agent-Madeira como restrita (idempotente)
UPDATE public.instancias_whatsapp
SET restrita_admin = true
WHERE nome_instancia = 'Agent-Madeira' AND restrita_admin = false;

-- 3) Substitui SELECT policy de instancias_whatsapp pra respeitar a flag
DROP POLICY IF EXISTS "Usuários autenticados podem ver instâncias" ON public.instancias_whatsapp;
DROP POLICY IF EXISTS "ver_instancias_respeitando_restrita" ON public.instancias_whatsapp;
CREATE POLICY "ver_instancias_respeitando_restrita"
  ON public.instancias_whatsapp
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND (
      NOT restrita_admin OR has_role(auth.uid(), 'admin_geral'::app_role)
    )
  );

-- 4) Substitui SELECT policy de messages
DROP POLICY IF EXISTS "Usuários autenticados podem ver mensagens" ON public.messages;
DROP POLICY IF EXISTS "ver_mensagens_respeitando_restrita" ON public.messages;
CREATE POLICY "ver_mensagens_respeitando_restrita"
  ON public.messages
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND (
      instancia_whatsapp_id IS NULL OR EXISTS (
        SELECT 1 FROM public.instancias_whatsapp i
        WHERE i.id = messages.instancia_whatsapp_id
          AND (NOT i.restrita_admin OR has_role(auth.uid(), 'admin_geral'::app_role))
      )
    )
  );

-- 5) Substitui SELECT policy de conversas
DROP POLICY IF EXISTS "Usuários podem ver apenas suas conversas atribuídas ou não a" ON public.conversas;
DROP POLICY IF EXISTS "ver_conversas_respeitando_restrita" ON public.conversas;
CREATE POLICY "ver_conversas_respeitando_restrita"
  ON public.conversas
  FOR SELECT
  USING (
    (
      responsavel_atual = auth.uid()
      OR responsavel_atual IS NULL
      OR has_role(auth.uid(), 'admin_geral'::app_role)
    )
    AND (
      current_instance_id IS NULL OR EXISTS (
        SELECT 1 FROM public.instancias_whatsapp i
        WHERE i.id = conversas.current_instance_id
          AND (NOT i.restrita_admin OR has_role(auth.uid(), 'admin_geral'::app_role))
      )
    )
  );

COMMIT;
