-- =====================================================
-- MIGRAÇÃO: Sistema de Números WhatsApp Flexível
-- Permite que números migrem entre instâncias mantendo histórico
-- =====================================================

-- 1. Criar tabela de números WhatsApp
CREATE TABLE IF NOT EXISTS public.numeros_whatsapp (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  numero TEXT NOT NULL UNIQUE, -- Número normalizado sem JID (ex: 5547999758708)
  jid TEXT, -- JID completo (ex: 5547999758708@s.whatsapp.net)
  instancia_atual_id UUID REFERENCES public.instancias_whatsapp(id) ON DELETE SET NULL,
  nome_display TEXT, -- Nome de exibição opcional
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 2. Criar índices para performance
CREATE INDEX idx_numeros_whatsapp_numero ON public.numeros_whatsapp(numero);
CREATE INDEX idx_numeros_whatsapp_instancia_atual ON public.numeros_whatsapp(instancia_atual_id);
CREATE INDEX idx_numeros_whatsapp_ativo ON public.numeros_whatsapp(ativo);

-- 3. Criar tabela de histórico de vinculações (opcional mas útil)
CREATE TABLE IF NOT EXISTS public.historico_numero_instancia (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  numero_whatsapp_id UUID NOT NULL REFERENCES public.numeros_whatsapp(id) ON DELETE CASCADE,
  instancia_id UUID NOT NULL REFERENCES public.instancias_whatsapp(id) ON DELETE CASCADE,
  vinculado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  desvinculado_em TIMESTAMP WITH TIME ZONE,
  motivo TEXT, -- 'nova_conexao', 'deletada', 'transferencia', etc.
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_historico_numero_instancia_numero ON public.historico_numero_instancia(numero_whatsapp_id);
CREATE INDEX idx_historico_numero_instancia_instancia ON public.historico_numero_instancia(instancia_id);

-- 4. Adicionar coluna numero_whatsapp_id à tabela conversas
ALTER TABLE public.conversas 
ADD COLUMN IF NOT EXISTS numero_whatsapp_id UUID REFERENCES public.numeros_whatsapp(id) ON DELETE SET NULL;

CREATE INDEX idx_conversas_numero_whatsapp ON public.conversas(numero_whatsapp_id);

-- 5. Trigger para atualizar updated_at em numeros_whatsapp
CREATE TRIGGER update_numeros_whatsapp_updated_at
BEFORE UPDATE ON public.numeros_whatsapp
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- 6. Função para migrar número entre instâncias
CREATE OR REPLACE FUNCTION public.migrar_numero_para_instancia(
  p_numero TEXT,
  p_nova_instancia_id UUID,
  p_motivo TEXT DEFAULT 'transferencia'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_numero_id UUID;
  v_instancia_antiga_id UUID;
BEGIN
  -- Buscar ou criar o número
  SELECT id, instancia_atual_id INTO v_numero_id, v_instancia_antiga_id
  FROM numeros_whatsapp
  WHERE numero = p_numero;
  
  IF v_numero_id IS NULL THEN
    -- Criar novo registro de número
    INSERT INTO numeros_whatsapp (numero, instancia_atual_id)
    VALUES (p_numero, p_nova_instancia_id)
    RETURNING id INTO v_numero_id;
  ELSE
    -- Atualizar instância atual
    UPDATE numeros_whatsapp
    SET instancia_atual_id = p_nova_instancia_id,
        updated_at = now()
    WHERE id = v_numero_id;
    
    -- Finalizar vinculação anterior no histórico
    IF v_instancia_antiga_id IS NOT NULL THEN
      UPDATE historico_numero_instancia
      SET desvinculado_em = now(),
          motivo = p_motivo
      WHERE numero_whatsapp_id = v_numero_id
        AND instancia_id = v_instancia_antiga_id
        AND desvinculado_em IS NULL;
    END IF;
  END IF;
  
  -- Registrar nova vinculação no histórico
  INSERT INTO historico_numero_instancia (numero_whatsapp_id, instancia_id, motivo)
  VALUES (v_numero_id, p_nova_instancia_id, p_motivo);
  
  -- Atualizar conversas existentes para apontar para o número
  UPDATE conversas
  SET numero_whatsapp_id = v_numero_id,
      current_instance_id = p_nova_instancia_id,
      updated_at = now()
  WHERE numero_contato = p_numero
    AND numero_whatsapp_id IS NULL;
  
  RETURN v_numero_id;
END;
$$;

-- 7. Função para obter instância ativa de um número
CREATE OR REPLACE FUNCTION public.get_instancia_ativa_numero(p_numero TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_instancia_id UUID;
BEGIN
  SELECT instancia_atual_id INTO v_instancia_id
  FROM numeros_whatsapp
  WHERE numero = p_numero
    AND ativo = true;
  
  RETURN v_instancia_id;
END;
$$;

-- 8. RLS Policies para numeros_whatsapp
ALTER TABLE public.numeros_whatsapp ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuários autenticados podem ver números"
ON public.numeros_whatsapp
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Apenas admins podem inserir números"
ON public.numeros_whatsapp
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin_geral'::app_role));

CREATE POLICY "Apenas admins podem atualizar números"
ON public.numeros_whatsapp
FOR UPDATE
USING (has_role(auth.uid(), 'admin_geral'::app_role));

-- 9. RLS Policies para historico_numero_instancia
ALTER TABLE public.historico_numero_instancia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuários autenticados podem ver histórico"
ON public.historico_numero_instancia
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Apenas admins podem inserir no histórico"
ON public.historico_numero_instancia
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin_geral'::app_role));

-- 10. Comentários para documentação
COMMENT ON TABLE public.numeros_whatsapp IS 'Gerencia números WhatsApp independentemente de instâncias, permitindo migração entre instâncias';
COMMENT ON TABLE public.historico_numero_instancia IS 'Histórico de vinculações entre números e instâncias ao longo do tempo';
COMMENT ON FUNCTION public.migrar_numero_para_instancia IS 'Migra um número entre instâncias, atualizando conversas e mantendo histórico';
COMMENT ON FUNCTION public.get_instancia_ativa_numero IS 'Retorna a instância ativa atual para um determinado número';