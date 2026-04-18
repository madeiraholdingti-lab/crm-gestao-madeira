# MAIKONECT CRM — Documento Completo do Projeto

**Data:** 14/04/2026
**Cliente:** Dr. Maikon Madeira — Cirurgião cardíaco, gestor da Madeira Holding (Itajaí/SC)
**Desenvolvedor responsável:** Raul Seixas (consultor técnico)
**Desenvolvedor anterior:** Ewerton Monteiro (encerrou atividades em abril/2026)
**Usuárias ativas:** Iza e Mariana (secretárias da clínica)

---

## 1. VISÃO GERAL

O Maikonect é um CRM médico personalizado que centraliza:
- Comunicação WhatsApp multi-instância (SDR Zap)
- Disparos em massa segmentados
- Gestão de tarefas internas (Task Flow)
- Assistente IA por voz/texto (via n8n)
- Agenda médica integrada com Google Calendar
- Monitoramento pós-operatório de pacientes (agente n8n)

**Dor principal do Dr. Maikon:** Opera durante o dia, sai da cirurgia sem saber quem foi respondido pelas secretárias. Faz trabalho manual nos finais de semana para colocar tudo em ordem.

---

## 2. ARQUITETURA TÉCNICA

### 2.1 Stack do Frontend (Lovable Cloud)

| Tecnologia | Versão | Uso |
|-----------|--------|-----|
| React | 18.3 | Framework UI |
| TypeScript | 5.8 | Tipagem |
| Vite | - | Build tool |
| shadcn/ui + Radix UI | - | Componentes |
| Tailwind CSS | 3 | Estilização |
| TanStack Query | v5 | Estado servidor |
| react-hook-form + zod | - | Formulários |
| @dnd-kit | - | Drag & Drop (TaskFlow) |
| recharts | - | Gráficos |
| date-fns + date-fns-tz | - | Datas (fuso America/Sao_Paulo) |
| sonner | - | Toast notifications |

**Deploy:** Lovable Cloud (pendente migração para Supabase próprio)

### 2.2 Stack do Backend (Supabase)

| Componente | Detalhes |
|-----------|----------|
| Banco | PostgreSQL (Supabase managed) |
| Auth | Supabase Auth |
| Edge Functions | Deno/TypeScript |
| Realtime | WebSocket para notificações e atualizações |
| Storage | Para mídia de mensagens |
| RLS | Ativo em todas as tabelas |

### 2.3 VPS do Dr. Maikon (72.61.48.2)

**Provedor:** Hostinger/Similar
**OS:** Linux (Debian/Ubuntu)
**Painel:** EasyPanel (porta 3000)
**Domínio base:** r65ocn.easypanel.host
**Uptime:** 76+ dias
**Recursos:** CPU 1.5%, RAM 22.5% (1.9GB/8.3GB), Disco 16% (15GB/96GB)

#### Containers Docker rodando:

| Container | Serviço | Status | Porta |
|-----------|---------|--------|-------|
| sdsd_evolution-api | Evolution API (WhatsApp) | Up 26h | 8080 |
| sdsd_evolution-api-db | PostgreSQL (Evolution) | Up 2 meses | 5432 |
| sdsd_evolution-api-redis | Redis (cache Evolution) | Up 2 meses | 6379 |
| sdsd_evolution-api-db_pgweb | PgWeb (admin DB) | Up 2 meses | 8081 |
| sdsd_n8n | n8n (automações) | Up 9 dias | 5678 |
| sdsd_postgre_historic_messages | PostgreSQL (histórico) | Up 2 meses | 5432 |
| sdsd_vaultwarden | Vaultwarden (senhas) | Up 5 semanas | 80 |
| traefik | Reverse proxy + SSL | Up 2 meses | 80, 443 |
| easypanel | Painel de gestão | Up 2 meses | 3000 |

#### URLs dos serviços:

| Serviço | URL |
|---------|-----|
| EasyPanel | http://72.61.48.2:3000 |
| n8n | https://sdsd-n8n.r65ocn.easypanel.host |
| Evolution API | https://sdsd-evolution-api.r65ocn.easypanel.host |
| Evolution Manager | https://sdsd-evolution-api.r65ocn.easypanel.host/manager |
| Traefik | https://traefik.r65ocn.easypanel.host |

