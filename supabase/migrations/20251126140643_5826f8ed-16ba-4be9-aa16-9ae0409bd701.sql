-- Remover política antiga restritiva
DROP POLICY IF EXISTS "Apenas admins e médicos podem gerenciar instâncias" ON public.instancias_whatsapp;

-- Criar nova política permitindo secretarias também gerenciarem instâncias
CREATE POLICY "Admins, médicos e secretarias podem gerenciar instâncias"
ON public.instancias_whatsapp
FOR ALL
TO authenticated
USING (
  has_role(auth.uid(), 'admin_geral'::app_role) OR 
  has_role(auth.uid(), 'medico'::app_role) OR 
  has_role(auth.uid(), 'secretaria_medica'::app_role)
);