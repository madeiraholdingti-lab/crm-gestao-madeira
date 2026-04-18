-- Deletar mensagens da instância RUBI (fb58bdd0-fd1b-4d5d-936e-7affedf31886)
DELETE FROM public.mensagens 
WHERE conversa_id IN (
  SELECT id FROM public.conversas 
  WHERE instancia_id = 'fb58bdd0-fd1b-4d5d-936e-7affedf31886' 
     OR current_instance_id = 'fb58bdd0-fd1b-4d5d-936e-7affedf31886'
);