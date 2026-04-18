-- Add especialidade column to leads table
ALTER TABLE public.leads 
ADD COLUMN especialidade text NULL;