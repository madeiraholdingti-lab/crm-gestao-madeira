
ALTER TABLE public.ia_scripts
ADD COLUMN tipo_vaga text DEFAULT NULL,
ADD COLUMN presencial boolean DEFAULT NULL,
ADD COLUMN necessario_mudar boolean DEFAULT NULL,
ADD COLUMN detalhes_vaga text[] DEFAULT '{}';
