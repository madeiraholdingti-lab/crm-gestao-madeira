# Análise: Tabelas de Mensagens Duplicadas (`mensagens` vs `messages`)

> Gerado em: 2026-03-22  
> Status: ⚠️ Problema arquitetural ativo — duas tabelas coexistindo com ~99.7% de sobreposição de dados

---

## 1. Schema Comparativo

### Tabela `mensagens` (modelo legado/CRM)

| Coluna | Tipo | Nullable | Default | FK |
|--------|------|----------|---------|-----|
| `id` | uuid | No | gen_random_uuid() | PK |
| `conversa_id` | uuid | No | — | → `conversas.id` |
| `conteudo` | text | No | — | — |
| `remetente` | text | No | — | — (valores: 'usuario', 'contato', 'sistema') |
| `tipo_mensagem` | text | No | 'texto' | — |
| `lida` | boolean | No | false | — |
| `enviado_por` | uuid | Yes | — | → `auth.users.id` |
| `wa_message_id` | text | Yes | — | — (link com Evolution API) |
| `status` | text | Yes | 'PENDING' | — |
| `created_at` | timestamptz | No | now() | — |

**Características:**
- Vinculada a **conversas** (via `conversa_id`)
- Modelo simples, orientado ao CRM/chat
- Sem metadados de webhook/HTTP
- 10 colunas

### Tabela `messages` (modelo webhook/Evolution API)

| Coluna | Tipo | Nullable | Default | FK |
|--------|------|----------|---------|-----|
| `id` | uuid | No | gen_random_uuid() | PK |
| `contact_id` | uuid | No | — | → `contacts.id` |
| `instance` | text | No | — | — (nome da instância) |
| `instance_uuid` | text | No | — | — (UUID Evolution) |
| `instancia_whatsapp_id` | uuid | Yes | — | → `instancias_whatsapp.id` |
| `wa_message_id` | text | No | — | — (UNIQUE constraint) |
| `text` | text | Yes | — | — |
| `from_me` | boolean | No | false | — |
| `status` | text | Yes | — | — |
| `message_type` | text | Yes | — | — |
| `media_url` | text | Yes | — | — |
| `media_mime_type` | text | Yes | — | — |
| `sender_jid` | text | Yes | — | — |
| `sender_lid` | text | Yes | — | — |
| `destination` | text | Yes | — | — |
| `source` | text | Yes | — | — |
| `tipo_jid` | text | Yes | — | — |
| `wa_timestamp` | bigint | Yes | — | — |
| `is_edited` | boolean | Yes | false | — |
| `message_context_info` | jsonb | Yes | — | — |
| `raw_payload` | jsonb | Yes | — | — |
| `event` | text | Yes | — | — |
| `webhook_received_at` | timestamptz | Yes | — | — |
| `http_headers` | jsonb | Yes | — | — |
| `http_client_ip` | text | Yes | — | — |
| `http_user_agent` | text | Yes | — | — |
| `http_meta` | jsonb | Yes | — | — |
| `http_params` | jsonb | Yes | — | — |
| `http_query` | jsonb | Yes | — | — |
| `server_url` | text | Yes | — | — |
| `apikey_hash` | text | Yes | — | — |
| `created_at` | timestamptz | No | now() | — |

**Características:**
- Vinculada a **contacts** (via `contact_id`) — não a conversas
- Modelo rico com metadados completos do webhook
- Suporta mídia, edição, contexto de resposta
- 31 colunas

---

## 2. Uso no Frontend

### Componentes que usam `mensagens`

| Arquivo | Operação | Contexto |
|---------|----------|----------|
| `SDRZap.tsx` | SELECT | Busca `status` e `remetente` das últimas mensagens por conversa |
| `KanbanBoard.tsx` | SELECT + Realtime | Carrega mensagens do chat inline + listener INSERT |
| `Relatorios.tsx` | SELECT | Contagem de mensagens por período para relatório CRM |

### Componentes que usam `messages`

