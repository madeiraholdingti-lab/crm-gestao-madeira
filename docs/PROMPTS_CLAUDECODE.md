# Prompts prontos para o Claude Code — Maikonect CRM

Cole esses prompts diretamente no terminal do Claude Code.
Cada prompt é autossuficiente — referencia os docs e diz exatamente o que fazer.

---

## FASE 1 — Performance (rodar primeiro)

### Prompt 1a — Diagnóstico inicial
```
Leia o arquivo docs/FASE_1_PERFORMANCE.md para entender o contexto.

Depois faça uma auditoria completa das edge functions suspeitas:
1. Abra supabase/functions/evolution-messages-webhook/index.ts
2. Abra supabase/functions/evolution-webhook/index.ts
3. Identifique: há filtro de eventos? há early return para mensagens irrelevantes?
4. Liste todos os componentes React que usam supabase.channel() e verifique
   se há cleanup (return () => supabase.removeChannel()) em cada useEffect
5. Mostre um relatório do que encontrou antes de fazer qualquer mudança
```

### Prompt 1b — Aplicar correções
```
Leia docs/FASE_1_PERFORMANCE.md.

Aplique as seguintes correções (use plan mode, são vários arquivos):
1. Adicione filtro de eventos no início de evolution-messages-webhook/index.ts
   ignorando: mensagens fromMe, eventos QRCODE_UPDATED, LOGOUT_INSTANCE, CONTACTS_UPSERT
2. Corrija o cleanup de Realtime em SDRZap.tsx (adicione removeChannel no return do useEffect)
3. Crie uma migration com os índices em mensagens, messages e conversas conforme o spec

Mostre o plano antes de executar.
```

### Prompt 1c — Cron jobs
```
Leia docs/FASE_1_PERFORMANCE.md, seção "Cron jobs com intervalo muito curto".

Verifique todos os arquivos em supabase/functions/ que contêm agendamento
ou são chamados por cron. Liste o intervalo atual de cada um.
Proponha os novos intervalos e crie a migration de ajuste.
```

---

## FASE 2 — Novo Home com IA

### Prompt 2a — Monitor de Secretárias
```
Leia docs/FASE_2_HOME_AGENTE.md, seção "Componente 2 — Monitor de Secretárias".

Crie o componente src/components/MonitorSecretarias.tsx conforme o spec.
Requisitos obrigatórios:
- Buscar conversas abertas agrupadas por responsavel_atual
- Calcular tempo sem resposta com date-fns
- Flag urgente se > 2h sem resposta ou palavras-chave (receita, dor, urgente)
- Realtime subscription com cleanup obrigatório no return do useEffect
- Usar shadcn/ui Card e Badge para o layout
- Skeleton loading enquanto carrega

Após criar o componente, integre no Home.tsx substituindo o layout atual
conforme a nova estrutura descrita no spec.
```

### Prompt 2b — Briefing IA
```
Leia docs/FASE_2_HOME_AGENTE.md, seção "Componente 1 — Briefing IA".

Faça em duas etapas:
ETAPA 1 — Backend:
- Crie a migration para a tabela briefings_home
- Crie supabase/functions/gerar-briefing-home/index.ts
  que busca conversas abertas, tarefas atrasadas e agenda do dia,
  envia para OpenAI e salva na tabela
- Use Deno.env.get('OPENAI_API_KEY') para a chave da API

ETAPA 2 — Frontend:
- Crie src/components/BriefingIA.tsx
- Cache de 30 minutos (verificar briefings_home pelo user_id e gerado_em)
- Botão atualizar com cooldown de 5 minutos
- Skeleton loading enquanto gera
- Exibir links de ação rápida (se a edge function retornar)

Mostre o plano completo antes de executar.
```

---

## FASE 3 — Contatos inteligentes

### Prompt 3a — Migration e UI básica
```
Leia docs/FASE_3_CONTATOS_IA.md, seção "Parte 1".

1. Crie a migration adicionando os campos perfil_profissional, especialidade,
   instituicao, perfil_sugerido_ia, perfil_confirmado em contacts
2. Crie o índice idx_contacts_perfil
3. Adicione o campo de perfil no painel de detalhes da conversa no SDRZap.tsx
   (seção onde mostra informações do contato — encontre onde é e adicione um Select)
4. Após editar o banco, lembre que precisamos rodar: supabase gen types
```

### Prompt 3b — Classificação por IA
```
Leia docs/FASE_3_CONTATOS_IA.md, seção "Parte 2".

Crie a edge function supabase/functions/classificar-contato-ia/index.ts
que recebe um contact_id, busca as últimas 20 mensagens da conversa,
envia para OpenAI e salva o resultado em contacts.perfil_sugerido_ia.

Use o enum de perfis definido no spec. Retorne confiança alta/media/baixa.
Não confirme automaticamente — apenas salvar como sugestão.

Depois crie um cron job diário para a função classificar-contatos-lote
que processa 50 contatos sem perfil por vez.
```

### Prompt 3c — Filtro nos disparos
```
Leia docs/FASE_3_CONTATOS_IA.md, seção "Parte 4".

1. Crie migration adicionando filtro_perfil_profissional e filtro_especialidade
   em campanhas_disparo
2. Adicione os campos de filtro na UI de criação de campanha
   (encontre o formulário de campanha em pages/disparos/)
3. Atualize a query em processar-envios-massa para respeitar os novos filtros
```

