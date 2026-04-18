# Módulo Home (Dashboard) e Relatórios

> Documentação técnica e operacional — Última atualização: 2026-03-22

---

## PARTE 1 — HOME (`/home`)

### 1.1 Componentes do Dashboard

A página Home (`src/pages/Home.tsx`) é composta por 3 componentes organizados em grid de 2 colunas:

| Componente | Arquivo | Posição no Layout |
|---|---|---|
| `WeeklyMetrics` | `src/components/WeeklyMetrics.tsx` | Coluna esquerda, topo (flex-shrink-0) |
| `TasksSummary` | `src/components/TasksSummary.tsx` | Coluna esquerda, preenche espaço restante (flex-1) |
| `AgendaList` | `src/components/AgendaList.tsx` | Coluna direita, altura total |

**Layout:** `grid grid-cols-1 lg:grid-cols-[2fr_1fr]` — em desktop, 2/3 para esquerda e 1/3 para direita.

> **Nota:** Existe `DashboardStats.tsx` no projeto mas **NÃO é usado** na Home atual. É um componente legado com métricas de consultas médicas (confirmadas, realizadas, canceladas) que busca de `eventos_agenda` e `conversas`.

---

### 1.2 WeeklyMetrics — Métricas de Disparos

**O que mostra:**
- **Card destaque:** Total de envios do mês atual (com ícone de calendário)
- **3 cards diários:** Envios de Hoje, Ontem e Anteontem
- **Gráfico de pizza (donut):** Distribuição por tipo de disparo (massa, automático, etc.)

**Dados buscados:**

| Tabela | Campos | Filtros |
|---|---|---|
| `campanha_envios` | `id, status, enviado_em, campanha_id` | `status = 'enviado'`, `enviado_em >= 3 dias atrás`, `enviado_em IS NOT NULL` |
| `campanhas_disparo` (JOIN) | `nome, tipo` | — |

**Lógica de cálculo:**
- Busca envios dos últimos 3 dias (para cobrir virada de mês)
- Total do mês: filtra localmente `enviado_em >= inicio do mês`
- Envios por dia: agrupa por `format(enviado_em, "yyyy-MM-dd")`
- Tipos de disparo: agrupa por `campanhas_disparo.tipo`

**Estabilidade técnica:**
- Datas âncora (`hoje`, `inicioMes`, `tresDiasAtras`) são memoizadas com `useMemo` para evitar queryKey instável
- `staleTime: 30000` (30s) para evitar refetch excessivo
- `retry: 1` para falhas

---

### 1.3 TasksSummary — Resumo de Tarefas

**O que mostra:**
- **4 cards métricos clicáveis:**
  - ✅ Realizadas Hoje — tarefas na coluna "Finalizada" com `updated_at` = hoje
  - ⏰ Vencendo Hoje — tarefas com `prazo` = hoje, não finalizadas
  - 📋 Vencendo Amanhã — tarefas com `prazo` = amanhã, não finalizadas
  - 🔴 Atrasadas — tarefas com `prazo` passado (excluindo hoje), não finalizadas
- **Lista "Próximas tarefas":** até 5 tarefas não finalizadas, ordenadas por prazo

**Dados buscados:**

| Tabela | Campos | Filtros |
|---|---|---|
| `task_flow_tasks` | `id, titulo, prazo, column_id, updated_at` | `deleted_at IS NULL` |
| `task_flow_columns` (JOIN) | `nome, cor` | — |

**Interações:**
- Clicar em um card métrico abre `TasksModal` com lista filtrada
- Clicar em uma tarefa (na lista ou no modal) navega para `/task-flow?task={id}`
- `TasksModal` exibe grid de cards com prazo colorido (vermelho=atrasado, âmbar=hoje)

**Lógica de filtro:**
- "Finalizada" é identificada pelo **nome da coluna** (`task_flow_columns.nome === "Finalizada"`), não por tipo ou ID

---

### 1.4 AgendaList — Agenda do Dia

**O que mostra:**
- Lista de eventos do dia do médico logado
- Cada evento renderizado como `AgendaCard` com: título, tipo, horário, status, descrição

**Dados buscados:**

| Tabela | Campos | Filtros |
|---|---|---|
| `eventos_agenda` | `*` (todos os campos) | `medico_id = auth.uid()`, `data_hora_inicio` entre hoje 00:00 e amanhã 00:00 |

**Ordenação:** `data_hora_inicio ASC`

**Observação:** Filtra por `medico_id = user.id`, ou seja, cada usuário vê apenas seus próprios eventos. A RLS da tabela também reforça isso (médico vê seus eventos, admin vê todos).

---

