-- Insert default configuration row if table is empty
INSERT INTO public.config_global (evolution_base_url)
SELECT ''
WHERE NOT EXISTS (SELECT 1 FROM public.config_global LIMIT 1);