#### Configuração da Evolution API:

| Parâmetro | Valor |
|-----------|-------|
| DATABASE_PROVIDER | postgresql |
| DATABASE_SAVE_DATA_NEW_MESSAGE | true |
| DATABASE_SAVE_MESSAGE_UPDATE | true |
| DATABASE_SAVE_DATA_CONTACTS | true |
| DATABASE_SAVE_DATA_CHATS | true |
| DATABASE_SAVE_DATA_HISTORIC | true |
| WEBHOOK_GLOBAL_ENABLED | false (webhooks por instância) |
| WEBHOOK_EVENTS_MESSAGES_UPSERT | true |
| WEBHOOK_EVENTS_MESSAGES_UPDATE | true |
| WEBHOOK_EVENTS_MESSAGES_EDITED | true |
| WEBHOOK_EVENTS_CONNECTION_UPDATE | false (desativado para performance) |
| WEBHOOK_EVENTS_CONTACTS_UPDATE | false (desativado para performance) |
| WEBHOOK_EVENTS_SEND_MESSAGE | false |
| CACHE_REDIS_ENABLED | true |
| OPENAI_ENABLED | false |
| TYPEBOT_ENABLED | false |
| CHATWOOT_ENABLED | false |
| S3_ENABLED | false |

---

## 3. WORKFLOWS N8N

O n8n possui 8 workflows (6 publicados, 2 inativos). Total de 34.031 execuções em produção, taxa de falha 0.2%.

### 3.1 conect-what (Published)
**Função:** Conector principal WhatsApp → CRM
**Trigger:** Webhook da Evolution API (recebe eventos de mensagens)
**Fluxo:**
1. Recebe webhook da Evolution API com evento de mensagem
2. Filtra mensagens de grupo (ignora, exceto grupo específico do assistente)
3. Faz download de mídia (converte base64)
4. Formata dados necessários para o CRM
5. Envia para o endpoint do Supabase (`n8n-inbound-webhook`)
6. Se for do grupo assistente → roteia para IAmaiconnect

**Endpoint CRM:** Edge function `n8n-inbound-webhook`
**Endpoint CRM atual:** `https://dqvokdkrqseehtnltlwi.supabase.co/functions/v1/n8n-inbound-webhook`
**Nota:** Ao migrar banco, precisa trocar TODOS os endpoints Supabase nos nós do n8n (n8n-inbound-webhook, taskflow-webhook, n8n-instance-events).

**Nós do workflow (19 nós):**
- Webhook (trigger POST)
- isMessage (filtra messages.upsert / messages.update)
- isGroup (filtra @g.us)
- isTask? (verifica se é do grupo assistente: `120363407801476612@g.us`)
- istext? (verifica se é texto ou áudio)
- Code in JavaScript (normaliza tipo de mídia)
- Edit Fields (monta payload para CRM)
- messages (POST → n8n-inbound-webhook)
- events (POST → n8n-instance-events)
- creatTask (POST → taskflow-webhook — texto direto)
- creatTask1 (POST → taskflow-webhook — com descrição)
- mp4 (converte base64 → OGG/Opus)
- Call 'IAmaiconnect' (executa workflow IAmaiconnect)
- Code in JavaScript2 (normaliza número para controle de disparos)
- Edit Fields2 (adiciona dígito 9 no número)
- Execute a SQL query (consulta `controle_disparos` no Postgres local da VPS)
- If (verifica fromMe=false e tipo=text)

**Descoberta:** Existe uma tabela `controle_disparos` no PostgreSQL local da VPS (`postgre_historic_messages`) para rastrear disparos enviados. Campos: lead_id, numero, instancia, campanha_tipo, primeira_tentativa, ultima_tentativa, total_tentativas, status, source.

### 3.2 IAmaiconnect (Published)
**Função:** Assistente IA do Dr. Maikon via grupo WhatsApp
**Trigger:** Chamado pelo conect-what quando mensagem vem do grupo assistente
**Fluxo:**
1. Recebe mensagem (texto ou áudio) do grupo WhatsApp
2. Se TEXTO → cria tarefa direto no TaskFlow (endpoint `taskflow-webhook`)
3. Se ÁUDIO → transcreve o áudio
4. Envia transcrição para IA (Grok — gratuito) para classificar intenção:
   - **Tarefa** → cria no TaskFlow com áudio anexo
   - **Relatório** → busca dados do CRM (tarefas criadas/concluídas/atrasadas do dia, especialidades, envios) e retorna resumo
   - **Agenda** → roteia para workflow Agenda
