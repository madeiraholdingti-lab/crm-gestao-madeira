# Changelog Técnico — Sessão 19/04/2026

Lista todos os commits entregues nessa sessão com escopo técnico,
arquivos tocados e impacto. Usado como referência pra debug futuro,
onboarding ou geração de release notes.

**Intervalo:** commits `e658a06` (inicial) → `e1c96a8` (final)
**Autor humano:** Raul Seixas
**Co-autor IA:** Claude Opus 4.7 (1M context)
**Branch:** main (pushs diretos autorizados pelo usuário a cada entrega)

---

## Linha do tempo

| # | Commit | Título | Escopo |
|---|---|---|---|
| 1 | `04ef986` | Integra useConversas/useInstancias + ConversationList virtualizada | Refatoração SDR Zap (Sprint 2) |
| 2 | `159947f` | Atribuir responsável por conversa (UI + filtro + badge) | Sprint 4 — Entrega 2 |
| 3 | `39d5995` | Criar tarefa vinculada à conversa | Sprint 4 — Entrega 3 |
| 4 | `f5d1d4a` | Visual WhatsApp + fixes nome enviador e troca conversa | Sprint 3 |
| 5 | `defbf6c` | Fixed conditional hook order (Lovable auto-fix) | Hotfix React |
| 6 | `8ecc3f1` | Hook order + spinner ao trocar conversa | Hotfix + UX |
| 7 | `6d36ed3` | Fix última mensagem + nomes contaminados | Bug fixes |
| 8 | `46db1f2` | Monitor toggle Hoje/Histórico + preview + perfil | Melhoria UX Home |
| 9 | `b192401` | Schema tarefas.conversa_id + FK responsavel_atual + plano IA | Sprint 4 — Entrega 1 |
| 10 | `9d6be24` | Google Calendar OAuth MVP só-leitura | Sprint 6 (nova feature) |
| 11 | `e1c96a8` | Lembretes unificados como task + notificação WA | Sprint 7 (nova feature) |

---

## Detalhe por commit

### `04ef986` — Integração SDR Zap

**Motivação:** `SDRZap.tsx` tinha 4507 linhas, 33 useStates, 6 canais Realtime globais redundantes que re-fetchavam tudo a cada mensagem. Sem virtualização, 500+ cards no DOM.

**Arquivos:** `src/pages/SDRZap.tsx` (−731 linhas)

**Técnico:**
- Removeu `fetchConversas`, `fetchInstancias`, `fetchInstanciasEnvio` (substituídos por hooks TanStack Query)
- Eliminou 4 canais Realtime globais (`messages-changes`, `conversas-changes`, `instancias-changes`, `contacts-changes`)
- Plugou `useConversas`, `useInstancias`, `ConversationList` (virtualização via `@tanstack/react-virtual`)
- Optimistic updates migrados pra `queryClient.setQueryData`
- Derivações via `useMemo`: `conversasCol1`, `conversasCol2`, `getCorInstancia`, `findConversaById`

**Resultado:** DOM ~15 cards em vez de 500+. Sem re-fetch completo a cada mensagem.

---

### `f5d1d4a` — Visual WhatsApp

**Arquivos:** `src/pages/SDRZap.tsx`

**Técnico:**
- Fundo `#EFEAE2` light / `#0B141A` dark no container de mensagens
- Bolhas: `#D9FDD3`/`#005C4B` enviada, `#FFFFFF`/`#202C33` recebida
- Timestamp em cinza discreto (`text-gray-600`), não em `text-primary-foreground/70`
- Quoted messages com borda `#005C4B`

**Bug fixes:**
- Header "Maikon GSS" só aparece se conversa tem **2+ instâncias respondendo** (useMemo `conversaTemMultiplasInstancias`)
- Chat loading imediato do banco + sync em background (antes bloqueava UI por 2-5s)

---

### `8ecc3f1` — Hook order + spinner

**Bug:** `useMemo(conversaTemMultiplasInstancias)` estava **depois** do early return `if (loading) return <spinner>`. Primeiro render com `loading=true` executava N hooks; segundo com `loading=false` executava N+1 → React disparava "Rendered more hooks than during the previous render".

**Fix:** mover `useMemo` pra antes do early return. Regra: hooks sempre em ordem constante, nunca depois de return condicional.

**Plus:** novo state `loadingMensagens` que dispara spinner centralizado ao trocar de conversa (antes a UI mantinha a conversa anterior visível durante load).

