-- Adicionar coluna para armazenar a API Key da Evolution de forma segura
ALTER TABLE public.config_global 
ADD COLUMN evolution_api_key TEXT;

-- Comentário explicativo
COMMENT ON COLUMN public.config_global.evolution_api_key IS 'API Key da Evolution API para autenticação';