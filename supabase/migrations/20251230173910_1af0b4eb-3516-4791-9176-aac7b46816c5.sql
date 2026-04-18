-- Modificar o trigger para NÃO criar role automaticamente
-- Usuários novos devem aguardar aprovação de um admin

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Criar apenas o perfil, SEM role
  -- A role será atribuída manualmente por um admin após aprovação
  INSERT INTO public.profiles (id, nome, telefone_contato, ativo)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', NEW.email),
    NEW.raw_user_meta_data->>'telefone_contato',
    false  -- Usuário começa inativo até ser aprovado
  );
  
  -- NÃO inserir role aqui - admin deve aprovar primeiro
  
  RETURN NEW;
END;
$$;