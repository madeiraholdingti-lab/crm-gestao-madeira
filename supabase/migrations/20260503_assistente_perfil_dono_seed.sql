-- Seed inicial do perfil do Dr. Maikon Madeira.
-- O que sei: identidade básica, empresas, equipe e parceiros confirmados.
-- O que NÃO sei (NULL): hospitais onde opera, convênios, rotina detalhada,
--   datas familiares — Madeira pergunta proativamente.
--
-- ON CONFLICT DO NOTHING pra ser idempotente — atualizações futuras devem
-- vir via tool atualizar_perfil_dono, não por re-seed.

INSERT INTO public.assistente_perfil_dono (
  user_id,
  identidade,
  empresas,
  equipe,
  parceiros_chave,
  regras_pessoais
) VALUES (
  '823df2f1-21e1-4d81-ad00-4f00d921e4bc',
  '{
    "nome_completo": "Dr. Maikon Madeira",
    "tratamento_preferido": "Maikon (sem Dr no whats)",
    "formacao": "Cirurgião cardiovascular",
    "cidade_base": "Itajaí/SC",
    "papel": "médico-empresário (cirurgia + gestão de clínicas/serviços de saúde)",
    "sobrenome_origem_madeira": "É o sobrenome dele — você é a Madeira (extensão digital)"
  }'::jsonb,
  '[
    {
      "nome": "GSS - Gestão de Serviços de Saúde",
      "papel_do_maikon": "sócio",
      "outros_socios": ["Heron", "João"],
      "diretoria": "Ramone (mulher, diretora — NÃO confundir com sócio)",
      "descricao": "Empresa de gestão de serviços médicos/hospitalares. Atua em prospecção de médicos para corpo clínico de hospitais.",
      "status": "ativa, em crescimento"
    },
    {
      "nome": "Maikonect (CRM)",
      "papel_do_maikon": "dono",
      "descricao": "CRM próprio dele para gestão da clínica e disparos. Construído pelo Raul (Pulse ID). Centraliza WhatsApp, tarefas, agenda, campanhas.",
      "status": "em desenvolvimento ativo"
    }
  ]'::jsonb,
  '[
    {
      "nome": "Isadora",
      "apelido": "Iza",
      "papel": "secretária médica",
      "contexto": "Trabalha com Maikon há mais tempo. Gerencia agenda, tarefas, atendimento WhatsApp da clínica. NUNCA escrever Helen — é lixo do banco antigo.",
      "padrao_de_carga": "frequentemente sobrecarregada — verifique antes de adicionar tarefa nova"
    },
    {
      "nome": "Mariana",
      "papel": "secretária médica",
      "contexto": "Recém contratada (~2026), aprendendo rotina. Carga ainda menor que Iza."
    }
  ]'::jsonb,
  '[
    {
      "nome": "Ramone",
      "vinculo": "diretora da GSS",
      "contexto": "Ponto de contato comercial/operacional da GSS. Decisões de campanha/operação passam por ela. Mulher (não confundir com sócio)."
    },
    {
      "nome": "Raul Seixas",
      "vinculo": "consultor técnico (Pulse ID)",
      "contexto": "Construiu e mantém o Maikonect e o agente Madeira. Pode ser acionado em problemas técnicos."
    }
  ]'::jsonb,
  '[
    "Respostas CURTAS no WhatsApp — máximo 3 linhas (ele já corrigiu antes)",
    "Tom direto, sem formalidade exagerada — fala como assistente próximo",
    "Confirmação obrigatória antes de ação destrutiva (criar tarefa, criar campanha, mandar email/mass)",
    "Não revelar valor de procedimento por conta própria — sempre redirecionar pra responsável (ex: GSS → Bruna/Ramone)"
  ]'::jsonb
)
ON CONFLICT (user_id) DO NOTHING;
