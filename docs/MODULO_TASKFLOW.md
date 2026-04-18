# Módulo Task Flow — Manual Operacional

> **Rota:** `/task-flow`  
> **Componentes principais:** `src/pages/TaskFlow.tsx`, `src/components/taskflow/*`  
> **Tabelas:** `task_flow_tasks`, `task_flow_columns`, `task_flow_profiles`, `task_flow_tags`, `task_flow_task_tags`, `task_flow_checklists`, `task_flow_comments`, `task_flow_history`, `task_flow_attachments`  
> **Edge Functions:** `taskflow-webhook`, `taskflow-lembrar-maikon`

---

## 1. Fluxo de uma Tarefa (Criação → Conclusão)

### Criação Manual
1. Usuário acessa `/task-flow` e seleciona um **perfil** (secretária/responsável)
2. No board Kanban, clica em **"Adicionar tarefa"** no rodapé de qualquer coluna
3. Preenche título e descrição (opcional) → tarefa é criada com `origem: "manual"`
4. O `responsavel_id` é automaticamente setado para o perfil selecionado
5. O `criado_por_id` usa o perfil do sistema (auth user) do usuário logado
6. Um registro é inserido em `task_flow_history` com `tipo: "create"`
7. O trigger `notify_task_created` dispara e cria notificações para todos os `profiles` ativos

### Criação via Webhook/Automação (n8n)
1. POST para `/functions/v1/taskflow-webhook` com payload JSON, FormData ou binário
2. A função resolve `responsavel_id` por UUID ou por **nome** (busca em `task_flow_profiles`)
3. Se `column_id` não é informado, usa "Caixa de Entrada" (shared) como padrão
4. Se o payload contém áudio (base64, URL ou binário), o áudio é:
   - Detectado por magic bytes (sniffAudioFormat)
   - Enviado para storage `task-attachments`
   - Salvo como `audio_url` na tarefa
5. Tarefa criada com `origem: "api"` (se `automation=true`) ou `"webhook"`

### Movimentação
1. Usuário arrasta o card de uma coluna para outra (drag-and-drop via `@dnd-kit/core`)
2. Atualização otimista no frontend
3. `column_id` e `responsavel_id` atualizados no banco
4. Registro no `task_flow_history` com `tipo: "move"`, incluindo nome da coluna anterior e nova

### Conclusão
1. Tarefa é arrastada para a coluna **"Finalizada"** (tipo: `shared`)
2. A métrica "Realizadas Hoje" no header do board conta tarefas nessa coluna com `updated_at` de hoje

---

## 2. Colunas do Kanban

### Colunas Padrão (7 colunas)

| # | Nome | Tipo | Ícone | Descrição |
|---|------|------|-------|-----------|
| 1 | Caixa de Entrada | `shared` | `bot` | Recebe tarefas de automação. Visível para todos |
| 2 | Analisando | `individual` | `search` | Cada perfil vê só suas tarefas |
| 3 | Em Resolução | `individual` | `wrench` | Tarefas em andamento |
| 4 | Esperando Retorno | `individual` | `clock` | Aguardando resposta. Exibe `data_retorno` |
| 5 | Lembrar Dr. Maikon | `shared` | `bell` | Tarefas que o Dr. precisa ver. Integrado com webhook |
| 6 | Help/Ajuda | `shared` | `hand-helping` | Colaborativa - pedidos de ajuda |
| 7 | Finalizada | `shared` | `check-circle` | Histórico de conclusões |

### Tipos de Coluna

- **`shared` (Compartilhada):** Todas as tarefas são visíveis para todos os perfis
- **`individual`:** Cada perfil vê apenas suas próprias tarefas (filtro por `responsavel_id`)

### Customização

- Apenas **admin_geral** vê o botão "Configurar Colunas"
- Modal `TaskFlowColumnsConfig` permite:
  - **Criar** nova coluna (nome, tipo, ícone, cor)
  - **Editar** nome, tipo, ícone e cor de colunas existentes
  - **Reordenar** (botões ▲ ▼ que trocam o campo `ordem`)
  - **Deletar** coluna (⚠️ apaga todas as tarefas da coluna)
