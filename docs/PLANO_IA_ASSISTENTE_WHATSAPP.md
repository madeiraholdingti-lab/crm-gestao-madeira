# Plano — Assistente IA Maikonect via WhatsApp

**Objetivo:** dar ao Dr. Maikon e às secretárias um assistente de IA que vive dentro do próprio WhatsApp — conectado ao CRM, às tarefas e aos dados de atendimento — pra pedir relatórios, criar tarefas, checar pendências e avisar a equipe, sem precisar abrir o CRM.

**Status:** arquitetura desenhada, aguardando aprovação pra entrar em desenvolvimento. As pré-condições (schema de atribuição de conversas e de vinculação task↔conversa) já estão na sprint atual.

**Autor:** Raul Seixas (consultoria técnica)
**Data:** abril/2026

---

## 1. Por que isso faz sentido

Hoje o Dr. Maikon depende de abrir o CRM no navegador para entender o estado do dia. Entre cirurgias, isso não acontece — ele acumula o trabalho pra finais de semana. As secretárias recebem tarefas pelo WhatsApp num grupo específico via áudio, mas esse fluxo é unidirecional (ele manda → task é criada) e sem memória.

Um assistente IA no próprio WhatsApp resolve três problemas ao mesmo tempo:

1. **Maikon pergunta, ele responde** — "quantas conversas não respondi hoje dos cirurgiões cardíacos?", "qual o status da Iza hoje?", "me mostra os follow-ups de amanhã". Resposta em segundos.
2. **Maikon delega, ele executa** — "cria uma task pra Iza ligar pro Dr. João amanhã às 10h". IA cria a task no CRM, atribui à Iza, avisa ela por WhatsApp.
3. **IA proativa** — todo dia às 18h manda resumo do atendimento. Se uma conversa fica >4h sem resposta, avisa quem deveria responder. Se Iza está sobrecarregada, sugere redistribuição.

O diferencial: não é um "chatbot que recebe mensagens de paciente" (isso seria outra coisa). É um **copiloto administrativo pessoal** do Maikon, usando um número WhatsApp dedicado que **só ele e as secretárias têm acesso**.

---

## 2. Como funciona na prática — 8 cenários reais

### Cenário 1 — Relatório instantâneo
> **Maikon (8h entre cirurgias, via WA):** "Como tá o atendimento hoje?"
>
> **IA:** "Bom dia, Doutor. Às 7:47h: 23 conversas em atendimento. **3 pendentes há mais de 2h** (2 com a Iza, 1 sem responsável). Resumo comparado com ontem no mesmo horário: hoje tem 40% mais pendentes. Quer que eu detalhe as 3 urgentes?"

### Cenário 2 — Criar task por conversa
> **Maikon:** "Cria uma task pra Mariana ligar pra paciente Ingrid Souza amanhã às 14h. Objetivo: confirmar cirurgia."
>
> **IA:** "Criei: _'Ligar para Ingrid Souza — confirmar cirurgia'_ com prazo amanhã 14h, atribuída à Mariana. Vinculei à conversa WhatsApp dela (última troca foi segunda). **Avisei a Mariana por WhatsApp** — ela recebeu o alerta. Quer que eu mande a Ingrid uma prévia dizendo que a Mariana liga amanhã?"

### Cenário 3 — Delegação em massa
> **Maikon:** "Distribui entre Iza e Mariana todas as conversas sem responsável que estão há mais de 2h sem resposta."
>
> **IA:** "Vou atribuir 5 conversas: 3 para Iza (fila mais leve) e 2 para Mariana. **Quer que eu confirme antes de executar?** Se sim responde 'confirma'; se não quer distribuir diferente, me diz como."

### Cenário 4 — Status de uma pessoa
> **Maikon:** "Como a Iza tá hoje?"
>
> **IA:** "Iza está com 12 conversas abertas, respondeu 8 hoje (média do mês: 14/dia). **Tem 1 conversa crítica** há 3h sem resposta — paciente Pedro Alves. Tasks abertas: 4, sendo 1 vencida hoje (confirmar exame Maria Silva). Tudo bem, mas a task vencida precisa de atenção. Quer que eu mande um lembrete pra ela?"

### Cenário 5 — Busca inteligente de contato
> **Maikon:** "Quem era aquele cirurgião cardíaco que conversei semana passada sobre o evento de novembro?"
>
> **IA:** "Provavelmente o **Dr. Rafael Tavares** — conversaram 12/04 sobre 'congresso de cardiologia novembro'. Categoria: cirurgião cardíaco. Última mensagem dele foi 'sim, tenho interesse, me manda mais detalhes'. Ele está **aguardando sua resposta há 6 dias**. Quer que eu crie uma task pra Iza retornar o contato, ou você prefere responder direto?"

