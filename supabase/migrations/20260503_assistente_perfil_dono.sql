-- Perfil estrutural do "dono" do agente (Maikon).
-- Diferente de assistente_memoria (fragmentos voláteis): aqui ficam dados
-- canônicos, estáveis, sempre injetados como bloco cacheado no system prompt.
--
-- 1 row por user_id. Cada slot é JSONB e pode ser NULL pra "não preenchido"
-- (Madeira detecta e pergunta proativamente).

BEGIN;

CREATE TABLE IF NOT EXISTS public.assistente_perfil_dono (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  identidade JSONB,
  empresas JSONB,
  equipe JSONB,
  hospitais_operacao JSONB,
  convenios JSONB,
  parceiros_chave JSONB,
  rotina JSONB,
  regras_pessoais JSONB,
  datas_familia JSONB,
  notas_extra JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.assistente_perfil_dono ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_proprio_perfil_dono" ON public.assistente_perfil_dono;
CREATE POLICY "user_proprio_perfil_dono"
  ON public.assistente_perfil_dono
  FOR SELECT
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin_geral'::app_role));

DROP TRIGGER IF EXISTS update_perfil_dono_updated_at ON public.assistente_perfil_dono;
CREATE TRIGGER update_perfil_dono_updated_at
  BEFORE UPDATE ON public.assistente_perfil_dono
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Carrega perfil + lista campos vazios pra Madeira saber o que falta.
CREATE OR REPLACE FUNCTION public.carregar_perfil_dono(p_user_id UUID)
RETURNS TABLE (
  identidade JSONB,
  empresas JSONB,
  equipe JSONB,
  hospitais_operacao JSONB,
  convenios JSONB,
  parceiros_chave JSONB,
  rotina JSONB,
  regras_pessoais JSONB,
  datas_familia JSONB,
  notas_extra JSONB,
  campos_vazios TEXT[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.identidade, p.empresas, p.equipe,
    p.hospitais_operacao, p.convenios, p.parceiros_chave,
    p.rotina, p.regras_pessoais, p.datas_familia, p.notas_extra,
    ARRAY(SELECT col FROM (VALUES
      ('identidade', p.identidade IS NULL),
      ('empresas', p.empresas IS NULL),
      ('equipe', p.equipe IS NULL),
      ('hospitais_operacao', p.hospitais_operacao IS NULL),
      ('convenios', p.convenios IS NULL),
      ('parceiros_chave', p.parceiros_chave IS NULL),
      ('rotina', p.rotina IS NULL),
      ('regras_pessoais', p.regras_pessoais IS NULL),
      ('datas_familia', p.datas_familia IS NULL)
    ) AS t(col, vazio) WHERE vazio) AS campos_vazios
  FROM assistente_perfil_dono p
  WHERE p.user_id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.carregar_perfil_dono(UUID) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carregar_perfil_dono(UUID) TO service_role, authenticated;

-- Atualiza UM campo do perfil. UPSERT: cria row se não existir.
-- Whitelist hardcoded de campos pra evitar SQL injection via tool.
CREATE OR REPLACE FUNCTION public.atualizar_perfil_dono(
  p_user_id UUID,
  p_campo TEXT,
  p_valor JSONB
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_campo NOT IN (
    'identidade','empresas','equipe','hospitais_operacao',
    'convenios','parceiros_chave','rotina','regras_pessoais',
    'datas_familia','notas_extra'
  ) THEN
    RAISE EXCEPTION 'campo inválido: %', p_campo;
  END IF;

  EXECUTE format(
    'INSERT INTO assistente_perfil_dono (user_id, %1$I)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET %1$I = $2, updated_at = now()',
    p_campo
  ) USING p_user_id, p_valor;
END;
$$;

REVOKE ALL ON FUNCTION public.atualizar_perfil_dono(UUID, TEXT, JSONB) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atualizar_perfil_dono(UUID, TEXT, JSONB) TO service_role;

COMMIT;