5. Retorna resultado via WhatsApp no grupo

**LLMs usados:** Grok (gratuito, rate limitado ~30/dia), Gemini (para classificação mais complexa)
**Limitação:** Apenas Dr. Maikon pode estar no grupo. Se secretárias entrarem, as mensagens delas também seriam processadas como webhooks, causando duplicação.

### 3.3 IA-SDR (Published)
**Função:** IA que responde contatos automaticamente no WhatsApp
**Trigger:** Webhook (quando IA está ativada para uma instância)
**Fluxo:**
1. Recebe mensagem de contato
2. Busca contexto IA no CRM (tabela `ia_scripts` — scripts criados pelo usuário)
3. Classifica intenção da mensagem
4. Gera resposta baseada no contexto configurado
5. Envia resposta via Evolution API
6. Salva mensagem da IA no CRM via webhook

**Configuração:** Ativada por instância no CRM (Config Zaps). Quando ativada, troca o webhook da instância para o endpoint da IA.
**Nota:** Contexto IA é configurável no CRM (`/contexto-ia`) — scripts com informações sobre vagas, clínica, etc. O Ewerton deixou "livre" porque usuários esqueciam de preencher corretamente.

### 3.4 Agenda (Published)
**Função:** Gerenciamento de agenda do Dr. Maikon via WhatsApp
**Trigger:** Chamado pelo IAmaiconnect ou pelo SDR Zap (via CalendarConfirmModal)
**Fluxo:**
1. Recebe solicitação (verificar agenda ou marcar evento)
2. Passa por IA (LLM) para qualificar tipo de agendamento
3. Consulta 3 contas Google Calendar do Dr. Maikon:
   - maikon@gmail.com
   - maikon@gss.com
   - maikon@dominio.com (domínio corporativo)
4. Normaliza dados (merge das 3 agendas)
5. Se VERIFICAR → retorna horários disponíveis
6. Se MARCAR → cria/atualiza evento no Google Calendar
7. Retorna confirmação via WhatsApp

**Integração CRM:** Também recebe solicitações do SDR Zap (edge functions `calendar-webhook`, `calendar-verify-callback`, `calendar-confirmed-callback`)

### 3.5 AvisosDiarios (Published)
**Função:** Envia lembretes diários para o Dr. Maikon
**Trigger:** Cron (diário, entre 7h-8h BRT)
**Fluxo:**
1. Busca tarefas da coluna "Lembrar Dr. Maikon" no TaskFlow que têm data = hoje
2. Formata resumo com as tarefas pendentes
3. Envia via WhatsApp para o número da secretária Iza
4. As tarefas incluem data/hora do prazo

**Nota:** Usa o número do telefone da Iza para enviar. A ideia é que o Dr. Maikon receba todo dia cedo o que precisa lembrar.

### 3.6 disparador (Published — atualizado hoje 14/04)
**Função:** Executa disparos agendados de mensagens automáticas
**Trigger:** Cron ou webhook
**Fluxo:**
1. Busca mensagens agendadas (scheduled_messages ou campanhas)
2. Envia mensagem via Evolution API
3. Processa retorno/status
4. Agenda próximo envio

**Problema reportado pelo Ewerton:**
- O disparador precisa ser "reativado" todo dia (possível problema com cron do Supabase)
- Feedback de envio não retorna corretamente (callback n8n → CRM)
- Quando secretárias clicam repetidamente achando que não enviou, acumula múltiplos disparos

### 3.7 My workflow (Não publicado)
**Função:** Workflow de teste. Possivelmente tentativa de Python ou outro experimento.

### 3.8 tarefasAudio (Não publicado)
**Função:** Versão inicial do processamento de áudio para tarefas. Migrado para IAmaiconnect.

---

## 4. INSTÂNCIAS WHATSAPP