### Cenário 6 — Resumo proativo (automático às 18h)
> **IA (todo dia 18h, sem ser perguntado):** "Resumo do dia, Doutor.
> - 47 conversas movimentadas (+12% vs ontem)
> - 42 respondidas, 5 pendentes (todas com follow-up agendado)
> - Iza: 18 respostas, 0 pendentes. Mariana: 19 respostas, 2 pendentes.
> - 3 tasks novas criadas, 5 concluídas.
> - **Alerta:** paciente Ana Luiza mandou 4 mensagens hoje sem resposta. Não está atribuída. Quer que eu direcione pra alguém?"

### Cenário 7 — Escalation automática
> **IA (proativo, sem pergunta):** "Doutor, atenção: conversa com **Dr. Paulo Mendes** (diretor hospital) está há **4h sem resposta**. Última mensagem dele: 'preciso confirmar para fechar ainda hoje'. Considerando a importância do contato, achei que valeria te avisar. Quer que eu crie uma task urgente ou responda direto?"

### Cenário 8 — Follow-up + lembrança contextual
> **Maikon:** "Me lembra de responder o paciente do caso complexo em 2 dias."
>
> **IA:** "Qual paciente você tá falando? Pelas últimas conversas suas, pode ser: (a) Caso Roberto Silva (cirurgia válvula, complexo), (b) Caso Fernanda Alves (revisão pós-op complicada). Qual?"
>
> **Maikon:** "Roberto"
>
> **IA:** "Feito. Follow-up marcado para 21/04 às 9h. Vou te lembrar por WhatsApp 30min antes, com o resumo das últimas mensagens pra você abrir a conversa já com contexto."

---

## 3. Arquitetura técnica

```
┌──────────────────────┐
│   Maikon ou Iza no   │
│ WhatsApp (nº dedicado)│
└──────────┬───────────┘
           │ mensagem
           ▼
┌──────────────────────┐
│   Evolution API      │──── recebe msg
│  (instância AI-Agent)│
└──────────┬───────────┘
           │ webhook
           ▼
┌──────────────────────────────────┐
│  Edge Function:                  │
│  claude-wa-agent                 │
│  - identifica remetente (Maikon? │
│    Iza? Mariana?)                │
│  - monta contexto de sessão      │
│  - chama Anthropic Claude API    │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────┐      ┌────────────────────┐
│  Anthropic Claude API│◄────►│  Tools (edge fns)  │
│  (Sonnet 4.6 com     │      │  - query_conversas │
│   prompt cache +     │      │  - criar_task      │
│   tool use)          │      │  - atribuir_conv.  │
│                      │      │  - enviar_wa_msg   │
└──────────┬───────────┘      │  - gerar_relatorio │
           │ resposta          │  - buscar_contato  │
           ▼                   └────────────────────┘
┌──────────────────────┐
│  Evolution API       │──── envia resposta
└──────────┬───────────┘     de volta pro WA
           │
           ▼
┌──────────────────────┐
│  Maikon/Iza recebe   │
│  mensagem da IA      │
└──────────────────────┘
```

### 3.1 Componentes

**Instância WhatsApp dedicada para a IA**
- Um chip novo exclusivo do assistente (recomendo chamar `maikonect-ai` ou `assistente-dr-maikon`)
- Só Maikon, Iza e Mariana têm esse número
- Evolution API cuida da conexão; número fica registrado em `instancias_whatsapp` com flag `tipo='ai_agent'`

**Edge Function `claude-wa-agent` (principal)**
- Recebe webhook do Evolution
- Identifica remetente por `phone` → cruza com `profiles.telefone_contato`
- Se remetente não for Maikon/Iza/Mariana/Raul → **ignora** (segurança)
- Mantém histórico de conversa em tabela `ai_agent_sessions` (limitada por usuário, últimas N mensagens)
- Monta payload pro Claude com: system prompt + histórico + mensagem nova + tool catalog
- Stream da resposta de volta pra Evolution → usuário vê "digitando..."
- Se Claude usa tools, executa-as antes de responder

**Tools expostas ao Claude (Anthropic Tool Use):**

