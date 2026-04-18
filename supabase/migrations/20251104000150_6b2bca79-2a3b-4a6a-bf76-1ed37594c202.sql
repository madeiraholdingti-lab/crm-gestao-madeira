-- 1. Criar função has_role com SECURITY DEFINER
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

-- 2. Criar função para obter role do usuário
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

-- 3. Políticas RLS para user_roles
DROP POLICY IF EXISTS "Usuários podem ver suas próprias roles" ON public.user_roles;
CREATE POLICY "Usuários podem ver suas próprias roles"
ON public.user_roles
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins podem gerenciar todas as roles" ON public.user_roles;
CREATE POLICY "Admins podem gerenciar todas as roles"
ON public.user_roles
FOR ALL
USING (public.has_role(auth.uid(), 'admin_geral'));

-- 4. Atualizar política de instancias_whatsapp
DROP POLICY IF EXISTS "Apenas admins e médicos podem gerenciar instâncias" ON public.instancias_whatsapp;
CREATE POLICY "Apenas admins e médicos podem gerenciar instâncias"
ON public.instancias_whatsapp
FOR ALL
USING (
  public.has_role(auth.uid(), 'admin_geral') OR 
  public.has_role(auth.uid(), 'medico')
);

-- 5. Atualizar trigger handle_new_user
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