| Instância | Responsável | Status | Uso |
|-----------|-------------|--------|-----|
| Dr. Maikon (pessoal) | Dr. Maikon | Conectada | ~15k contatos, principal |
| Empresa | Dr. Maikon | Conectada? | Número corporativo |
| Consultório | Iza + Mariana | A definir | Vai ter IA respondendo |
| Disparos | Automático | Conectada | Envios em massa |
| Iza | Iza | Pendente validar | Número pessoal da secretária |
| Mariana | Mariana | Pendente validar | Número pessoal da secretária |

**Limite de disparos:** 70 por lote (aumentaram para 350 e conta foi restrita 24h). Retornaram para 70.

---

## 5. MÓDULOS DO CRM

### 5.1 SDR Zap (`/sdr-zap`)
Caixa de conversas WhatsApp com layout Kanban.
- Chat inline completo com histórico de mensagens
- Drag-and-drop de conversas entre instâncias
- Transferência de conversa entre responsáveis (com anotação)
- Integração Google Calendar (verificar/marcar via chat)
- Badge de perfil profissional (IA) no card da conversa
- Quick filter pills por instância
- Indicador de status de resposta

### 5.2 Task Flow (`/task-flow`)
Board Kanban de tarefas internas.
- Colunas configuráveis (incluindo "Lembrar Dr. Maikon")
- Perfis de usuário (Iza, Mariana, Dr. Maikon, Geral)
- Checklists inline dentro das tarefas
- Anexos e comentários
- Histórico de movimentações
- Criação por áudio via grupo WhatsApp (IAmaiconnect)
- Avisos diários automáticos (AvisosDiarios)

### 5.3 Disparos em Massa (`/disparos-em-massa`)
Sistema de envio em massa via WhatsApp.
- Gestão de Leads com importação CSV/XLSX/VCF
- Campanhas com agendamento
- Envios com controle de lote (BATCH_SIZE=70, LIMITE=350)
- Blacklist
- Filtro por tipo de lead e especialidade (bug: filtro não aplicado nos envios)
- Janela automática: 8h-16h São Paulo, seg-sex
- Callback via n8n (`n8n-disparo-callback`)

### 5.4 Disparos Agendados (`/disparos-automaticos`)
Mensagens individuais agendadas com recorrência.
- Frequência: única, diária, semanal, mensal
- Cron via edge function `processar-disparos-agendados` (a cada 15min)
- Log em `scheduled_messages_log`

### 5.5 Contatos (`/contatos`)
CRUD de contatos com classificação por IA.
- Importação CSV/VCF
- Perfil profissional (médico, cirurgião, paciente, etc.)
- Classificação automática por IA (OpenAI GPT-4o-mini)
- Classificação em lote (50 por vez)
- Sync com Evolution API (apenas contatos que enviaram mensagem)

### 5.6 Contexto IA (`/contexto-ia`)
Scripts de configuração para a IA SDR.
- Nome do script, tipo de vaga, presencial/remoto
- Informações sobre a clínica/hospital
- Comportamento da IA ao responder
- Vinculado a campanhas de disparo

### 5.7 Configurações Zaps (`/zaps`)
Gestão de instâncias Evolution API.
- Criar/excluir instâncias
- QR Code para conectar WhatsApp
- Ativar/desativar IA por instância (troca webhook)
- Status de conexão

### 5.8 Relatórios (`/relatorios`)
Dashboard de CRM e exportação de leads.

### 5.9 Usuários (`/usuarios`)
Gestão de usuários com aprovação e roles.

### 5.10 Home (`/`)
Dashboard principal com:
- Métricas semanais de disparos (WeeklyMetrics)
- Resumo de tarefas (TasksSummary)
- Agenda do dia (AgendaList)
- Indicadores de tarefas por secretária (IndicadoresSecretarias)

---

## 6. ROLES DE USUÁRIO

| Role | Acesso |
|------|--------|
| `admin_geral` | Tudo, incluindo gestão de usuários |
| `medico` | SDR Zap, Contatos, TaskFlow, Disparos, Relatórios, IA |
| `secretaria_medica` | SDR Zap, Contatos, TaskFlow, Disparos, Relatórios, IA |
| `administrativo` | SDR Zap, Contatos, TaskFlow, Disparos, Relatórios, IA |
| `disparador` | Apenas: Home, SDR Zap, Disparos, Config Zaps, Perfil |

---

## 7. FLUXO DE DADOS (CRM ↔ VPS)

### Dados que ENTRAM no CRM (n8n/Evolution → Supabase):

