-- 1. Criar tabela user_roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE (user_id, role)
);

-- 2. Migrar dados existentes de profiles para user_roles
INSERT INTO public.user_roles (user_id, role)
SELECT id, funcao FROM public.profiles
WHERE funcao IS NOT NULL
ON CONFLICT (user_id, role) DO NOTHING;

-- 3. Habilitar RLS na tabela user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 4. Criar função has_role com SECURITY DEFINER (antes de remover a coluna)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- 5. Criar função para obter role do usuário
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.user_roles
  WHERE user_id = _user_id
  LIMIT 1
$$;

-- 6. REMOVER a política antiga que depende da coluna funcao
DROP POLICY IF EXISTS "Apenas admins e médicos podem gerenciar instâncias" ON public.instancias_whatsapp;

-- 7. Agora podemos remover a coluna funcao
ALTER TABLE public.profiles DROP COLUMN funcao;

-- 8. Recriar a política usando has_role
CREATE POLICY "Apenas admins e médicos podem gerenciar instâncias"
ON public.instancias_whatsapp
FOR ALL
USING (
  public.has_role(auth.uid(), 'admin_geral') OR 
  public.has_role(auth.uid(), 'medico')
);

-- 9. Políticas RLS para user_roles
CREATE POLICY "Usuários podem ver suas próprias roles"
ON public.user_roles
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Admins podem gerenciar todas as roles"
ON public.user_roles
FOR ALL
USING (public.has_role(auth.uid(), 'admin_geral'));

-- 10. Atualizar trigger handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Criar perfil
  INSERT INTO public.profiles (id, nome, telefone_contato)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', NEW.email),
    NEW.raw_user_meta_data->>'telefone_contato'
  );
  
  -- Criar role padrão (secretaria_medica)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (
    NEW.id,
    COALESCE((NEW.raw_user_meta_data->>'funcao')::app_role, 'secretaria_medica'::app_role)
  );
  
  RETURN NEW;
END;
$$;