---

### `6d36ed3` — Última mensagem + nomes contaminados

**Bug #1 (última msg):** query do chat fazia `.order("created_at", asc)` sem `.limit()`. Supabase default é 1000 linhas. Em conversas com >1000 msgs (ex: Ramone com 1420), retornava só as 1000 mais **antigas** — bolhas recentes invisíveis.

**Fix:** `.order("created_at", desc).limit(500)` + `.reverse()` no frontend pra exibir em ordem cronológica. Botão "Carregar mais histórico" continua navegando ao passado.

**Bug #2 (nomes):** 580 contatos tinham nomes duplicados:
- 356 com "Dr. Sandro Valério Fadel"
- 158 com "Gestao Serviço Saúde"
- 30 com "Dr Maikon Madeira Gss Saúde .:"
- 18 com "Mariana Chiarello - Assistente Administrativa"
- 18 com "Bruno Sampaio - Wati"

**Causa:** sync histórico em nov/2025 aplicava `pushName` do remetente de grupos WA a todos os participantes.

**Fix:** SQL `UPDATE contacts SET name = NULL WHERE name IN (...)` + `UPDATE conversas SET nome_contato = NULL WHERE nome_contato IN (...)`. Edge function `sincronizar-nomes-contatos` atualizada com esses nomes na lista de bloqueio preventivo. Webhook `evolution-messages-webhook` já tem proteção contra sobreposição de nomes.

**Tentativa de restaurar via Evolution API:** 500 contatos processados, 0 pushNames recuperados (Evolution não reconhece esses contatos). Nomes serão repopulados organicamente quando cada contato enviar nova mensagem.

---

### `b192401` — Schema tarefas.conversa_id + FK responsavel_atual

**Migration:** `20260419_tarefas_conversa_atribuicao.sql`

**Técnico:**
- `ALTER TABLE task_flow_tasks ADD COLUMN conversa_id UUID NULL REFERENCES conversas(id) ON DELETE SET NULL`
- `ALTER TABLE conversas` garantir FK `responsavel_atual` → `profiles(id)` (tipo já era UUID no remoto; faltava constraint)
- Índices parciais `idx_task_flow_tasks_conversa` e `idx_conversas_responsavel_atual`
- Função `fn_auto_atribuir_responsavel_na_conversa()` criada mas **não atachada** a trigger — reservada pra ativação manual

**Aplicação:** via Management API (supabase db push estava dessincronizado por legado Lovable).

---

### `159947f` — Atribuir responsável (UI)

**Arquivos:** `src/hooks/useEquipe.ts` (novo), `src/components/sdr-zap/ConversationCard.tsx`, `ConversationList.tsx`, `src/pages/SDRZap.tsx`

**Técnico:**
- Hook `useEquipe()` busca `profiles` × `user_roles` pra listar membros atribuíveis (exclui disparador)
- `ConversationCard` ganhou submenu "Atribuir para..." + badge colorido com nome do responsável
- `ConversationList` repassa props `onAssign`, `equipe`, `currentUserId`
- Pills extras "Todas / Minhas / Sem dono"
- Handler `handleAtribuirConversa` com optimistic update via `queryClient.setQueryData`

**Comparator do memo** atualizado pra reagir a mudanças de `responsavel_atual`.

---

### `39d5995` — Criar tarefa da conversa

**Arquivos:** `src/components/sdr-zap/CreateTaskFromConversaDialog.tsx` (novo), `src/hooks/useTasksDaConversa.ts` (novo), `src/pages/SDRZap.tsx`

**Técnico:**
- Modal completo: título (auto "Retorno: {contato}"), descrição, responsável (`task_flow_profiles` ativos), prazo
- Submit faz:
  1. Busca coluna "Caixa de Entrada"
  2. `INSERT task_flow_tasks` com `conversa_id` + `criado_por_id` + `origem='sdr-zap'`
  3. `INSERT task_flow_history` tipo 'criacao'
  4. Se responsável tem `user_id`: `INSERT notificacoes` (dispara sino do usuário)
- Botão "Tarefa" no header da Col3 + badge com contador de tasks vinculadas

---

### `46db1f2` — Monitor refatorado

**Arquivo:** `src/components/MonitorSecretarias.tsx`

**Motivação:** Monitor mostrava pendências de 90+ dias como urgências. Ordenação ASC (mais antigas primeiro) deixava lixo no topo.

