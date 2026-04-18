# Roadmap Geral — Maikonect CRM

**Última atualização:** 26/03/2026
**Cliente:** Dr. Maikon Madeira
**Dev:** Raul Seixas

---

## Status atual

| Item | Status |
|------|--------|
| CRM base (SDR Zap, Task Flow, Disparos) | ✅ Funcionando |
| Agente pós-op n8n | ✅ v15, rodando |
| Custo Supabase | 🟡 Correções aplicadas em 26/03 — monitorando |
| Classificação de contatos por IA | ✅ Implementado (individual + lote) |
| Roteamento automático por perfil | ✅ Implementado |
| Hub WhatsApp | ⚠️ Funcional, UX pendente de revisão |
| Instâncias de Iza/Mariana conectadas | ❓ Validar |
| Número do consultório conectado | ❓ Validar |
| Integração n8n ↔ CRM | ❌ Não existe ainda |

### Correções de performance aplicadas (26/03/2026)

| Correção | Impacto |
|----------|---------|
| Cron `processar-disparos-agendados`: `* * * * *` → `*/15 * * * *` | -93% invocações (1.440 → 96/dia) |
| Evolution API: CONNECTION_UPDATE e CONTACTS_UPDATE desativados | Menos webhooks desnecessários |
| Webhooks de todas as instâncias: limpeza total, só 3 eventos essenciais | ~15 eventos/min → só mensagens reais |
| Realtime cleanup em todos os componentes | ✅ Já estava OK |

**Pendente de performance (ajustes no código):**
- [ ] Early return para `fromMe` nos webhooks (edge functions)
- [ ] 2 índices compostos faltantes: `(instancia_id, status)` em conversas, `(instance_id, created_at DESC)` em messages
- [ ] Limit na query do MonitorSecretarias (sem bound hoje)
- [ ] Avaliar polling de 5s de instâncias no SDR Zap

---

## Fases e semanas

### FASE 1 — Performance (semana 22/03) — 80% CONCLUÍDA
**Spec:** `docs/FASE_1_PERFORMANCE.md`
**Por que primeiro:** não faz sentido adicionar features num sistema que custa 10x mais do que deveria

- ✅ Auditar invocações edge functions no dashboard Supabase
- ✅ Filtrar eventos desnecessários do Evolution API webhook (feito manualmente)
- ✅ Corrigir cleanup de Realtime subscriptions (já estava OK)
- ✅ Ajustar intervalos dos cron jobs (processar-disparos: 1min → 15min)
- [ ] Criar índices compostos faltantes
- [ ] Adicionar filtro `fromMe` nos webhooks
- [ ] Monitorar custo por 1 semana após correções
- **Meta:** custo cair para < $1/dia

---

### FASE 2 — Novo Home com IA + Agenda Centralizada (semana 29/03)
**Spec:** `docs/FASE_2_HOME_AGENTE.md`
**Por que segundo:** resolve a dor principal do Dr. Maikon + pedido direto da Iza

- Componente BriefingIA: resumo em linguagem natural, atualizado a cada 30min
- Componente MonitorSecretarias: conversas abertas por responsável em tempo real
- Redesign do layout do Home com nova hierarquia
- Tabela `briefings_home` + edge function `gerar-briefing-home`
- **NOVO — Agenda centralizada no CRM** (pedido da Iza):
  - Módulo de agenda interno (não depender só do Google Calendar)
  - Envio automático via WhatsApp: agenda da manhã + resumo do final do dia
  - Visualização clara dos compromissos do Dr. Maikon no Home
- **NOVO — Indicadores de tarefas por secretária** (pedido da Iza):
  - Dashboard de produtividade: tarefas criadas/concluídas por perfil (Iza, Mariana)
  - Filtro por período (hoje, semana, mês)
  - Dados já existem em `task_flow_tasks` + `task_flow_history` — é criação de UI
