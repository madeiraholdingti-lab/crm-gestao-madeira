-- Deletar conversas da instância RUBI
DELETE FROM public.conversas 
WHERE instancia_id = 'fb58bdd0-fd1b-4d5d-936e-7affedf31886' 
   OR orig_instance_id = 'fb58bdd0-fd1b-4d5d-936e-7affedf31886' 
   OR current_instance_id = 'fb58bdd0-fd1b-4d5d-936e-7affedf31886';