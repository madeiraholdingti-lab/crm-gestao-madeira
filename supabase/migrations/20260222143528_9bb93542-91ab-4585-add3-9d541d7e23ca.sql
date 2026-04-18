
-- Função de updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Tabela de scripts de IA
CREATE TABLE IF NOT EXISTS public.ia_scripts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao_vaga TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Perguntas do checklist
CREATE TABLE IF NOT EXISTS public.ia_script_perguntas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  script_id UUID NOT NULL REFERENCES public.ia_scripts(id) ON DELETE CASCADE,
  pergunta TEXT NOT NULL,
  ordem INT NOT NULL DEFAULT 0,
  obrigatoria BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.ia_scripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ia_script_perguntas ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ia_scripts' AND policyname='Authenticated users can view scripts') THEN
    CREATE POLICY "Authenticated users can view scripts" ON public.ia_scripts FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ia_scripts' AND policyname='Authenticated users can insert scripts') THEN
    CREATE POLICY "Authenticated users can insert scripts" ON public.ia_scripts FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ia_scripts' AND policyname='Authenticated users can update scripts') THEN
    CREATE POLICY "Authenticated users can update scripts" ON public.ia_scripts FOR UPDATE USING (auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ia_scripts' AND policyname='Authenticated users can delete scripts') THEN
    CREATE POLICY "Authenticated users can delete scripts" ON public.ia_scripts FOR DELETE USING (auth.uid() IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ia_script_perguntas' AND policyname='Authenticated users can view perguntas') THEN
    CREATE POLICY "Authenticated users can view perguntas" ON public.ia_script_perguntas FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ia_script_perguntas' AND policyname='Authenticated users can insert perguntas') THEN
    CREATE POLICY "Authenticated users can insert perguntas" ON public.ia_script_perguntas FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ia_script_perguntas' AND policyname='Authenticated users can update perguntas') THEN
    CREATE POLICY "Authenticated users can update perguntas" ON public.ia_script_perguntas FOR UPDATE USING (auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ia_script_perguntas' AND policyname='Authenticated users can delete perguntas') THEN
    CREATE POLICY "Authenticated users can delete perguntas" ON public.ia_script_perguntas FOR DELETE USING (auth.uid() IS NOT NULL);
  END IF;
END $$;

-- Trigger updated_at
CREATE TRIGGER update_ia_scripts_updated_at
  BEFORE UPDATE ON public.ia_scripts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