| Tool | Descrição | Read/Write |
|---|---|---|
| `listar_conversas_pendentes` | Conversas sem resposta há mais de X horas, agrupado por responsável | R |
| `buscar_contato` | Busca fuzzy por nome/telefone/perfil profissional | R |
| `historico_conversa` | Últimas N mensagens de uma conversa, com quem respondeu cada | R |
| `relatorio_atendimento` | Stats do dia/semana: respondidas, pendentes, por pessoa, tempo médio | R |
| `tasks_por_usuario` | Tasks abertas/vencidas de uma pessoa | R |
| `tasks_vinculadas_conversa` | Tasks ligadas a uma conversa específica | R |
| `criar_task` | Cria task no TaskFlow com título/prazo/responsável/conversa_id opcional | W |
| `atribuir_conversa` | Seta `responsavel_atual` de uma conversa | W |
| `marcar_follow_up` | Agenda follow-up em conversa | W |
| `enviar_wa_para_membro` | Manda WA pra Iza/Mariana/Maikon via Evolution (notificação interna) | W |
| `enviar_wa_para_contato` | Manda WA pra um contato (paciente/parceiro) — requer confirmação explícita | W + confirm |

**Permissões por role:**
- `admin_geral` / `medico` (Maikon) → todas as tools
- `secretaria_medica` (Iza/Mariana) → tools de read + criar_task + marcar_follow_up. Não pode `atribuir_conversa` de outras, não pode `enviar_wa_para_contato`.

**Agendador proativo (cron)**
- Edge function `ai-proactive-scan` rodando a cada 30min
- Verifica: conversas há >4h sem resposta, tasks vencidas, contatos VIP pendentes
- Quando detecta, manda alerta pro Maikon via mesma edge function
- Resumo diário 18h (já existe `ResumoDiario18h` — será substituído por esse fluxo mais inteligente)

### 3.2 Persistência e estado

Novas tabelas necessárias:

```sql
-- Sessão de chat entre usuário e IA (contexto da conversa)
ai_agent_sessions (
  id uuid pk,
  user_id uuid fk profiles,      -- quem conversa com a IA
  instancia_id uuid fk instancias_whatsapp,  -- instância AI
  session_start timestamptz,
  last_activity timestamptz,
  messages jsonb,                -- últimas N mensagens da sessão
  metadata jsonb
)

-- Log de ações da IA (auditoria)
ai_agent_actions (
  id uuid pk,
  session_id uuid fk,
  user_id uuid,
  tool_name text,                -- 'criar_task', 'atribuir_conversa' etc.
  tool_input jsonb,
  tool_output jsonb,
  success boolean,
  created_at timestamptz
)

-- Fila de alertas proativos
ai_agent_alerts (
  id uuid pk,
  user_id uuid fk profiles,
  tipo text,                     -- 'escalation', 'daily_summary', 'sla_breach'
  payload jsonb,
  enviado boolean default false,
  scheduled_for timestamptz,
  sent_at timestamptz
)
```

### 3.3 Segurança

- Remetente **obrigatoriamente** precisa estar em `profiles.telefone_contato` — caso contrário, mensagem é silenciosamente ignorada (sem log público)
- Todas as tools de escrita são logadas em `ai_agent_actions`
- Ações sensíveis (envio pra contato externo, atribuição em lote >5) pedem confirmação textual ("responda CONFIRMA pra seguir")
- Chave da Anthropic fica apenas em `SUPABASE_SECRETS`
- LGPD: a IA não expõe CPF, endereços ou dados clínicos em respostas sem que o usuário peça explicitamente o detalhe do contato
- RLS no Supabase já garante que um `secretaria_medica` não veja conversas de outra fora do escopo dela

---

## 4. Custo de operação

**Por mensagem ao assistente:**
- Modelo: Claude Sonnet 4.6 (ou Haiku 4.5 para perguntas simples — roteamento por complexidade)
- Prompt médio (com contexto do sistema + histórico + tool definitions + pergunta): ~8.000 tokens input
- Resposta típica: ~500 tokens output
- Com **prompt caching de 5min** (sistema + tool catalog ficam em cache): ~2.500 tokens "frescos" por request
- Sonnet 4.6: ~$0.015 por request. Haiku 4.5: ~$0.003 por request
- Tools: 1-3 queries por interação → 5-10ms cada, custo desprezível

**Estimativa uso real (3 usuários, 30-50 mensagens/dia cada):**
- ~120 interações/dia → ~3.600/mês
- 60% roteadas para Haiku (perguntas simples) + 40% Sonnet (ações complexas)
- **Custo estimado: $30-60/mês em API Anthropic**
- Se Maikon topar pagar um mensal fixo, posso negociar um limite de 5.000 interações com segurança.

**Custo de desenvolvimento inicial (uma vez):**
- Desenvolvimento: 3-4 semanas (detalhado abaixo)
- Instância WA dedicada: ~R$30/mês do chip (já tem infra Evolution)
- Manutenção contínua: ~5h/mês ajustes/novos tools

---

## 5. Cronograma de desenvolvimento

