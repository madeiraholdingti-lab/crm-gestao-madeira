-- Dropar constraints primeiro
ALTER TABLE public.task_flow_comments 
DROP CONSTRAINT IF EXISTS task_flow_comments_autor_id_fkey;

ALTER TABLE public.task_flow_history 
DROP CONSTRAINT IF EXISTS task_flow_history_autor_id_fkey;

-- Atualizar autor_id em task_flow_comments para usar profiles.id
UPDATE public.task_flow_comments c
SET autor_id = tfp.user_id
FROM public.task_flow_profiles tfp
WHERE c.autor_id = tfp.id AND tfp.user_id IS NOT NULL;

-- Atualizar autor_id em task_flow_history para usar profiles.id
UPDATE public.task_flow_history h
SET autor_id = tfp.user_id
FROM public.task_flow_profiles tfp
WHERE h.autor_id = tfp.id AND tfp.user_id IS NOT NULL;

-- Agora adicionar as novas foreign keys
ALTER TABLE public.task_flow_comments 
ADD CONSTRAINT task_flow_comments_autor_id_fkey 
FOREIGN KEY (autor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.task_flow_history 
ADD CONSTRAINT task_flow_history_autor_id_fkey 
FOREIGN KEY (autor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;