**Técnico:**
- Cutoff 30 dias direto na query (`gte("ultima_interacao", cutoff.toISOString())`)
- State `view: 'hoje' | 'historico'` com toggle no header
- Select expandido: `tags`, `status_qualificacao`, `contacts.name`, `contacts.perfil_profissional`
- Cada pendência ganhou:
  - Preview da última mensagem (truncatePreview, 60 chars)
  - Badge roxo com `perfil_profissional`
  - Badge com `status_qualificacao` ou primeira tag (base pra IA classificar)
  - Responsável com bolinha colorida + nome
- Estado vazio por view ("Nenhuma pendência hoje — todos responderam ✓" vs "Nada pendente no período")

---

### `9d6be24` — Google Calendar OAuth

**Arquivos:**
- `supabase/migrations/20260419_google_calendar_oauth.sql`
- `supabase/functions/google-oauth-init/index.ts`
- `supabase/functions/google-oauth-callback/index.ts`
- `supabase/functions/google-calendar-sync/index.ts`
- `src/hooks/useGoogleAccounts.ts`
- `src/components/GoogleAccountsList.tsx`
- `src/pages/Perfil.tsx`

**Schema:**
- Nova tabela `google_accounts(user_id, email, refresh_token_encrypted BYTEA, access_token_encrypted, expires_at, scopes, ativo, last_sync_at, last_sync_error)` com UNIQUE(user_id, email)
- `eventos_agenda` ganhou `timezone`, `origem CHECK IN ('crm','google_sync')`, `google_account_id FK`
- Extension pgcrypto
- RPCs SECURITY DEFINER:
  - `get_active_google_accounts_decrypted(key)` — decripta pro sync
  - `upsert_google_account(...)` — encripta tokens
  - `update_google_account_tokens(...)` — atualiza após refresh
- RLS: user vê/deleta próprias contas; INSERT/UPDATE só service_role
- pg_cron `google_calendar_sync_job` a cada 10min

**OAuth flow:**
- `google-oauth-init` valida JWT do user, gera state HS256 assinado, retorna URL de consent
- `google-oauth-callback` recebe code, troca por tokens, lê email via userinfo, chama RPC upsert, redirect 302 com `?google_status=connected&email=X`
- `google-calendar-sync` chamado pelo cron: refresh se `expires_at < now()+5min`, `GET calendar/v3/calendars/primary/events` com `timeMin/timeMax/singleEvents/orderBy`, UPSERT/DELETE com `onConflict: google_account_id,google_event_id`

**Secrets configurados:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `APP_FRONTEND_URL`.

**Pendências de setup:** usuário precisa autorizar suas contas Google pela UI em `/perfil`.

---

### `e1c96a8` — Lembretes unificados + WA proativo

**Arquivos:**
- `supabase/migrations/20260419_lembretes_unificados_task.sql`
- `supabase/functions/enviar-lembretes-wa/index.ts`
- `src/pages/SDRZap.tsx`

**Schema:**
- `task_flow_tasks.tipo TEXT CHECK IN ('tarefa','lembrete') DEFAULT 'tarefa'`
- `task_flow_tasks.notificado_em TIMESTAMPTZ` pra evitar reenvio
- Índice parcial `idx_task_flow_lembretes_pendentes` (tipo='lembrete' AND notificado_em IS NULL AND deleted_at IS NULL)
- pg_cron `enviar_lembretes_wa_job` a cada 5min

**Edge function:**
- Busca lembretes com `prazo <= now() + 15min` e `prazo >= now() - 7 dias` (evita envio stale)
- JOIN: `task_flow_tasks` → `task_flow_profiles` → `profiles` → `instancias_whatsapp`
- Envia via Evolution API `/message/sendText/{instance}`
- Mensagem formatada com título + prazo + descrição + (se houver) contato vinculado
- Marca `notificado_em` após envio bem-sucedido
- Delay de 200ms entre envios

**Frontend:**
- `handleDefinirFollowUp` refatorado: em vez de `UPDATE conversas SET follow_up_em`, faz `INSERT task_flow_tasks` com `tipo='lembrete'`, `responsavel=user atual`, `conversa_id` vinculada, título auto "Retornar: {contato}"
- `handleRemoverFollowUp`: soft-delete das tasks lembrete + zera `follow_up_em` legado (backcompat)
- Modal renomeado "Criar lembrete pra você" com `DialogDescription` explicando o comportamento
- Campos `conversas.follow_up_em` e `conversas.follow_up_nota` ficam como legado (não deletados, só não escritos mais)