```
Evolution API → conect-what (n8n) → n8n-inbound-webhook (edge function) → Supabase
                                      ↓
                              Cria/atualiza: contacts, conversas, mensagens
                              Incrementa: unread_count
                              Classifica: perfil via IA (se novo contato)
```

### Dados que SAEM do CRM (Supabase → n8n/Evolution):

```
processar-envios-massa → webhook_ia_disparos (n8n) → Evolution API → WhatsApp
calendar-webhook → n8n (Agenda) → Google Calendar
notificar-delegacao → Evolution API → WhatsApp (direto)
```

### Callbacks (n8n → CRM):

```
n8n-disparo-callback ← status de envios em massa
calendar-verify-callback ← disponibilidade de agenda
calendar-confirmed-callback ← confirmação de evento criado
```

---

## 8. INTEGRAÇÕES EXTERNAS

| Serviço | Uso | Onde configurado |
|---------|-----|-----------------|
| Evolution API | WhatsApp multi-instância | VPS (Docker) + config_global no Supabase |
| n8n | Automações, IA, disparos | VPS (Docker) |
| Google Calendar | Agenda (3 contas) | OAuth2 via n8n |
| OpenAI (GPT-4o-mini) | Classificação de contatos | Edge function classificar-contato-ia |
| Grok (xAI) | Classificação de áudio (gratuito) | n8n (IAmaiconnect) |
| Gemini (Google) | LLM geral, variação de mensagens | n8n + edge functions |
| Google Console | Faturamento APIs | Conta madeira.holding.ti@gmail.com |
| Vaultwarden | Gerenciador de senhas | VPS (não totalmente configurado) |

---

## 9. BUGS E PROBLEMAS CONHECIDOS

### 9.1 Críticos

| # | Problema | Impacto |
|---|----------|---------|
| B1 | **Disparos precisam ser "reativados" diariamente** | Disparos param de funcionar. Ewerton reportou. Possível problema com cron do Supabase ou edge function falhando. |
| B2 | **Feedback de envio não retorna** | Secretárias não veem se disparo foi enviado, clicam repetidamente, acumulando 5x o envio. Pode bloquear WhatsApp. |
| B3 | **URL da Evolution hardcoded no notificar-delegacao** | Aponta para ngrok que muda — transferência de conversa pode parar de notificar. |
| B4 | **Filtro de perfil nos disparos não é aplicado** | UI mostra filtro por especialidade mas a query de envio não usa. Bug funcional. |

### 9.2 Médios

| # | Problema | Impacto |
|---|----------|---------|
| B5 | Notificação toca para todos os usuários | Canal Realtime sem filtro por user_id |
| B6 | Som de notificação duplicado | Toca 2x por notificação |
| B7 | Notificações de instância caída invisíveis | Inseridas sem user_id |
| B8 | Contatos sem paginação | Pode travar com 15k contatos |
| B9 | Callbacks de Calendar não persistem dados | Apenas logam, não salvam em eventos_agenda |
| B10 | Edge function gerar-variacao-mensagem busca chave inexistente | Busca gemini_api_key que pode não existir |

### 9.3 Baixos

| # | Problema |
|---|----------|
| B11 | Transferência de conversa sem notificação in-app |
| B12 | Botão "Adicionar anexo" nos Contatos sem handler |
| B13 | Trigger notify_task_created faz broadcast para TODOS os perfis |
| B14 | Grupo do assistente IA limitado a Dr. Maikon (se secretárias entrarem, duplica) |

---

## 10. OPORTUNIDADES MAPEADAS (ROADMAP)

### FASE 1 — Performance e Custo (80% concluída)

**O que já foi feito:**
- Cron de disparos: 1/min → 15/15min (-93%)
- Webhooks Evolution: desativados CONNECTION_UPDATE e CONTACTS_UPDATE
- Webhooks limpos em todas as instâncias (só 3 eventos essenciais)
- Early return no cron quando não há nada pendente
- INSERT duplicado removido do n8n-inbound-webhook (messages era gravado 2x)
- Cache de config_global com TTL 5min
- Reutilização de queries já carregadas (instâncias, conversa)

**O que falta:**
- [ ] Criar 2 índices compostos faltantes no banco
- [ ] Monitorar custo por 1 semana (meta: < $1/dia)

---