| Arquivo | Operação | Contexto |
|---------|----------|----------|
| `SDRZap.tsx` | SELECT + Realtime | **Principal**: carrega histórico completo do chat, listeners INSERT/DELETE |
| `DetalheConversa.tsx` | SELECT + Realtime | Carrega mensagens do detalhe de conversa |
| `Contatos.tsx` | SELECT | Carrega mensagens de um contato |
| `MessageActions.tsx` | DELETE | Deleta mensagem localmente |
| `Relatorios.tsx` | SELECT | Contagem alternativa de mensagens (usa `from_me` em vez de `remetente`) |

### Resumo Frontend

| Métrica | `mensagens` | `messages` |
|---------|-------------|------------|
| Arquivos que usam | 3 | 5 |
| Tabela principal do chat | ❌ Secundária | ✅ **Principal** |
| Realtime listeners | 1 (KanbanBoard) | 3 (SDRZap ×2, DetalheConversa) |
| Operações de escrita | 0 | 1 (DELETE) |

---

## 3. Uso nas Edge Functions

### Edge Functions que usam `mensagens`

| Edge Function | Operação | Contexto |
|---------------|----------|----------|
| `enviar-mensagem-evolution` | INSERT | Persiste mensagem enviada no modelo CRM |
| `enviar-midia-evolution` | INSERT | Persiste mídia enviada no modelo CRM |
| `evolution-webhook` | SELECT + INSERT | Webhook legado: cria mensagem + atualiza conversa |
| `evolution-messages-webhook` | INSERT | **Dual-write**: salva também em `mensagens` |
| `n8n-inbound-webhook` | SELECT + INSERT + UPDATE | Webhook n8n: persiste e corrige mensagens |
| `n8n-disparo-callback` | INSERT | Persiste mensagem de resposta de disparo |
| `marcar-mensagens-lidas` | UPDATE | Marca mensagens como lidas |
| `message-actions-evolution` | SELECT | Busca mensagem por `wa_message_id` |
| `gerar-relatorio-crm` | SELECT | Contagem para relatório |

### Edge Functions que usam `messages`

| Edge Function | Operação | Contexto |
|---------------|----------|----------|
| `evolution-messages-webhook` | SELECT + UPSERT | **Principal webhook**: persiste todas as mensagens |
| `n8n-inbound-webhook` | UPSERT | Correção de duplicatas e persistência |
| `message-actions-evolution` | UPDATE | Atualiza `is_edited` |
| `sincronizar-historico-mensagens` | SELECT + INSERT | Sync de histórico da Evolution API |
| `relatorio-imagem` | SELECT | Contagem para relatório visual |

### Resumo Edge Functions

| Métrica | `mensagens` | `messages` |
|---------|-------------|------------|
| Edge functions que usam | 9 | 5 |
| Webhooks de entrada | 3 (evolution-webhook, evolution-messages-webhook, n8n-inbound-webhook) | 2 (evolution-messages-webhook, n8n-inbound-webhook) |
| INSERTs em webhooks | ~17 pontos de inserção | ~5 pontos de inserção |

---

## 4. Volume de Dados

| Tabela | Total de registros |
|--------|-------------------|
| `mensagens` | **51.077** |
| `messages` | **50.970** |

| Sobreposição | Contagem |
|--------------|----------|
| Registros com mesmo `wa_message_id` em ambas | **50.900** (~99.7%) |
| Apenas em `mensagens` (sem match) | **177** |
| Apenas em `messages` (sem match) | **70** |

> ⚠️ **99.7% de duplicação de dados** — quase toda mensagem existe nas duas tabelas.

---

## 5. Qual é a tabela "correta" para o futuro?

### Recomendação: **`messages`** ✅