- Ícones disponíveis: bot, search, wrench, clock, hand-helping, user-check, check-circle, bell
- 10 cores predefinidas (azul, verde, âmbar, vermelho, roxo, rosa, ciano, laranja, índigo, lima)
- Alterações afetam **todos os boards** de todos os perfis

---

## 3. Atribuição de Responsável

- Cada tarefa tem um `responsavel_id` que referencia `task_flow_profiles.id`
- Na criação manual, o responsável é o perfil selecionado no momento
- Na criação via webhook, o responsável pode ser passado como UUID ou **nome** (a function busca por `nome` em `task_flow_profiles`)
- No modal de detalhes da tarefa, o responsável pode ser alterado via dropdown com todos os perfis ativos
- Ao arrastar uma tarefa para outra coluna, o `responsavel_id` é atualizado para o perfil atualmente selecionado
- Mudanças de responsável são registradas no `task_flow_history` com `tipo: "responsavel"`

---

## 4. Perfis do TaskFlow vs Profiles do Sistema

### `task_flow_profiles` (Perfis do TaskFlow)

| Campo | Descrição |
|-------|-----------|
| `id` | UUID do perfil TaskFlow |
| `nome` | Nome exibido (ex: "Iza", "Mariana", "Geral") |
| `avatar_url` | URL do avatar (opcional) |
| `cor` | Cor hex do perfil (ex: "#3B82F6") |
| `ativo` | Se aparece na seleção |
| `user_id` | FK opcional para `profiles.id` |

### `profiles` (Perfis do Sistema/Auth)

| Campo | Descrição |
|-------|-----------|
| `id` | UUID do auth.users |
| `nome` | Nome do usuário do sistema |
| `cor_perfil` | Cor do perfil |

### Relacionamento

- `task_flow_profiles.user_id → profiles.id` (opcional, N:1)
- Um perfil TaskFlow pode **não** estar vinculado a um usuário do sistema (ex: perfil "Geral")
- Vários perfis TaskFlow podem estar vinculados ao mesmo usuário
- O vínculo serve para identificar quem é o autor real nas ações (comentários, histórico)
- Ao criar/editar perfis, admins podem associar a um usuário do sistema via dropdown

### Na Prática

- **`task_flow_profiles`** são usados para: responsável de tarefas, filtro de colunas individuais, avatar no card
- **`profiles`** são usados para: autor de comentários, autor no histórico, identificação do usuário logado
- O `currentUserProfile` no código busca o `profiles` do auth user logado para registrar ações com o autor correto

---

## 5. Checklists

- Cada tarefa pode ter N itens de checklist (`task_flow_checklists`)
- Campos: `texto`, `concluido` (boolean), `ordem` (inteiro)
- Interface no modal da tarefa:
  - Input para adicionar novo item
  - Checkbox para marcar/desmarcar como concluído
  - Clique duplo para editar texto inline
  - Botão de exclusão com confirmação
- Progresso visual exibido no modal
- Operações CRUD diretas via Supabase client (sem edge function)

---

## 6. Comentários e Anexos

### Comentários (`task_flow_comments`)

| Campo | Descrição |
|-------|-----------|
| `texto` | Conteúdo do comentário |
| `tipo` | `"comentario"` (manual) ou `"anexo"` (auto-gerado ao anexar arquivo) |
| `autor_id` | FK → `profiles.id` (usuário do sistema, não TaskFlow profile) |
| `attachment_id` | FK opcional → `task_flow_attachments.id` |

- Exibidos na aba "Anotações" do modal
- Mostram avatar e nome do autor com cor do perfil
- Ordenados do mais recente para o mais antigo

### Anexos (`task_flow_attachments`)

- Upload via:
  1. **Botão de upload** (file input)
  2. **Drag-and-drop** (arrastar arquivo para o modal)
  3. **Ctrl+V / Paste** (colar screenshot da área de transferência)