### FASE 2 — Novo Home com Briefing IA + Agenda Centralizada

| Item | Descrição | Complexidade |
|------|-----------|-------------|
| Briefing IA | Resumo em linguagem natural no topo do Home (IA atualiza a cada 30min) | Alta |
| Monitor de Secretárias | Cards em tempo real: conversas abertas, tempo sem resposta, urgência | Média |
| Agenda centralizada | Visualização da agenda no CRM + CRUD para secretárias + envio automático via WhatsApp (manhã + fim do dia) | Alta |
| Indicadores por secretária | Dashboard de produtividade: tarefas concluídas/criadas/atrasadas por perfil | Média |
| Redesign Home | Nova hierarquia visual | Baixa |

---

### FASE 3 — Banco de Contatos Inteligente (parcialmente implementada)

| Item | Status | Complexidade |
|------|--------|-------------|
| Campos de perfil nos contatos | ✅ Feito | - |
| Classificação IA individual | ✅ Feito | - |
| Classificação IA em lote | ✅ Feito | - |
| UI classificação manual | ✅ Feito | - |
| **Corrigir filtro de perfil nos Disparos** | ❌ Pendente | Média |
| **Perfil visível no SDR Zap** | ❌ Pendente | Baixa |
| **Sync em massa contatos via Evolution API** | ❌ Pendente | Alta |
| **Rodar classificação IA na base existente** | ❌ Pendente | Média |
| **Sync leads ↔ contacts** | ❌ Pendente | Média |

---

### FASE 4 — Agente de Tarefas + Follow-ups

| Item | Prioridade | Complexidade |
|------|------------|-------------|
| Follow-up por conversa (lembrete futuro) | ALTA | Média |
| Criar tarefa a partir de conversa no SDR Zap | MÉDIA | Média |
| Horário visível no "Lembrar Dr. Maikon" | BAIXA | Baixa |
| Modal de comando rápido (Cmd+K) | BAIXA | Alta |
| Notificação WA ao receber tarefa | MÉDIA | Baixa |

---

### FASE 5 — Hub WhatsApp Unificado

| Item | Complexidade |
|------|-------------|
| Conectar instâncias de Iza e Mariana | Média |
| Conectar instância do consultório | Média |
| Filtro rápido por instância no SDR Zap | Baixa |
| View unificada (inbox única) | Média |
| Tags automáticas por IA nas conversas | Alta |
| Roteamento automático configurável (tabela regras_roteamento) | Média |
| Revisão UX do SDR Zap (feedback Iza) | Média |
| Conexão número pessoal (15k contatos) — fase posterior | Alta |

---

### FASE 6 — Integração n8n (Agente Pós-Op) ↔ CRM

| Item | Complexidade |
|------|-------------|
| Escalonamentos PRECISA_MAIKON → SDR Zap | Média |
| Pacientes pós-op → Contatos CRM | Baixa |
| Dúvidas do Sheets → Task Flow | Média |
| Resposta do CRM volta para paciente via n8n (mês 2+) | Alta |

---

### BACKLOG DE UX

| Item | Complexidade |
|------|-------------|
| Atalho "Responder lead" nos Envios → SDR Zap | Baixa |
| Sidebar colapsável no SDR Zap | Média |
| Busca por conteúdo de mensagens | Média |
| Layout responsivo mobile | Alta |

---

## 11. MIGRAÇÃO PLANEJADA

### 11.1 Banco de dados: Lovable Cloud → Supabase próprio

**Motivação:** Ter controle total sobre o banco, reduzir custos, poder otimizar.

**O que precisa mudar:**
- Criar projeto Supabase próprio
- Migrar schema completo (tabelas, functions, triggers, policies RLS)
- Migrar dados existentes
- Atualizar `SUPABASE_URL` e `SUPABASE_ANON_KEY` no frontend
- Atualizar `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` nas edge functions
- Atualizar endpoint no n8n (`conect-what` → apenas trocar URL do webhook)
- Re-deploy de todas as edge functions
- Testar Realtime, Auth, Storage

---

## 12. NOVAS OPORTUNIDADES IDENTIFICADAS

Com base na análise da VPS, transcrição da reunião e contexto completo:

