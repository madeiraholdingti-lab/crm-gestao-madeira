-- Criar enum para funções dos usuários
CREATE TYPE public.app_role AS ENUM ('admin_geral', 'medico', 'secretaria_medica', 'administrativo');

-- Criar tabela de perfis de usuários (vinculada ao auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  telefone_contato TEXT,
  cor_perfil TEXT NOT NULL DEFAULT '#3B82F6',
  funcao app_role NOT NULL DEFAULT 'secretaria_medica',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Criar tabela de instâncias WhatsApp (Z-API)
CREATE TABLE public.instancias_whatsapp (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_instancia TEXT NOT NULL,
  token_zapi TEXT NOT NULL,
  instancia_id TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_por UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Criar tabela de conversas
CREATE TABLE public.conversas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_contato TEXT NOT NULL,
  nome_contato TEXT,
  instancia_id UUID REFERENCES public.instancias_whatsapp(id) ON DELETE CASCADE,
  responsavel_atual UUID REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'em_atendimento', 'aguardando', 'finalizado')),
  ultima_mensagem TEXT,
  ultima_interacao TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Criar tabela de mensagens
CREATE TABLE public.mensagens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id UUID NOT NULL REFERENCES public.conversas(id) ON DELETE CASCADE,
  remetente TEXT NOT NULL CHECK (remetente IN ('cliente', 'equipe')),
  conteudo TEXT NOT NULL,
  tipo_mensagem TEXT NOT NULL DEFAULT 'texto' CHECK (tipo_mensagem IN ('texto', 'imagem', 'audio', 'video', 'documento')),
  enviado_por UUID REFERENCES auth.users(id),
  lida BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Habilitar RLS em todas as tabelas
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instancias_whatsapp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensagens ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para profiles
CREATE POLICY "Usuários podem ver seu próprio perfil"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Usuários podem atualizar seu próprio perfil"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Políticas RLS para instancias_whatsapp (apenas médicos e admins)
CREATE POLICY "Todos usuários autenticados podem ver instâncias"
  ON public.instancias_whatsapp FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Apenas admins e médicos podem gerenciar instâncias"
  ON public.instancias_whatsapp FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.funcao IN ('admin_geral', 'medico')
    )
  );

-- Políticas RLS para conversas
CREATE POLICY "Usuários podem ver todas as conversas"
  ON public.conversas FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Usuários podem atualizar conversas"
  ON public.conversas FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Usuários podem criar conversas"
  ON public.conversas FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Políticas RLS para mensagens
CREATE POLICY "Usuários podem ver mensagens de todas as conversas"
  ON public.mensagens FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Usuários podem criar mensagens"
  ON public.mensagens FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Usuários podem atualizar mensagens"
  ON public.mensagens FOR UPDATE
  TO authenticated
  USING (true);

-- Função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers para updated_at
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_instancias_updated_at
  BEFORE UPDATE ON public.instancias_whatsapp
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_conversas_updated_at
  BEFORE UPDATE ON public.conversas
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Trigger para criar perfil automaticamente ao criar usuário
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, nome, funcao)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', NEW.email),
    COALESCE((NEW.raw_user_meta_data->>'funcao')::app_role, 'secretaria_medica')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Criar índices para performance
CREATE INDEX idx_conversas_responsavel ON public.conversas(responsavel_atual);
CREATE INDEX idx_conversas_status ON public.conversas(status);
CREATE INDEX idx_mensagens_conversa ON public.mensagens(conversa_id);
CREATE INDEX idx_mensagens_created ON public.mensagens(created_at DESC);