### 1.5 Diferenciação por Role

**NÃO há diferença de visualização por role na Home.** Todos os usuários autenticados veem o mesmo dashboard. Porém:

- **WeeklyMetrics:** Todos veem os mesmos dados de disparos (a query não filtra por `created_by`)
- **TasksSummary:** Todos veem TODAS as tarefas não deletadas (sem filtro por responsável)
- **AgendaList:** Filtra por `medico_id = auth.uid()` — cada usuário vê apenas seus eventos. Como a maioria dos eventos pertence ao Dr. Maikon, secretárias verão agenda vazia a menos que tenham eventos próprios

**Impacto RLS:**
- `campanha_envios`: SELECT permitido para qualquer autenticado → todos veem tudo
- `task_flow_tasks`: não tem RLS restritiva para SELECT (apenas `auth.uid() IS NOT NULL` implícito via tabela relacionada)
- `eventos_agenda`: RLS restringe a `medico_id = auth.uid() OR admin_geral`

---

## PARTE 2 — RELATÓRIOS (`/relatorios`)

### 2.1 Relatórios Disponíveis

A página de relatórios (`src/pages/Relatorios.tsx`, ~1294 linhas) usa sistema de **Tabs** com 7 visualizações:

| Tab | Nome | Tipo de Gráfico | Descrição |
|---|---|---|---|
| `diario` | Por Dia | BarChart empilhado | Volume diário de disparos |
| `campanha` | Por Campanha | BarChart horizontal + lista | Distribuição por campanha |
| `tipo` | Por Tipo | BarChart horizontal + lista | Distribuição por tipo de lead |
| `especialidade` | Especialidade | PieChart + lista | Distribuição por especialidade médica |
| `mensal` | Por Mês | LineChart | Evolução mensal |
| `conversao` | Respondidos | BarChart horizontal + lista | Taxa de resposta por campanha |
| `tarefas` | Tarefas | BarChart + lista por responsável | Criadas vs realizadas + performance por perfil |

---

### 2.2 Métricas Calculadas e Tabelas Envolvidas

#### KPIs Globais (cards no topo)

| Métrica | Cálculo | Tabela |
|---|---|---|
| Total para Disparo | `count(campanha_envios)` no período | `campanha_envios` |
| Enviados | `count(status = 'enviado')` | `campanha_envios` |
| Pendentes | `count(status IN ('enviar','reenviar','pendente'))` | `campanha_envios` |
| Falhas | `count(status IN ('NoZap','erro','falha'))` | `campanha_envios` |
| Taxa de Sucesso | `enviados / total × 100` | calculado |
| Taxa de Resposta | `telefones que responderam / enviados únicos × 100` | calculado (ver abaixo) |

#### Cálculo da Taxa de Resposta (complexo)

O cálculo de "Respondidos" cruza **3 fontes de dados**:

1. **Tabela `messages`** (Evolution API): `from_me = false`, JOIN com `contacts` para obter `phone`
2. **Tabela `mensagens`** (SDR Zap): `remetente = 'contato'`, JOIN com `conversas` para obter `numero_contato`
3. **Tabela `conversas`**: `ultima_interacao` no período como proxy de resposta

**Lógica de matching:**
- Normaliza telefones (remove 9º dígito extra do formato brasileiro) usando `normalizarTelefone()`
- Compara telefone do envio com telefone da resposta
- Verifica se `resposta.created_at > envio.enviado_em` (resposta após o disparo)

#### Métricas de Tarefas (tab "Tarefas")

| Métrica | Tabela | Filtro |
|---|---|---|
| Criadas no período | `task_flow_tasks` | `deleted_at IS NULL`, `created_at >= dataInicio` |
| Realizadas no período | `task_flow_tasks` | `column_id = Finalizada`, `updated_at >= dataInicio` |
| Atrasadas | `task_flow_tasks` | `prazo < now()`, `column_id ≠ Finalizada` |
| Em andamento | `task_flow_tasks` | `column_id ≠ Finalizada` (count total) |
| Por responsável | `task_flow_profiles` (JOIN) | Agrupado por `responsavel_id` |

---

### 2.3 Exportação

**A página de Relatórios NÃO possui funcionalidade de exportação direta (CSV, PDF, etc.).**

A exportação de dados existe em **outra edge function** separada:
- `exportar-leads-enviados`: exporta leads enviados de uma campanha específica como JSON

Não há botão de exportação na UI de Relatórios.

---

### 2.4 Geração de Relatório por Imagem (`relatorio-imagem`)

A edge function `supabase/functions/relatorio-imagem/index.ts` (375 linhas) gera uma **imagem de dashboard** usando IA generativa.