---

## Migrações aplicadas em produção

Ordem cronológica:

1. `20260419_tarefas_conversa_atribuicao.sql` — schema base pra atribuição
2. `20260419_google_calendar_oauth.sql` — google_accounts + cron sync
3. `20260419_lembretes_unificados_task.sql` — tipo='lembrete' + cron WA

Todas aplicadas via Management API (endpoint `/v1/projects/.../database/query`) porque a CLI `supabase db push` estava com tracking table dessincronizado desde o tempo Lovable.

---

## Edge functions deployadas em produção

| Função | Trigger | Função |
|---|---|---|
| `google-oauth-init` | Frontend (invoke) | Retorna URL de consent |
| `google-oauth-callback` | Redirect do Google | Troca code por tokens, persiste |
| `google-calendar-sync` | pg_cron 10min | Puxa eventos, UPSERT/DELETE |
| `enviar-lembretes-wa` | pg_cron 5min | Envia WA pros lembretes próximos |
| `sincronizar-nomes-contatos` | Botão UI | Agora tem 4 nomes contaminados no blocklist |

Deploy via `supabase functions deploy <nome> --project-ref yycpctrcefxemgahhxgx`.

---

## Secrets configurados

Via `supabase secrets set`:
- `GOOGLE_CLIENT_ID` — OAuth app do projeto Mykonnect no GCP
- `GOOGLE_CLIENT_SECRET` — segredo do OAuth app
- `GOOGLE_OAUTH_REDIRECT_URI` — https://yycpctrcefxemgahhxgx.supabase.co/functions/v1/google-oauth-callback
- `GOOGLE_TOKEN_ENCRYPTION_KEY` — 32 bytes random base64 pra pgcrypto
- `APP_FRONTEND_URL` — https://crm-gestao-madeira.lovable.app

Secrets preexistentes usados:
- `EVOLUTION_API_KEY`
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`

---

## pg_cron jobs ativos

| jobname | schedule | função |
|---|---|---|
| `google_calendar_sync_job` | `*/10 * * * *` | Chama google-calendar-sync |
| `enviar_lembretes_wa_job` | `*/5 * * * *` | Chama enviar-lembretes-wa |

Monitorar saúde: `SELECT jobid, runid, status, return_message FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10`.

---

## Problemas conhecidos / pendentes

1. **Google Calendar ativação:** usuário precisa autorizar suas 2 contas pela UI. Feito uma vez fica persistente (refresh token válido indefinidamente).
2. **Nomes contaminados:** 910 contatos sem nome aguardando nova interação WA pra capturar pushName correto. Sem ação manual necessária.
3. **SPA routing Lovable:** navegação direta via URL (ex: `/perfil`) dá 404. Navegar sempre pelo menu. Possível fix: adicionar `_redirects` ou `vercel.json` equivalente pro Lovable.
4. **Lovable redeploy:** nem sempre auto-detecta push. Usuário precisa acionar publish manual no painel Lovable pra deploy frontend.
5. **Filtro perfil nos Disparos (dor #3):** query não aplica, schema OK. 1 dia de trabalho pendente.

---

## Métricas de entrega

- **11 commits** dessa sessão
- **3 migrations SQL** aplicadas em produção
- **4 edge functions** novas deployadas (`google-oauth-init`, `google-oauth-callback`, `google-calendar-sync`, `enviar-lembretes-wa`)
- **1 edge function** atualizada (`sincronizar-nomes-contatos`)
- **~2100 linhas** adicionadas ao frontend (componentes + hooks)
- **~750 linhas** removidas do frontend (refactors de eliminação)
- **~800 linhas** de SQL em migrations
- **~1100 linhas** de código Deno em edge functions
- **3 docs novos** em `docs/`:
  - `RELATORIO_EVOLUCAO_CRM_MAIKONECT.md`
  - `PLANO_IA_ASSISTENTE_WHATSAPP.md`
  - `GUIA_TESTES_EQUIPE.md`
  - `CHANGELOG_SESSAO_19042026.md` (este arquivo)

---

*Este arquivo é um snapshot técnico. Pra documentação viva e evolutiva do projeto, ver `docs/DOCUMENTO_COMPLETO_CRM_MAIKONECT.md` e `docs/ROADMAP.md`.*
