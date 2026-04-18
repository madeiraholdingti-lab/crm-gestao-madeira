
-- Trigger function para criar notificação quando tarefa é criada
CREATE OR REPLACE FUNCTION public.notify_task_created()
RETURNS TRIGGER AS $$
DECLARE
  col_nome TEXT;
  resp_nome TEXT;
  notif_titulo TEXT;
  notif_mensagem TEXT;
  target_user_id UUID;
BEGIN
  -- Buscar nome da coluna
  SELECT nome INTO col_nome FROM public.task_flow_columns WHERE id = NEW.column_id;

  -- Buscar nome do responsável e user_id
  SELECT tfp.nome, tfp.user_id INTO resp_nome, target_user_id
  FROM public.task_flow_profiles tfp
  WHERE tfp.id = NEW.responsavel_id;

  notif_titulo := '📋 Nova tarefa criada';
  notif_mensagem := 'Tarefa "' || LEFT(NEW.titulo, 60) || '" adicionada em ' || COALESCE(col_nome, 'coluna') || COALESCE(' para ' || resp_nome, '');

  -- Inserir notificação para todos os usuários ativos (broadcast)
  INSERT INTO public.notificacoes (titulo, mensagem, tipo, user_id, dados)
  SELECT 
    notif_titulo,
    notif_mensagem,
    'task_created',
    p.id,
    jsonb_build_object('task_id', NEW.id, 'column_id', NEW.column_id, 'responsavel_id', NEW.responsavel_id)
  FROM public.profiles p
  WHERE p.ativo = true;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Criar trigger
DROP TRIGGER IF EXISTS trigger_notify_task_created ON public.task_flow_tasks;
CREATE TRIGGER trigger_notify_task_created
  AFTER INSERT ON public.task_flow_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_task_created();
