-- Adicionar coluna de áudio às tarefas
ALTER TABLE public.task_flow_tasks 
ADD COLUMN audio_url text;