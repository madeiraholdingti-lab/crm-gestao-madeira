-- Tabela de perfis/secretárias do Task-Flow
CREATE TABLE public.task_flow_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  avatar_url TEXT,
  cor TEXT NOT NULL DEFAULT '#3B82F6',
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de colunas do Kanban
CREATE TABLE public.task_flow_columns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'individual', -- 'shared' ou 'individual'
  ordem INTEGER NOT NULL DEFAULT 0,
  icone TEXT,
  cor TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de tarefas/cards
CREATE TABLE public.task_flow_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  titulo TEXT NOT NULL,
  descricao TEXT,
  resumo TEXT,
  column_id UUID NOT NULL REFERENCES public.task_flow_columns(id) ON DELETE CASCADE,
  responsavel_id UUID REFERENCES public.task_flow_profiles(id) ON DELETE SET NULL,
  criado_por_id UUID REFERENCES public.task_flow_profiles(id) ON DELETE SET NULL,
  data_retorno TIMESTAMP WITH TIME ZONE,
  prazo TIMESTAMP WITH TIME ZONE,
  ordem INTEGER NOT NULL DEFAULT 0,
  origem TEXT DEFAULT 'manual', -- 'manual', 'api', 'ia'
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de tags/etiquetas
CREATE TABLE public.task_flow_tags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  cor TEXT NOT NULL DEFAULT '#6366F1',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de relação tarefa-tag
CREATE TABLE public.task_flow_task_tags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.task_flow_tasks(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.task_flow_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(task_id, tag_id)
);

-- Tabela de anexos
CREATE TABLE public.task_flow_attachments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.task_flow_tasks(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  file_size BIGINT,
  uploaded_by UUID REFERENCES public.task_flow_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de checklists
CREATE TABLE public.task_flow_checklists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.task_flow_tasks(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  concluido BOOLEAN NOT NULL DEFAULT false,
  ordem INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de comentários/chat
CREATE TABLE public.task_flow_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.task_flow_tasks(id) ON DELETE CASCADE,
  autor_id UUID REFERENCES public.task_flow_profiles(id) ON DELETE SET NULL,
  texto TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'nota', -- 'nota', 'sistema', 'anexo'
  attachment_id UUID REFERENCES public.task_flow_attachments(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de histórico
CREATE TABLE public.task_flow_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.task_flow_tasks(id) ON DELETE CASCADE,
  autor_id UUID REFERENCES public.task_flow_profiles(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL, -- 'move', 'prazo', 'responsavel', 'anexo', 'create'
  descricao TEXT NOT NULL,
  valor_anterior TEXT,
  valor_novo TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.task_flow_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_flow_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_flow_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_flow_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_flow_task_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_flow_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_flow_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_flow_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_flow_history ENABLE ROW LEVEL SECURITY;

-- Políticas - usuários autenticados podem ver e manipular
CREATE POLICY "Usuários autenticados podem ver profiles" ON public.task_flow_profiles FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins podem gerenciar profiles" ON public.task_flow_profiles FOR ALL USING (has_role(auth.uid(), 'admin_geral'::app_role));

CREATE POLICY "Usuários autenticados podem ver colunas" ON public.task_flow_columns FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins podem gerenciar colunas" ON public.task_flow_columns FOR ALL USING (has_role(auth.uid(), 'admin_geral'::app_role));

CREATE POLICY "Usuários autenticados podem ver tarefas" ON public.task_flow_tasks FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Usuários autenticados podem criar tarefas" ON public.task_flow_tasks FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Usuários autenticados podem atualizar tarefas" ON public.task_flow_tasks FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins podem deletar tarefas" ON public.task_flow_tasks FOR DELETE USING (has_role(auth.uid(), 'admin_geral'::app_role));

CREATE POLICY "Usuários autenticados podem ver tags" ON public.task_flow_tags FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Usuários autenticados podem gerenciar tags" ON public.task_flow_tags FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem ver task_tags" ON public.task_flow_task_tags FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Usuários autenticados podem gerenciar task_tags" ON public.task_flow_task_tags FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem ver anexos" ON public.task_flow_attachments FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Usuários autenticados podem gerenciar anexos" ON public.task_flow_attachments FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem ver checklists" ON public.task_flow_checklists FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Usuários autenticados podem gerenciar checklists" ON public.task_flow_checklists FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem ver comments" ON public.task_flow_comments FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Usuários autenticados podem gerenciar comments" ON public.task_flow_comments FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuários autenticados podem ver histórico" ON public.task_flow_history FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Usuários autenticados podem criar histórico" ON public.task_flow_history FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Triggers para updated_at
CREATE TRIGGER update_task_flow_profiles_updated_at BEFORE UPDATE ON public.task_flow_profiles FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_task_flow_tasks_updated_at BEFORE UPDATE ON public.task_flow_tasks FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Inserir colunas padrão
INSERT INTO public.task_flow_columns (nome, tipo, ordem, icone) VALUES
  ('Caixa de Entrada', 'shared', 0, 'bot'),
  ('Analisando', 'individual', 1, 'search'),
  ('Em Resolução', 'individual', 2, 'wrench'),
  ('Esperando Retorno', 'individual', 3, 'clock'),
  ('Help / Ajuda', 'shared', 4, 'hand-helping'),
  ('Aprovação Dr. Maikon', 'shared', 5, 'user-check'),
  ('Finalizada', 'shared', 6, 'check-circle');

-- Inserir perfis iniciais
INSERT INTO public.task_flow_profiles (nome, cor) VALUES
  ('Isadora', '#7C3AED'),
  ('Helen', '#059669');

-- Habilitar realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_flow_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_flow_comments;