### 12.1 Melhorar o assistente do grupo WhatsApp (IAmaiconnect)
- **Problema atual:** Só Dr. Maikon pode usar (duplica se secretárias entrarem)
- **Oportunidade:** Filtrar por JID do remetente (só processar mensagens do Dr. Maikon), permitindo que secretárias entrem no grupo sem duplicação
- **Complexidade:** Baixa — adicionar filtro de JID no workflow

### 12.2 Unificar IA em um único número
- **Problema atual:** IA funciona apenas dentro do grupo
- **Oportunidade:** Migrar assistente para o número do consultório (que vai ter IA). Assim o Dr. Maikon manda mensagem direto pro número e funciona
- **Complexidade:** Média

### 12.3 Consolidar LLMs
- **Problema atual:** Usa Grok (gratuito) + Gemini + OpenAI em diferentes pontos
- **Oportunidade:** Padronizar em OpenAI GPT-4o-mini (já usado na classificação) ou migrar tudo para um só provider. Reduz complexidade e custos
- **Complexidade:** Média

### 12.4 Resolver o problema dos disparos (prioridade do Ewerton)
- **Problema:** Disparos param todo dia, feedback não retorna
- **Oportunidade:** Ewerton sugeriu criar endpoint GET no n8n que puxa disparos agendados (ao invés de depender do cron do Supabase). Isso daria mais controle e independeria de problemas do cron
- **Complexidade:** Média

### 12.5 Configurar Vaultwarden para a equipe
- **Problema:** Está rodando mas não configurado para as secretárias
- **Oportunidade:** Configurar e distribuir credenciais de forma segura para Iza e Mariana
- **Complexidade:** Baixa

### 12.6 Banco de histórico de mensagens (postgre_historic_messages)
- **Observação:** Existe um PostgreSQL dedicado para histórico na VPS
- **Oportunidade:** Investigar se está sendo usado e se pode servir como backup/archive das mensagens, reduzindo carga no Supabase
- **Complexidade:** Baixa (investigação)

### 12.7 Relatório via IA expandido
- **Problema atual:** O relatório do IAmaiconnect tem bug nas especialidades (mudança de tabela)
- **Oportunidade:** Corrigir o relatório e expandir com métricas de atendimento por secretária, tempo médio de resposta, conversões
- **Complexidade:** Média

### 12.8 Agenda proativa
- **Problema atual:** Secretárias precisam pedir a agenda manualmente
- **Oportunidade:** O AvisosDiarios já envia tarefas. Expandir para enviar agenda do dia automaticamente (merge com as 3 contas do Google Calendar)
- **Complexidade:** Média — já existe infra no workflow Agenda

---

## 13. PERGUNTAS PENDENTES

### Com Dr. Maikon
1. Quais instâncias WhatsApp já estão conectadas na Evolution API?
2. Número do consultório — já tem chip/número?
3. Iza e Mariana usam números pessoais ou fixos do consultório?
4. O número pessoal (15k contatos) — conectar ao CRM ou manter separado?
5. Qual o número do n8n/Z-API para os pacientes pós-op?
6. Agenda: manter sync com Google Calendar ou sistema independente?
7. Quer manter o grupo WhatsApp do assistente ou migrar para número dedicado?

### Com Iza
1. O que exatamente no layout do SDR Zap incomoda?
2. Quais métricas de produtividade são mais úteis?
3. Que informações precisa ver na agenda?

### Com Ewerton
1. Qual a causa raiz do disparador precisar ser reativado diariamente?
2. O postgre_historic_messages está sendo usado ativamente?
3. Senhas e credenciais de APIs (Google Console, etc.) — transferir

---

## 14. ACESSOS DOCUMENTADOS

| Sistema | URL | Observação |
|---------|-----|-----------|
| EasyPanel | http://72.61.48.2:3000 | Painel da VPS |
| n8n | https://sdsd-n8n.r65ocn.easypanel.host | Automações |
| Evolution API | https://sdsd-evolution-api.r65ocn.easypanel.host | WhatsApp |
| Evolution Manager | .../manager | Gestão de instâncias |
| SSH | root@72.61.48.2:22 | Chave SSH configurada |
| Supabase | Via Lovable Cloud | Pendente migração |
| Google Console | Via madeira.holding.ti@gmail.com | Faturamento APIs |

---

*Documento gerado em 14/04/2026. Atualizar conforme evolução do projeto.*
