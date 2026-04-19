-- Sprint: integração Tarefas x Conversas + atribuição de responsável real
-- 1) Adiciona task_flow_tasks.conversa_id (FK para conversas)
-- 2) Garante FK conversas.responsavel_atual -> profiles(id)
-- 3) Cria índices pra queries quentes (MonitorSecretarias + lookup de tasks por conversa)
--
-- Nota: responsavel_atual JÁ é uuid no remoto (confirmado via erro de regex
-- na tentativa anterior — operador !~ não existe pra uuid). Então não converte
-- tipo, só garante FK e índice.

BEGIN;

-- ============================================================
-- 1) task_flow_tasks.conversa_id
-- ============================================================

ALTER TABLE public.task_flow_tasks
  ADD COLUMN IF NOT EXISTS conversa_id uuid NULL
  REFERENCES public.conversas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_task_flow_tasks_conversa
  ON public.task_flow_tasks(conversa_id)
  WHERE conversa_id IS NOT NULL;

COMMENT ON COLUMN public.task_flow_tasks.conversa_id IS
  'Conversa do SDR Zap vinculada a esta task. NULL quando a task foi criada fora do contexto de uma conversa (ex: via áudio no grupo WhatsApp do Maikon).';

-- ============================================================
-- 2) conversas.responsavel_atual — garantir FK para profiles
--    (tipo já é uuid no remoto; só falta constraint + índice)
-- ============================================================

ALTER TABLE public.conversas
  DROP CONSTRAINT IF EXISTS conversas_responsavel_atual_fkey;

ALTER TABLE public.conversas
  ADD CONSTRAINT conversas_responsavel_atual_fkey
  FOREIGN KEY (responsavel_atual)
  REFERENCES public.profiles(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversas_responsavel_atual
  ON public.conversas(responsavel_atual)
  WHERE responsavel_atual IS NOT NULL;

COMMENT ON COLUMN public.conversas.responsavel_atual IS
  'User ID (profiles.id) da pessoa responsável por responder essa conversa no momento. NULL = não atribuída. Atualizado via UI do SDR Zap (ação "Atribuir para...") ou automaticamente quando alguém responde pela primeira vez.';

-- ============================================================
-- 3) Helper function: auto-atribuir responsavel quando alguém
--    da equipe responder pela primeira vez. Criada mas NÃO
--    atachada a nenhum trigger — habilitar manualmente quando
--    validar UX.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_auto_atribuir_responsavel_na_conversa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF NEW.from_me = true THEN
    SELECT p.id INTO v_user_id
    FROM public.profiles p
    JOIN public.instancias_whatsapp i ON i.id = p.instancia_padrao_id
    WHERE i.id = NEW.instancia_whatsapp_id
    LIMIT 1;

    IF v_user_id IS NOT NULL THEN
      UPDATE public.conversas
         SET responsavel_atual = v_user_id
       WHERE id = NEW.conversa_id
         AND responsavel_atual IS NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_auto_atribuir_responsavel_na_conversa() IS
  'Trigger helper pra auto-atribuir responsavel_atual quando alguém responde uma conversa sem dono. NÃO está atachada a nenhuma tabela por padrão — habilitar manualmente quando validar UX.';

COMMIT;