| Critério | `mensagens` | `messages` | Vencedor |
|----------|-------------|------------|----------|
| Schema rico (mídia, edit, contexto) | ❌ | ✅ | `messages` |
| Vinculação por contato (multi-instância) | ❌ (conversa) | ✅ (contact) | `messages` |
| Suporte a transferência de conversas | ❌ | ✅ | `messages` |
| Metadados de webhook (debug) | ❌ | ✅ | `messages` |
| `wa_message_id` como NOT NULL | ❌ (nullable) | ✅ (required) | `messages` |
| Índice UNIQUE em `wa_message_id` | ❌ | ✅ | `messages` |
| Frontend principal (SDRZap chat) | ❌ | ✅ | `messages` |
| Realtime listeners ativos | 1 | 3 | `messages` |
| Suporta `is_edited` | ❌ | ✅ | `messages` |
| Suporta `message_context_info` (replies) | ❌ | ✅ | `messages` |

### Razões para manter `mensagens` temporariamente:

1. **`evolution-webhook`** (webhook legado) ainda escreve exclusivamente em `mensagens`
2. **`KanbanBoard.tsx`** usa realtime em `mensagens` para o chat inline do Kanban
3. **`enviar-mensagem-evolution`** e **`enviar-midia-evolution`** persistem em `mensagens`
4. **Relatórios** (`gerar-relatorio-crm`) consultam `mensagens`

---

## 6. Análise de Dados Duplicados

| Aspecto | Detalhe |
|---------|---------|
| **Overlap** | 50.900 de ~51.000 registros são duplicados (mesmo `wa_message_id`) |
| **Apenas em `mensagens`** | 177 registros — provavelmente mensagens de sistema ou sem `wa_message_id` |
| **Apenas em `messages`** | 70 registros — provavelmente do sync de histórico que só escreve em `messages` |
| **Dual-write ativo** | `evolution-messages-webhook` escreve em **ambas** as tabelas simultaneamente |
| **Desperdício estimado** | ~50.900 registros duplicados × ~0.5KB = ~25MB de storage desperdiçado |

---

## 7. Mapa de Fluxo de Dados

```
                    ┌─────────────────────┐
                    │   Evolution API     │
                    └────────┬────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
     evolution-webhook   evolution-     n8n-inbound-
     (legado)            messages-       webhook
              │          webhook          │
              │              │            │
              ▼              ▼            ▼
         ┌─────────┐   ┌─────────┐  ┌─────────┐
         │mensagens│◄──│DUAL     │──►│messages │
         │         │   │WRITE    │   │         │
         └─────────┘   └─────────┘   └─────────┘
              ▲                           ▲
              │                           │
     enviar-mensagem-evo          sincronizar-historico
     enviar-midia-evo             message-actions-evo
     n8n-disparo-callback
              │                           │
              ▼                           ▼
     ┌──────────────┐           ┌──────────────────┐
     │ KanbanBoard  │           │ SDRZap (chat)    │
     │ Relatorios   │           │ DetalheConversa  │
     │              │           │ Contatos         │
     │              │           │ MessageActions   │
     └──────────────┘           └──────────────────┘
```

---

## 8. Plano de Migração Sugerido (futuro)

### Fase 1 — Parar dual-write
- Atualizar `evolution-messages-webhook` para escrever **apenas** em `messages`
- Atualizar `evolution-webhook` para escrever em `messages` em vez de `mensagens`

### Fase 2 — Migrar edge functions restantes
- `enviar-mensagem-evolution` → escrever em `messages`
- `enviar-midia-evolution` → escrever em `messages`
- `n8n-disparo-callback` → escrever em `messages`
- `n8n-inbound-webhook` → remover writes em `mensagens`
- `marcar-mensagens-lidas` → operar em `messages`

### Fase 3 — Migrar frontend
- `KanbanBoard.tsx` → usar `messages` + realtime em `messages`
- `Relatorios.tsx` → consolidar queries para usar apenas `messages`
- `SDRZap.tsx` → remover a query de `mensagens` (já usa `messages` como principal)

### Fase 4 — Deprecar tabela
- Manter `mensagens` como read-only por 30 dias
- Após validação, criar migration para drop

### Riscos
- **177 registros** em `mensagens` sem correspondente em `messages` precisam ser migrados
- `KanbanBoard.tsx` usa `conversa_id` para filtrar — `messages` usa `contact_id`, exige adaptar a lógica
- Relatórios históricos que usam `remetente = 'contato'` precisam ser adaptados para `from_me = false`