#### Fluxo:

```
1. Busca dados do banco (disparos, especialidades, tarefas)
2. Monta prompt textual descrevendo o layout visual
3. Envia para Lovable AI (google/gemini-2.5-flash-image)
4. Recebe imagem base64
5. Retorna JSON com: media (base64), mediatype, fileName, caption, dados
```

#### Dados coletados:

| Dado | Tabela | Detalhe |
|---|---|---|
| Disparos hoje/ontem/anteontem | `campanha_envios` | `status = 'enviado'`, filtrado por dia |
| Disparos do mês | `campanha_envios` | Desde início do mês |
| Por especialidade | `campanha_envios` + `leads` | JOIN via `lead_id`, agrupa por `leads.especialidade` |
| Respostas | `messages` + `contacts` | `from_me = false`, correlaciona telefone |
| Tarefas criadas/semana | `task_flow_tasks` | `created_at >= início da semana` |
| Tarefas realizadas/semana | `task_flow_tasks` | Na coluna "Finalizada", `updated_at >= início da semana` |
| Tarefas atrasadas | `task_flow_tasks` | `prazo < hoje`, não na coluna "Finalizada" |

#### Endpoints:

- **GET `?format=json`**: Retorna apenas os dados em JSON (sem gerar imagem)
- **GET** (sem params): Gera imagem e retorna base64

#### Estilo da imagem:
- Fundo branco, acentos teal (#0D9488)
- Branding "Maikonect" com logo
- Design minimalista estilo Apple/Notion
- Resolução 1024x1024

#### Uso:
A imagem é destinada a ser enviada via WhatsApp (Evolution API) como relatório visual diário. O campo `caption` inclui a data formatada.

---

### 2.5 Filtros de Período Disponíveis

| Valor | Rótulo |
|---|---|
| `7` | Últimos 7 dias |
| `30` | Últimos 30 dias (padrão) |
| `60` | Últimos 60 dias |
| `90` | Últimos 90 dias |
| `180` | Últimos 6 meses |
| `365` | Último ano |

**Filtro por Campanha:**
- "Todas as campanhas" (padrão, `__all__`)
- Lista de campanhas de `campanhas_disparo` (ordenadas por nome)

**Observação:** Os filtros de período e campanha afetam **todas as tabs** simultaneamente. Ao trocar um filtro, ambos `fetchRelatorios()` e `fetchTarefasRelatorio()` são re-executados.

---

### 2.6 Considerações Técnicas

#### Paginação
- A query de `campanha_envios` usa **paginação manual** em lotes de 1000 registros (loop até 100k)
- O mesmo para `messages`, `mensagens` e `conversas` na aba de conversão
- Isso pode ser **muito pesado** para períodos longos (365 dias) com muitos dados

#### Performance
- Não usa `useQuery` do TanStack — usa `useState` + `useEffect` com fetch manual
- Todo o processamento (agrupamento, contagem, correlação) é feito **client-side** em JavaScript
- A tab "Respondidos" é particularmente pesada: busca todas as mensagens recebidas no período para correlacionar com telefones dos envios

#### Estado
- Usa `useState` para cada dataset individual (11 states diferentes)
- Toda mudança de filtro recalcula tudo do zero

---

## PARTE 3 — Edge Function `gerar-relatorio-crm`

Além do `relatorio-imagem`, existe a edge function `gerar-relatorio-crm` que retorna **dados estruturados em JSON** para relatórios:

- Aceita POST com parâmetros: `tipo` (completo, leads, campanhas, conversas, agenda, tarefas), `dataInicio`, `dataFim`, filtros customizados
- Usado potencialmente por integrações externas (n8n, WhatsApp bot)
- Não é chamado diretamente pela UI de Relatórios

---

## Resumo de Tabelas Acessadas

### Home
| Tabela | Componente |
|---|---|
| `campanha_envios` + `campanhas_disparo` | WeeklyMetrics |
| `task_flow_tasks` + `task_flow_columns` | TasksSummary |
| `eventos_agenda` | AgendaList |

### Relatórios
| Tabela | Uso |
|---|---|
| `campanha_envios` | Principal — todos os gráficos de disparos |
| `campanhas_disparo` | JOIN para nomes e tipos |
| `leads` | JOIN para especialidade e tipo_lead |
| `tipos_lead` | Cores dos tipos |
| `messages` + `contacts` | Taxa de resposta (Evolution) |
| `mensagens` + `conversas` | Taxa de resposta (SDR Zap) |
| `task_flow_tasks` | Tab Tarefas |
| `task_flow_columns` | Identificar coluna "Finalizada" |
| `task_flow_profiles` | Performance por responsável |