- Armazenados no bucket `message-media` (caminho: `{task_id}/{timestamp}_{filename}`)
- Nomes de arquivo são sanitizados (remoção de acentos e caracteres especiais)
- Exibidos em grid com ícones por tipo (PDF, IMG, VID, AUD, XLS, DOC, ZIP, etc.)
- Ações por anexo: preview no navegador, download, excluir
- Cada upload gera automaticamente:
  - 1 registro em `task_flow_attachments`
  - 1 registro em `task_flow_history` (tipo: "anexo")
  - 1 registro em `task_flow_comments` (tipo: "anexo", texto: "📎 Anexou: filename")

---

## 7. Histórico de Movimentação

Tabela: `task_flow_history`

| Campo | Descrição |
|-------|-----------|
| `task_id` | Tarefa relacionada |
| `autor_id` | FK → `profiles.id` (quem fez a ação) |
| `tipo` | Tipo do evento (ver abaixo) |
| `descricao` | Texto descritivo |
| `valor_anterior` | Valor antes da mudança |
| `valor_novo` | Valor após a mudança |

### Tipos de Evento

| Tipo | Quando é gerado |
|------|-----------------|
| `create` | Tarefa criada (manual ou webhook) |
| `move` | Tarefa arrastada entre colunas |
| `prazo` | Prazo alterado |
| `responsavel` | Responsável alterado |
| `anexo` | Arquivo anexado |
| `delete` | Tarefa deletada (soft delete) |

- Exibido na aba "Histórico" do modal da tarefa
- Mostra nome e avatar do autor
- Ordenado do mais recente para o mais antigo

---

## 8. Ações Disponíveis por Tarefa

### No Card (Kanban Board)
- **Clicar:** Abre modal de detalhes
- **Arrastar:** Move entre colunas (drag-and-drop via `@dnd-kit`)
- **Play/Pause:** Reproduzir áudio inline (se `audio_url` existe)

### No Modal de Detalhes
- **Editar título:** Campo editável no topo
- **Alterar prazo:** Date picker com calendário
- **Alterar responsável:** Dropdown com todos os perfis ativos
- **Tags/Complexidade:** Badges clicáveis (Baixa/Média/Alta Complexidade com cores fixas: verde/âmbar/vermelho)
- **Editar descrição:** Textarea grande
- **Gerenciar checklist:** Adicionar, marcar, editar, excluir itens
- **Anexar arquivos:** Upload, drag-drop, paste
- **Comentar:** Campo de texto + enviar
- **Ver histórico:** Aba com timeline de eventos
- **Excluir tarefa:** Botão com confirmação (soft delete)
  - Apenas o criador (`criado_por_id`) pode excluir (validação no frontend)

### Via Webhook
- **Criar tarefa** (POST `/functions/v1/taskflow-webhook`)
- **Listar/buscar tarefas** (GET com filtros por column_id, responsavel_id, prazo, etc.)

---

## 9. Coluna "Lembrar Dr. Maikon" e Webhook

### Coluna no Board
- Tipo: `shared` (visível para todos os perfis)
- Ícone: `bell` (sino)
- Propósito: secretárias colocam tarefas que o Dr. Maikon precisa ver/lembrar
- Qualquer perfil pode arrastar tarefas para cá

### Edge Function: `taskflow-lembrar-maikon`

**Endpoint:** `GET /functions/v1/taskflow-lembrar-maikon`

**Autenticação:** Header `x-api-key: maikon-taskflow-2026-secure` (API key fixa no código)

**Lógica:**
1. Calcula a data de hoje no fuso `America/Sao_Paulo`
2. Filtra tarefas na coluna "Lembrar Dr. Maikon" (column_id hardcoded: `a2816095-38f9-44f9-9af9-e17ca8a2f5ea`)
3. Filtra por `prazo` do dia atual (considerando que prazo é salvo como UTC, converte BRT → UTC: `03:00 UTC` = `00:00 BRT`)
4. Retorna JSON com: data formatada, total de tarefas, e array com título + descrição

