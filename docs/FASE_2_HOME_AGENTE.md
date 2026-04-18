# Fase 2 — Novo Home: Briefing IA + Monitor de Secretárias

**Objetivo:** Transformar o Home de um dashboard passivo de números em um
assistente ativo que já leu tudo e entrega ao Dr. Maikon o que importa em
menos de 10 segundos — mesmo que ele tenha saído de uma cirurgia.

**Princípio de design:** Médico em movimento. Cada informação deve ser
compreensível em 3 segundos. Sem tabelas, sem números soltos, sem cliques
desnecessários para entender o que está acontecendo.

---

## Componente 1 — Briefing IA (parte superior do Home)

### O que é
Uma área no topo do Home que exibe um resumo em linguagem natural gerado por IA,
atualizado a cada 30 minutos ou sob demanda (botão "Atualizar").

### Exemplo de output esperado
```
Boa tarde, Dr. Maikon. São 16h30.

Hoje a Iza atendeu 14 conversas e está em dia. A Mariana tem 2 conversas
abertas há mais de 3 horas — a do paciente João Silva parece urgente (pediu
receita). Você tem 3 cirurgias amanhã. Nenhum escalonamento crítico do sistema
de pós-op hoje.

→ Ver conversa do João Silva
```

### Como funciona tecnicamente

**Nova edge function: `gerar-briefing-home`**

```typescript
// Coleta dados:
// 1. Conversas abertas por responsável com tempo sem resposta
// 2. Últimas mensagens de cada conversa sem resposta
// 3. Tarefas atrasadas no Task Flow
// 4. Eventos da agenda do dia seguinte
// 5. Escalonamentos pós-op das últimas 24h (tabela nova: escalonamentos_posop)

// Envia para OpenAI com prompt de sistema:
const systemPrompt = `Você é um assistente do Dr. Maikon Madeira, cirurgião cardíaco.
Resuma em 3-4 frases o que está acontecendo agora: quem das secretárias precisa
de atenção, se há algo urgente, e o que ele tem agendado. Seja direto, use
linguagem natural brasileira. Destaque o que precisa de ação dele.`

// Retorna texto + array de links de ação rápida
```

**Novo componente: `BriefingIA.tsx`**
- Exibe o texto gerado pela IA
- Botão "Atualizar" (chama a edge function)
- Links de ação rápida (ir para conversa específica, abrir tarefa, etc.)
- Skeleton loading enquanto gera
- Cache de 30 minutos (não chamar IA a cada render)
- Armazenar último briefing na tabela `briefings_home` (id, user_id, conteudo, gerado_em)

**Nova tabela necessária:**
```sql
CREATE TABLE briefings_home (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES profiles(id),
  conteudo text NOT NULL,
  links_acao jsonb DEFAULT '[]',
  gerado_em timestamptz DEFAULT now()
);
-- Manter apenas último por usuário ou últimos 5 para histórico
```

---

## Componente 2 — Monitor de Secretárias (abaixo do briefing)

### O que é
Cards em tempo real mostrando o status de atendimento de cada responsável.
Atualiza via Supabase Realtime. Maikon vê de relance se alguém está "parado".

### Layout dos cards

```
┌─────────────────────────────────┐
│  Iza                            │
│  ● Online  ·  14 respondidas    │
│                                 │
│  2 abertas:                     │
│  • João Silva — 3h sem resposta │
│  • Dra. Fernanda — 45min        │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│  Mariana                        │
│  ● Online  ·  6 respondidas     │
│                                 │
│  1 aberta:                      │
│  • Dr. Roberto — 4h ⚠️ urgente  │
└─────────────────────────────────┘
```

### Lógica de "urgente"
- Conversa aberta há > 2 horas = amarelo
- Conversa aberta há > 4 horas = vermelho + alerta
- Conversa com palavra-chave urgente/receita/dor/emergência = vermelho imediato

### Como funciona tecnicamente

**Novo componente: `MonitorSecretarias.tsx`**

Query base:
```typescript
// Buscar conversas abertas por responsável
const { data } = await supabase
  .from('conversas')
  .select(`
    id, responsavel_atual, ultima_interacao, ultima_mensagem,
    numero_contato, nome_contato,
    profiles!responsavel_atual(nome)
  `)
  .in('status', ['aberta', 'em_atendimento'])
  .order('ultima_interacao', { ascending: true })

// Agrupar por responsável_atual
// Calcular tempo sem resposta: now() - ultima_interacao
// Flag urgente se > 2h ou palavras-chave na ultima_mensagem
```

**Realtime subscription:**
```typescript
// Atualiza em tempo real quando conversas mudam
const channel = supabase
  .channel('monitor-secretarias')
  .on('postgres_changes', {
    event: '*', schema: 'public', table: 'conversas',
    filter: `status=eq.aberta`
  }, () => refetch())
  .subscribe()

return () => supabase.removeChannel(channel)  // SEMPRE limpar
```

---

## Integração no layout do Home atual

O Home atual (`src/pages/Home.tsx`) tem:
- `WeeklyMetrics` (métricas de disparos)
- `TasksSummary` (resumo de tarefas)
- `AgendaList` (agenda)

**Nova estrutura proposta:**
```
┌─────────────────────────────────────────────┐
│ BriefingIA                         [Atualizar]│  ← novo, topo
└─────────────────────────────────────────────┘
┌───────────────────┐  ┌──────────────────────┐
│ MonitorSecretarias│  │ AgendaList            │  ← secretárias à esq
│ (Iza + Mariana)   │  │ (mantém como está)   │
└───────────────────┘  └──────────────────────┘
┌─────────────────────────────────────────────┐
│ WeeklyMetrics + TasksSummary                │  ← métricas embaixo
└─────────────────────────────────────────────┘
```