---

## FASE 4 — Agente de tarefas

### Prompt 4a — Follow-up simples (fazer primeiro)
```
Leia docs/FASE_4_AGENTE_TAREFAS.md, seção "Fase 4b — Follow-up por conversa".

Implemente o follow-up simples:
1. Migration: adicionar follow_up_em e follow_up_nota em conversas
2. No SDRZap.tsx, adicione opção "Definir follow-up" no menu de ações da conversa
   (onde ficam as outras ações — encontre o menu de contexto ou dropdown)
3. Abre um Popover com DateTimePicker usando shadcn/ui Calendar
4. Salva na conversa e exibe badge "Follow-up: 27/03" na conversa
5. Modifique processar-disparos-agendados para verificar follow_ups pendentes
   e enviar notificação WA para o responsável_atual da conversa
```

### Prompt 4b — Comando rápido
```
Leia docs/FASE_4_AGENTE_TAREFAS.md, seções "Interface" e "Arquitetura técnica".

Implemente o modal de comando rápido:
1. Crie supabase/functions/interpretar-comando/index.ts com o prompt do spec
   (inclua os IDs reais dos usuários — busque na tabela profiles)
2. Crie src/components/ComandoRapidoModal.tsx com os estados definidos no spec
3. Adicione listener de teclado Cmd+K no AppLayout em App.tsx
4. Após confirmação do usuário, execute a ação:
   - tipo tarefa → INSERT em task_flow_tasks
   - tipo lembrete → INSERT em notificacoes + scheduled_messages
   - tipo follow_up → UPDATE em conversas (follow_up_em)

Mostre o plano completo antes de executar. São vários arquivos.
```

---

## FASE 5 — Hub WhatsApp + Roteamento

### Prompt 5a — Roteamento automático
```
Leia docs/FASE_5_HUB_WHATSAPP.md, seção "Roteamento automático de conversas por perfil".

Implemente o roteamento:
1. Crie a migration para a tabela regras_roteamento
2. Modifique evolution-messages-webhook para aplicar roteamento após criar conversa:
   - Busca perfil do contato pelo telefone
   - Aplica regra da tabela regras_roteamento
   - Atualiza responsavel_atual na conversa
   - Envia notificação WA para a secretária responsável
3. Crie a UI de configuração em /usuarios (nova aba "Roteamento")
   listando as regras com opção de editar responsável por perfil

Busque os user_ids reais de Iza e Mariana na tabela profiles antes de implementar.
Mostre o plano antes de executar.
```

### Prompt 5b — Tags automáticas
```
Leia docs/FASE_5_HUB_WHATSAPP.md, seção "Tags automáticas nas conversas".

1. Crie supabase/functions/classificar-conversa-ia/index.ts
   que recebe conversa_id, analisa últimas 5 mensagens e aplica tags
   Usar modelo gpt-4o-mini para manter custo baixo
2. Chame essa função de dentro de evolution-messages-webhook
   a cada 10 mensagens de uma conversa (não a cada mensagem — ver spec)
3. As tags já existem no campo tags[] em conversas — apenas atualizar
```

---

## FASE 6 — Integração n8n

### Prompt 6a — Escalonamentos pós-op no SDR Zap
```
Leia docs/FASE_6_N8N_INTEGRACAO.md, seção "Ponto de integração 1".

1. Abra supabase/functions/n8n-inbound-webhook/index.ts
2. Adicione tratamento para o novo tipo de evento "escalonamento_posop"
3. Quando receber esse tipo:
   - Busca ou cria contato pelo telefone do paciente
   - Cria conversa no SDR Zap com tags pos-operatorio e urgente
   - Atribui para Iza (buscar user_id dela na tabela profiles)
   - Cria notificação in-app para Iza e Dr. Maikon
4. Também adicione campo origem e n8n_ref_id na tabela conversas (migration)

Me mostra o webhook atual primeiro antes de modificar.
```

---

## Prompts utilitários — usar a qualquer momento

### Ver o que está custando
```
Preciso entender o custo atual do Supabase. 
Leia todos os arquivos em supabase/functions/ e liste:
1. Quais funções não têm nenhum filtro/early return
2. Quais componentes React têm supabase.channel() sem cleanup
3. Quais cron jobs existem e com que frequência rodam
Formato: tabela markdown com função, problema, impacto estimado.
```

### Atualizar types após migration
```
Acabei de criar uma migration nova. 
Rode: supabase gen types typescript --local > src/integrations/supabase/types.ts
Se não conseguir rodar local, me mostra como atualizar o types.ts manualmente
baseado na migration que acabamos de criar.
```

### Code review antes de commitar
```
Antes de fazer o commit, revise as mudanças que fizemos nessa sessão:
1. Tem algum console.log de debug esquecido?
2. Algum componente React com subscription sem cleanup?
3. Alguma edge function sem CORS headers?
4. Alguma query sem tratamento de erro?
5. Algum hardcode de ID de usuário que deveria vir do banco?
```

### Testar uma feature nova
```
Acabamos de implementar [NOME DA FEATURE].
Me ajuda a criar um plano de teste manual:
1. Quais cenários precisamos testar
2. Passo a passo para cada cenário
3. O que verificar no banco após cada ação
4. Como reverter se algo der errado
```