| Fase | Entrega | Duração | Pré-requisito |
|---|---|---|---|
| **Fase 0** | Sprint atual — schema de atribuição (`responsavel_atual`, `conversa_id` em tasks) | 3-4 dias | — |
| **Fase 1** | Tools read-only + edge function base + instância WA dedicada | 1 semana | Fase 0 |
| **Fase 2** | Tools de write (criar_task, atribuir, follow_up) + notificação a secretária | 1 semana | Fase 1 |
| **Fase 3** | Agendador proativo (resumo 18h, escalation, SLA) + log de auditoria | 5 dias | Fase 2 |
| **Fase 4** | Refinamento (prompt tuning, roteamento Sonnet/Haiku, aprendizado com uso real) | contínuo | Fase 3 |

**Total até ter o assistente funcional: 3-4 semanas após a Fase 0.**

---

## 6. Evolução futura (fora do escopo inicial)

1. **Agendamento via IA** — "marca essa cirurgia no Google Calendar dia 20 às 14h" → IA executa via integração Google Calendar existente
2. **IA para qualificação de conversas de paciente** (diferente — é IA *externa* conversando com paciente). Isso é um projeto separado, complexo, com riscos regulatórios. Não confundir com o copiloto administrativo.
3. **Voice-to-text** — Maikon manda áudio pro assistente, ele transcreve e executa (usa pipeline `webhook_ia_disparos` já existente)
4. **Busca semântica sobre conversas** — indexar mensagens em pgvector, permitir perguntas tipo "em que ponto da conversa com o Dr. X combinamos valores?"
5. **Integração com Claude Desktop** — além do WhatsApp, o Maikon pode usar o mesmo assistente pelo Claude Desktop no PC via MCP server que reusa as mesmas tools

---

## 7. Decisões pendentes

1. **Número WhatsApp dedicado pro assistente:** chip novo ou reaproveitar existente?
2. **Modelo padrão:** Sonnet 4.6 pra tudo (mais capaz, mais caro) OU roteador Haiku/Sonnet por complexidade (mais barato, mais complexo de ajustar)?
3. **Escopo de atuação das secretárias:** elas podem usar todas as tools de read ou só sobre as conversas/tasks delas? (Recomendo: read amplo, write só do escopo delas)
4. **Nome do assistente:** como ele se identifica na conversa? ("Maikonect Assistente", "Ana" [tipo nome humano], "AI do Maikon"?)
5. **Política de horário:** o assistente responde 24/7 ou tem horário comercial + plantão (fora do horário só avisa o que é urgente)?

---

## 8. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| IA alucina e cria task errada | Toda ação de write logada + confirmação explícita em ações sensíveis |
| Maikon pede algo além do escopo (ex: diagnóstico) | System prompt restringe ao domínio administrativo — recusa médicas com mensagem padrão |
| Mensagem vaza dados sensíveis de paciente | A IA só expõe o que o user já tinha acesso (RLS) + prompt instrui a não recitar CPF/endereço sem pedido explícito |
| Instância WA do assistente cai | Healthcheck a cada 5min + alerta pro Raul |
| Custo de API explode | Hard-limit diário no orçamento (rate limit + alerta se passar de 80% do budget) |
| Secretárias acham "invasivo" | Opt-in: elas podem silenciar alertas automáticos, só usar quando quiserem |

---

## 9. Resumo executivo (para o Dr. Maikon)

**O que é:** um número de WhatsApp exclusivo que funciona como seu braço direito administrativo. Você conversa com ele em linguagem natural e ele acessa o CRM, cria tarefas, atribui pras secretárias, gera relatórios, te avisa quando algo urgente aparece.

**O que ele resolve:** o trabalho manual de final de semana. Tudo o que você hoje faz olhando o CRM e organizando manualmente, ele faz por você a qualquer hora, de qualquer lugar, via WhatsApp.

**Quem usa:** você, a Iza e a Mariana. Cada um vê e pode atuar só no que é do escopo dele (você vê tudo; elas veem só as conversas e tasks delas).

**O que precisa:** um número WA novo dedicado pro assistente (chip + R$30/mês). E ~3-4 semanas de desenvolvimento depois de terminarmos a sprint atual do CRM.

**Quanto custa pra operar:** ~$50/mês em IA Anthropic (40-60 reais). Com o uso crescendo, chega em ~$100/mês.

**Quando fica pronto:** ~5 semanas contando a partir da aprovação, assumindo desenvolvimento em paralelo com outras demandas do CRM.

---

*Este documento é um plano de arquitetura. A implementação começa após (a) aprovação do Dr. Maikon e (b) conclusão da Sprint atual de Tarefas + Visibilidade (pré-requisito: schema de `responsavel_atual` e `conversa_id` em tasks precisa estar consolidado antes de a IA ser útil).*