**Exemplo de resposta:**
```json
{
  "data": "22/03/2026",
  "total": 2,
  "tarefas": [
    { "titulo": "Ligar para Hospital X", "descricao": "Confirmar agenda de cirurgia" },
    { "titulo": "Revisar exames do paciente Y", "descricao": null }
  ]
}
```

**Caso de uso:** Integração com n8n que consome esse endpoint e envia resumo diário para o Dr. Maikon via WhatsApp.

---

## 10. Soft Delete e Cleanup Automático

### Soft Delete
- Tarefas **não são apagadas fisicamente** ao clicar em excluir
- Campos preenchidos no soft delete:
  - `deleted_at`: timestamp da exclusão
  - `deleted_by`: UUID do `profiles.id` do usuário que excluiu
- Todas as queries do frontend filtram com `.is("deleted_at", null)` para esconder tarefas deletadas
- Apenas o **criador** (`criado_por_id`) pode excluir a tarefa (validação no frontend no `TaskFlowCardModal`)

### Cleanup Automático
- **Cron job:** `cleanup-deleted-tasks` — executa diariamente às `03:00 UTC` (00:00 BRT)
- **Função SQL:** `cleanup_deleted_tasks()` (SECURITY DEFINER)
- **Lógica:** Remove permanentemente tarefas com `deleted_at` mais antigo que **30 dias**
- **Ordem de exclusão** (para respeitar FKs):
  1. `task_flow_comments`
  2. `task_flow_checklists`
  3. `task_flow_history`
  4. `task_flow_task_tags`
  5. `task_flow_attachments`
  6. `task_flow_tasks` (finalmente a tarefa)

> ⚠️ **Nota:** Os arquivos no storage (`task-attachments`, `message-media`) **não são apagados** pelo cleanup. Apenas os registros do banco são removidos.

---

## Apêndice A: Ordenação e Exibição dos Cards

- Cards são ordenados por **prazo** (deadline):
  1. Tarefas com prazo primeiro, ordenadas cronologicamente
  2. Tarefas sem prazo por último, ordenadas por `created_at`
- Cores de urgência no prazo:
  - 🔴 **Vermelho:** Prazo vencido (`isPast && !isToday`)
  - 🟡 **Âmbar:** Prazo hoje (`isToday`)
  - 🔵 **Azul:** Prazo amanhã (`isTomorrow`)
- Tags de complexidade:
  - 🟢 Baixa Complexidade (`#22C55E`)
  - 🟡 Média Complexidade (`#F59E0B`)
  - 🔴 Alta Complexidade (`#EF4444`)
- Badge "Automação" (azul) aparece se `origem === "api"` ou `"ia"`

## Apêndice B: Realtime

- Canal Supabase Realtime: `task_flow_tasks_changes`
- Escuta `postgres_changes` em `task_flow_tasks` (todos os eventos: INSERT, UPDATE, DELETE)
- Ao receber qualquer mudança, faz `fetchData()` completo (recarrega colunas + tarefas + tags)
- Garante que todos os boards abertos vejam mudanças em tempo real

## Apêndice C: Métricas no Header

- **Realizadas Hoje:** Conta tarefas na coluna "Finalizada" do perfil selecionado com `updated_at` de hoje
- Atualiza a cada 30 segundos via `refetchInterval` do TanStack Query
- Tarefas finalizadas são **excluídas** das contagens de "Atrasadas", "Hoje" e "Amanhã" na Home

## Apêndice D: Deep Link para Tarefa

- URL: `/task-flow?task={taskId}`
- Ao acessar com parâmetro `task`:
  1. Busca a tarefa no banco para descobrir o `responsavel_id`
  2. Seleciona automaticamente o perfil correspondente
  3. Abre o modal de detalhes da tarefa
- Usado pelo `TasksModal` na Home para navegar direto para uma tarefa específica