- **Meta:** Dr. Maikon abre o CRM e sabe o que aconteceu em 10 segundos. Iza e Mariana veem seus indicadores.

---

### FASE 3 — Banco de contatos inteligente (semana 05/04) — PARCIALMENTE IMPLEMENTADA
**Spec:** `docs/FASE_3_CONTATOS_IA.md`
**Por que terceiro:** destrava os 15k contatos como ativo estratégico

- ✅ Campo perfil_profissional + especialidade + cargo + cidade + relevância nos contatos
- ✅ Edge function de classificação por IA (individual) — roda automaticamente ao receber mensagem
- ✅ Edge function de classificação em lote (50 por vez, prioriza por nº de mensagens)
- ✅ Padronização OpenAI (GPT-4o-mini)
- ✅ UI de classificação manual na página `/contatos` (dropdown + campos + botão IA)
- ⚠️ UI de filtro por perfil em Campanhas existe MAS **filtro não é aplicado nos envios** (bug)
- [ ] **Corrigir filtro de perfil nos Disparos** — JOIN campanha_envios com contacts por telefone
- [ ] **Perfil visível no SDR Zap** — badge no card + seção no painel de detalhes
- [ ] **Sync em massa de contatos via Evolution API** — nova edge function (hoje só entra contato que mandou mensagem)
- [ ] **Rodar classificação IA em lote na base existente** (2.101+ contatos)
- [ ] Sync `leads ↔ contacts` para unificar `perfil_profissional` entre as duas tabelas
- [ ] Importação VCF do WhatsApp pessoal (parser já existe, mas sync via Evolution é preferível)
- **Meta:** Dr. Maikon filtra "cirurgiões cardíacos" em 2 cliques para o evento de novembro
- **Nota:** Hub mostra 2.101 contatos — apenas os que trocaram mensagem. Os 15k do número pessoal precisam de sync em massa ou importação

---

### FASE 4 — Agente de tarefas + follow-ups (semana 12/04)
**Spec:** `docs/FASE_4_AGENTE_TAREFAS.md`
**Por que quarto:** elimina trabalho manual — médico usa com 1 frase

- Follow-up simples por conversa (campo + cron + notificação WA)
- Modal de comando rápido (Cmd+K) com linguagem natural
- Edge function `interpretar-comando` com confirmação visual
- Notificação WA para secretária ao receber tarefa
- **NOVO — Horário visível na coluna "Lembrar Dr. Maikon"** (pedido da Iza):
  - Exibir hora do prazo no card da tarefa quando está nessa coluna
  - Esforço baixo — mudança em 1 componente do TaskFlow
- **NOVO — Criar tarefa a partir de conversa no SDR Zap** (documentado como pendente):
  - Botão no menu de ações da conversa
  - Modal pré-preenchido com nome do contato e última mensagem
  - Hoje só existe via webhook externo (n8n)
- **Meta:** "Iza, receita pra João até sexta" → tarefa criada + WA enviado

---

### FASE 5 — Hub WhatsApp + tags automáticas (semana 19/04) — EM ANDAMENTO
**Spec:** `docs/FASE_5_HUB_WHATSAPP.md`
**Por que quinto:** centraliza tudo após a base estar sólida

- ✅ Roteamento automático de conversas por perfil
- ✅ Classificação de contatos por IA
- ✅ Padronização OpenAI
- ⚠️ Hub WhatsApp funcional mas UX precisa de revisão visual
- [ ] Conectar instâncias de Iza, Mariana, consultório
- [ ] Filtro rápido por instância no SDR Zap
- [ ] View unificada (todas as instâncias numa inbox)
- [ ] Edge function `classificar-conversa-ia` com tags automáticas
- **NOVO — Revisão UX do SDR Zap** (pedido da Iza):
  - Layout de 3 colunas incomoda — investigar com Iza o que exatamente
  - Possíveis melhorias: espaçamento, responsividade, clareza visual entre colunas
  - Considerar opção de layout simplificado para telas menores
