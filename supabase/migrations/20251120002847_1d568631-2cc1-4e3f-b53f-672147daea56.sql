-- Adicionar campo instancia_padrao_id à tabela profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS instancia_padrao_id uuid REFERENCES public.instancias_whatsapp(id) ON DELETE SET NULL;

-- Adicionar campo ativo à tabela profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;

-- Criar índice para melhorar performance
CREATE INDEX IF NOT EXISTS idx_profiles_instancia_padrao ON public.profiles(instancia_padrao_id);

-- Atualizar RLS policies para profiles
-- Permitir que admins vejam todos os perfis
DROP POLICY IF EXISTS "Usuários podem ver seu próprio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Usuários podem atualizar seu próprio perfil" ON public.profiles;

CREATE POLICY "Usuários podem ver seu próprio perfil ou admins veem todos"
ON public.profiles
FOR SELECT
USING (
  auth.uid() = id OR 
  has_role(auth.uid(), 'admin_geral'::app_role)
);

CREATE POLICY "Usuários podem atualizar seu próprio perfil"
ON public.profiles
FOR UPDATE
USING (auth.uid() = id);

CREATE POLICY "Apenas admins podem atualizar todos os perfis"
ON public.profiles
FOR UPDATE
USING (has_role(auth.uid(), 'admin_geral'::app_role));

CREATE POLICY "Apenas admins podem inserir perfis"
ON public.profiles
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin_geral'::app_role));

-- Criar função helper para buscar dados completos do usuário logado
CREATE OR REPLACE FUNCTION public.get_current_user_profile()
RETURNS TABLE (
  id uuid,
  nome text,
  telefone_contato text,
  cor_perfil text,
  instancia_padrao_id uuid,
  ativo boolean,
  role app_role,
  instancia_nome text,
  instancia_numero text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    p.id,
    p.nome,
    p.telefone_contato,
    p.cor_perfil,
    p.instancia_padrao_id,
    p.ativo,
    ur.role,
    i.nome_instancia,
    i.numero_chip
  FROM public.profiles p
  LEFT JOIN public.user_roles ur ON ur.user_id = p.id
  LEFT JOIN public.instancias_whatsapp i ON i.id = p.instancia_padrao_id
  WHERE p.id = auth.uid()
  LIMIT 1;
$$;