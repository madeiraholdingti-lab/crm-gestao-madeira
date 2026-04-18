-- Alterar task_flow_tasks.criado_por_id para referenciar profiles (usuários do sistema)
ALTER TABLE public.task_flow_tasks 
DROP CONSTRAINT IF EXISTS task_flow_tasks_criado_por_id_fkey;

ALTER TABLE public.task_flow_tasks 
ADD CONSTRAINT task_flow_tasks_criado_por_id_fkey 
FOREIGN KEY (criado_por_id) REFERENCES public.profiles(id) ON DELETE SET NULL;