---

## Componente 3 — Agenda Centralizada (pedido da Iza, 26/03/2026)

### O que é
A Iza pediu que a agenda do Dr. Maikon fique dentro do CRM ao invés de depender
do Google Calendar, com envio automático via WhatsApp de manhã e no final do dia.

### Opções de implementação

**Opção A — Agenda própria no CRM (novo módulo):**
- Nova tabela `agenda_medica` (titulo, data_hora, tipo_procedimento, paciente, local, notas)
- CRUD dentro do Home ou em página dedicada `/agenda`
- Secretárias alimentam diretamente
- Prós: não depende de Google, controle total
- Contras: duplicação se o Dr. já usa Google Calendar

**Opção B — Sync bidirecional Google Calendar → CRM (melhorar o que existe):**
- Tabela `eventos_agenda` já existe e já tem integração com Google Calendar
- Melhorar visualização no Home (hoje é lista simples)
- Adicionar CRUD para as secretárias criarem/editarem eventos
- Prós: sem duplicação, aproveita infra existente
- Contras: depende do OAuth do Google

**Recomendação:** Opção B (melhorar o existente) + fallback de cadastro manual
quando o Google não está conectado. Validar com Dr. Maikon.

### Envio automático via WhatsApp
- Cron de manhã (~7h BRT): envia agenda do dia via WA para o Dr. Maikon
- Cron final do dia (~18h BRT): envia resumo (tarefas concluídas, pendentes, agenda de amanhã)
- Edge function `enviar-agenda-diaria` que busca `eventos_agenda` + `task_flow_tasks`
- Mensagem formatada em texto simples (WhatsApp não suporta HTML)

---

## Componente 4 — Indicadores de Tarefas por Secretária (pedido da Iza, 26/03/2026)

### O que é
Dashboard de produtividade mostrando o que cada secretária fez. Dados já existem
em `task_flow_tasks` + `task_flow_history` — é criação de UI.

### Métricas sugeridas

```
┌──────────────────────────┐  ┌──────────────────────────┐
│  Iza — esta semana       │  │  Mariana — esta semana   │
│  ✅ 23 concluídas        │  │  ✅ 18 concluídas        │
│  📋 5 em andamento       │  │  📋 3 em andamento       │
│  🔴 1 atrasada           │  │  🔴 0 atrasadas          │
│  ⏱️ Tempo médio: 4h      │  │  ⏱️ Tempo médio: 3h      │
└──────────────────────────┘  └──────────────────────────┘
```

### Queries necessárias
```sql
-- Concluídas por perfil (semana atual)
SELECT p.nome, COUNT(t.id)
FROM task_flow_tasks t
JOIN task_flow_profiles p ON t.responsavel_id = p.id
JOIN task_flow_columns c ON t.column_id = c.id
WHERE c.nome = 'Finalizada'
  AND t.updated_at >= date_trunc('week', now())
  AND t.deleted_at IS NULL
GROUP BY p.nome;

-- Em andamento por perfil
SELECT p.nome, COUNT(t.id)
FROM task_flow_tasks t
JOIN task_flow_profiles p ON t.responsavel_id = p.id
JOIN task_flow_columns c ON t.column_id = c.id
WHERE c.nome != 'Finalizada'
  AND t.deleted_at IS NULL
GROUP BY p.nome;
```

### Componente: `IndicadoresSecretarias.tsx`
- Cards lado a lado (similar ao MonitorSecretarias mas com métricas de tarefas)
- Filtro de período: Hoje / Esta semana / Este mês
- Visível para todos os roles (cada um vê seus próprios indicadores, admin vê todos)
- Posição no Home: abaixo do MonitorSecretarias

---

## Checklist de execução — Fase 2

**Briefing IA + Monitor:**
- [ ] Criar tabela `briefings_home` com migration
- [ ] Criar edge function `gerar-briefing-home`
- [ ] Criar componente `BriefingIA.tsx` com cache e loading
- [ ] Criar componente `MonitorSecretarias.tsx` com Realtime (e cleanup!)
- [ ] Atualizar `Home.tsx` com nova estrutura de layout
- [ ] Testar: abrir como Dr. Maikon e como secretária (devem ver visões diferentes)
- [ ] Verificar: Realtime subscription fecha ao navegar para outra página

**Agenda centralizada (novo):**
- [ ] Validar com Dr. Maikon: agenda própria vs sync Google Calendar
- [ ] Melhorar visualização de `eventos_agenda` no Home (se Opção B)
- [ ] CRUD de eventos para secretárias
- [ ] Edge function `enviar-agenda-diaria` (manhã + fim do dia)
- [ ] Cron jobs para envio automático via WhatsApp

**Indicadores de tarefas (novo):**
- [ ] Criar componente `IndicadoresSecretarias.tsx`
- [ ] Queries de métricas por perfil com filtro de período
- [ ] Integrar no layout do Home
- [ ] Testar: secretária vê seus indicadores, admin vê todos

---

## Notas de UX

- O briefing é só para `admin_geral` e `medico` — secretárias não precisam ver
- Monitor de secretárias: secretárias veem apenas as próprias conversas, não as colegas
- Indicadores de tarefas: todos veem, mas secretárias só veem os próprios (admin vê todos)
- Botão "Atualizar" tem cooldown de 5 minutos (não deixar chamar IA sem parar)
- Se o briefing falhar (erro de API), mostrar versão fallback com só os números