- **Meta:** tudo num lugar, nada se perde, UX aprovada pelas secretárias

---

### FASE 6 — Integração n8n ↔ CRM (paralelo à fase 3-4)
**Spec:** `docs/FASE_6_N8N_INTEGRACAO.md`
**Por que paralelo:** pode ser feito em partes sem bloquear o resto

- Escalonamentos PRECISA_MAIKON → conversa no SDR Zap
- Pacientes pós-op → contatos classificados no CRM
- Dúvidas no Sheets → tarefas no Task Flow
- (Mês 2) Resposta do CRM → paciente via n8n
- **Meta:** n8n alimenta o CRM, nada fica no celular pessoal

---

### FUTURO — Centralização total (visão longo prazo)
**Motivação:** Iza usa Google Drive para planilhas, documentos, POPs, gestão de pacientes. Quer tudo num lugar só.

Possíveis módulos futuros (ainda não priorizados):
- Módulo de Documentos/Storage interno (substituir Google Drive)
- Gestão de pacientes (ficha, histórico, POPs)
- Dashboard de produtividade expandido (métricas da clínica)
- **Validar escopo com Dr. Maikon antes de planejar**

---

## Bugs e inconsistências conhecidos (documentados em `docs/MODULO_FLUXOS_TRANSVERSAIS.md`)

| # | Bug | Severidade |
|---|-----|-----------|
| 1 | Notificações: som duplicado (2x por notificação) | Baixa |
| 2 | Notificações: canal Realtime sem filtro por user_id (som toca pra todos) | Média |
| 3 | Notificações de instância caída: inseridas sem user_id → invisíveis | Média |
| 4 | Transferência de conversa: não cria notificação in-app | Baixa |
| 5 | `notificar-delegacao`: URL da Evolution hardcoded (ngrok) | Alta |
| 6 | Calendar callbacks: só fazem log, não persistem dados | Média |
| 7 | Contatos: botão "Adicionar anexo" sem handler (visual only) | Baixa |
| 8 | Contatos: sem paginação (carrega todos de uma vez) | Média |
| 9 | `gerar-variacao-mensagem`: busca `gemini_api_key` que pode não existir | Média |
| 10 | Trigger `notify_task_created`: broadcast pra TODOS os perfis | Baixa |

---

## Regras de desenvolvimento

1. **Fase 1 é bloqueante** — não começar features novas antes de resolver custo
2. **Plan mode** para qualquer tarefa que toque 3+ arquivos
3. **Uma migration por feature** — nunca editar migration existente
4. **Testar Realtime cleanup** em todo componente novo com subscriptions
5. **Confirmar com usuário** antes de implementar IA que age automaticamente
6. **Apresentar ao Maikon** o resultado de cada fase antes de avançar
7. **Feedback das secretárias** é prioritário para decisões de UX — elas são as power users

---

## Perguntas pendentes a validar

### Com Dr. Maikon
- [ ] Quais instâncias já estão conectadas na Evolution API?
- [ ] Número do consultório — já tem chip/número definido?
- [ ] Iza e Mariana têm números fixos para o consultório ou usam pessoais?
- [ ] O número pessoal (15k contatos) — quer conectar ao CRM ou manter separado?
- [ ] Qual é o número do n8n (Z-API) para os pacientes pós-op?
- [ ] Agenda centralizada: manter sync com Google Calendar ou independente?
- [ ] Visão de longo prazo: centralizar Drive/planilhas dentro do CRM?

### Com Iza (secretária)
- [ ] SDR Zap: o que exatamente no layout incomoda? (telas pequenas? 3 colunas? outra coisa?)
- [ ] Indicadores: quais métricas são mais úteis pra ela? (volume? tempo de resposta? pendentes?)
- [ ] Agenda: que informações ela precisa ver? (horários, paciente, tipo de procedimento?)
- [ ] Drive: quais documentos/planilhas ela mais usa no dia a dia?
