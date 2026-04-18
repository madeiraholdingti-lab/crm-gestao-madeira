# Mapa de Integrações Externas

> Gerado em: 2026-03-22  
> Sem alterações no código — apenas documentação

---

## 1. URLs de Webhook Configuradas (`config_global`)

| Campo | URL | Destino |
|-------|-----|---------|
| `evolution_base_url` | `https://sdsd-evolution-api.r65ocn.easypanel.host` | Evolution API (EasyPanel) |
| `webhook_url` | `https://sdsd-n8n.r65ocn.easypanel.host/webhook/daa72dcb-...` | n8n — webhook geral (calendário, eventos) |
| `webhook_ia_disparos` | `https://sdsd-n8n.r65ocn.easypanel.host/webhook/f99da03f-...` | n8n — processamento IA de disparos em massa |
| `webhook_ia_respondendo` | `https://sdsd-n8n.r65ocn.easypanel.host/webhook/c1330519-...` | n8n — IA respondendo conversas (não usado atualmente no código) |

---

## 2. Edge Functions que RECEBEM Chamadas Externas

### 2.1 `evolution-messages-webhook` — Webhook principal da Evolution API

| Aspecto | Detalhe |
|---------|---------|
| **Chamado por** | Evolution API (configurado via `configurar-webhook-evolution`) |
| **Eventos aceitos** | `messages.upsert`, `messages.update`, `send.message`, `connection.update`, `qrcode.updated`, `contacts.set/update/upsert` |
| **Eventos ignorados** | `groups.*`, `presence.update`, `chats.*`, `labels.*` |
| **Payload esperado** | Evolution API webhook format: `{ event, instance, data: { key: { remoteJid, fromMe, id }, message, messageTimestamp, pushName } }` + metadados HTTP (`headers`, `params`, `query`) |
| **Tabelas tocadas** | `messages` (INSERT/UPSERT), `mensagens` (INSERT — dual-write), `conversas` (INSERT/UPDATE), `contacts` (INSERT/UPDATE) |
| **Lógica especial** | Faz fetch de foto de perfil na Evolution API; salva mídia base64 no storage `message-media` |

### 2.2 `n8n-inbound-webhook` — Webhook do n8n (mensagens)

| Aspecto | Detalhe |
|---------|---------|
| **Chamado por** | n8n (recebe mensagens roteadas pelo n8n) |
| **Payload esperado** | Evolution API format repassado pelo n8n: `{ event, instance, data: { key, message, ... } }` |
| **Tabelas tocadas** | `mensagens` (INSERT/UPDATE), `messages` (UPSERT), `conversas` (INSERT/UPDATE), `contacts` (INSERT/UPDATE) |
| **Lógica especial** | Correção de race condition com `evolution-messages-webhook`; handle de `wa_message_id` duplicado (código 23505); extração priorizada de texto; mídia base64 para storage |

### 2.3 `n8n-instance-events` — Webhook do n8n (eventos de instância)

| Aspecto | Detalhe |
|---------|---------|
| **Chamado por** | n8n (eventos não-mensagem roteados) |
| **Payload esperado** | `{ event, instance, instanceId, data: { qrcode?, ... } }` |
| **Tabelas tocadas** | `instance_events` (INSERT), `instancias_whatsapp` (UPDATE — status, QR code, connection_status) |
| **Eventos processados** | `qrcode.updated`, `connection.update`, `status.instance` |

### 2.4 `n8n-disparo-callback` — Callback de disparos do n8n

| Aspecto | Detalhe |
|---------|---------|
| **Chamado por** | n8n (após processar lote de disparos) |
| **Payload esperado** | `{ updates: [{ telefone, campanha_id, envio_id, status, erro?, wa_message_id? }] }` ou `{ success: true, envio_id }` (fim de lote) |
| **Tabelas tocadas** | `campanha_envios` (UPDATE status), `envios_disparo` (UPDATE contadores), `campanhas_disparo` (UPDATE contadores), `mensagens` (INSERT resposta), `conversas` (INSERT/UPDATE), `lead_campanha_historico` (INSERT) |
| **Lógica especial** | Auto-reenvio de leads com erro; controle de tentativas (max 3); disparo de novo lote após conclusão |

### 2.5 `evolution-webhook` — Webhook legado da Evolution API

| Aspecto | Detalhe |
|---------|---------|
| **Chamado por** | Evolution API (configuração anterior, pode estar ativo em paralelo) |
| **Payload esperado** | Evolution API format padrão |
| **Tabelas tocadas** | `mensagens` (INSERT), `conversas` (INSERT/UPDATE) |
| **Nota** | ⚠️ Webhook legado — `evolution-messages-webhook` é o substituto |

### 2.6 `calendar-webhook` — Webhook de calendário

| Aspecto | Detalhe |
|---------|---------|
| **Chamado por** | Frontend (quando usuário confirma evento de calendário) |
| **Payload esperado** | `{ tipo: "calendar", paciente, data_hora_inicio, data_hora_fim, descricao, titulo, medico_id }` |
| **Tabelas tocadas** | `config_global` (SELECT webhook_url) |
| **Ação** | Repassa payload para `webhook_url` do n8n (criação de evento no Google Calendar) |

### 2.7 `calendar-confirmed-callback` — Callback de confirmação do calendário

| Aspecto | Detalhe |
|---------|---------|
| **Chamado por** | n8n (após criar evento no Google Calendar) |
| **Payload esperado** | `{ conversa_id, status: "confirmed", event_id, titulo, data_hora_inicio, data_hora_fim, descricao?, link? }` |
| **Tabelas tocadas** | `eventos_agenda` (INSERT/UPDATE) |

### 2.8 `calendar-verify-callback` — Callback de verificação do calendário

| Aspecto | Detalhe |
|---------|---------|
| **Chamado por** | n8n (verificação de disponibilidade) |
| **Payload esperado** | `{ conversa_id, status, horarios_disponiveis? }` |
| **Tabelas tocadas** | Nenhuma diretamente (retorna dados ao frontend) |

### 2.9 `taskflow-webhook` — Webhook de tarefas

| Aspecto | Detalhe |
|---------|---------|
| **Chamado por** | n8n / API externa |
| **Payload esperado** | `{ titulo, descricao?, responsavel_id?, coluna?, prazo?, audio_url? }` ou mensagem de texto/áudio |
| **Tabelas tocadas** | `task_flow_tasks` (INSERT), `task_flow_columns` (SELECT), `task_flow_profiles` (SELECT), `task_flow_attachments` (INSERT — áudio) |
| **Lógica especial** | Resolve responsável por UUID ou nome; upload de áudio base64; envia confirmação para `webhook_ia_disparos` do n8n |

### 2.10 `taskflow-lembrar-maikon` — Endpoint GET de lembretes

| Aspecto | Detalhe |
|---------|---------|
| **Chamado por** | n8n / API externa (GET com `x-api-key`) |
| **Payload esperado** | Nenhum (GET) |
| **Tabelas tocadas** | `task_flow_tasks` (SELECT), `task_flow_columns` (SELECT), `task_flow_profiles` (SELECT) |
| **Retorno** | Lista de tarefas na coluna "Lembrar Dr. Maikon" do dia atual |

### 2.11 `buscar-script-ia` — Endpoint GET de scripts IA

| Aspecto | Detalhe |
|---------|---------|
| **Chamado por** | n8n (GET `?id=<uuid>`) |
| **Payload esperado** | Query param `id` |
| **Tabelas tocadas** | `ia_scripts` (SELECT), `ia_script_perguntas` (SELECT) |
| **Config** | `verify_jwt = false` para acesso externo |

---

## 3. Edge Functions que ENVIAM Requests para APIs Externas

### 3.1 Para Evolution API (`evolution_base_url`)

| Edge Function | Endpoint Evolution | Situação |
|---------------|-------------------|----------|
| `enviar-mensagem-evolution` | `POST /message/sendText/{instance}` | Envio de mensagem de texto pelo chat |
| `enviar-midia-evolution` | `POST /message/sendMedia/{instance}` | Envio de mídia (imagem, áudio, vídeo, documento) |
| `buscar-qrcode` | `GET /instance/connect/{instance}` | Obter QR code para conexão |
| `conectar-evolution` | `GET /instance/connect/{instance}` + `POST /instance/connect/{instance}` | Conectar instância (fallback GET→POST) |
| `criar-instancia-evolution` | `POST /instance/create` | Criar nova instância |
| `deletar-instancia-evolution` | `DELETE /instance/delete/{instance}` | Deletar instância |
| `desconectar-evolution` | `DELETE /instance/logout/{instance}` | Desconectar WhatsApp |
| `reiniciar-instancia-evolution` | `PUT /instance/restart/{instance}` + `GET /instance/connect/{instance}` | Reiniciar instância desconectada |
| `listar-instancias-evolution` | `GET /instance/fetchInstances` | Listar instâncias na API |
| `verificar-status-evolution` | `GET /instance/connectionState/{instance}` | Checar status de conexão |
| `testar-evolution` | `GET /instance/fetchInstances` | Testar conectividade com a API |
| `configurar-webhook-evolution` | `PUT /webhook/set/{instance}` | Configurar URL de webhook na instância |
| `buscar-webhooks-instancias` | `GET /webhook/find/{instance}` | Verificar webhook configurado |
| `message-actions-evolution` | `PUT /message/editText/{instance}` + `DELETE /message/deleteForEveryone/{instance}` + `POST /message/sendReaction/{instance}` + `POST /chat/markMessageAsRead/{instance}` | Ações em mensagens (editar, deletar, reagir, marcar lida) |
| `sincronizar-historico-mensagens` | `POST /chat/findMessages/{instance}` | Buscar histórico de mensagens |
| `sincronizar-contato-individual` | `GET /chat/fetchProfilePictureUrl/{instance}` + `POST /chat/findContacts/{instance}` | Buscar foto e nome de contato |
| `sincronizar-fotos-contatos` | `GET /chat/fetchProfilePictureUrl/{instance}` | Batch sync de fotos |
| `sincronizar-nomes-contatos` | `POST /chat/findContacts/{instance}` | Batch sync de nomes |
| `evolution-messages-webhook` | `GET /chat/fetchProfilePictureUrl/{instance}` | Busca foto ao receber mensagem de novo contato |
| `processar-disparos-agendados` | `POST /message/sendText/{instance}` | Envio direto para disparos agendados (scheduled_messages) |
| `processar-disparo-direto` | `POST /message/sendText/{instance}` | Envio direto de disparo individual |
| `notificar-delegacao` | `POST /message/sendText/{instance}` | Enviar WA ao Maikon sobre delegação de tarefa |
| `marcar-mensagens-lidas` | — | *(não faz fetch externo, só atualiza banco)* |

### 3.2 Para n8n (`webhook_ia_disparos` / `webhook_url`)

| Edge Function | Webhook usado | Situação |
|---------------|---------------|----------|
| `processar-envios-massa` | `webhook_ia_disparos` | Envia lote de leads para n8n processar disparos com IA |
| `calendar-webhook` | `webhook_url` | Repassa dados de agendamento para n8n criar evento no Google Calendar |
| `taskflow-webhook` | `webhook_ia_disparos` | Envia confirmação de tarefa criada para n8n |

### 3.3 Para Google / Gemini API

| Edge Function | URL | Situação |
|---------------|-----|----------|
| `gerar-variacao-mensagem` | `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent` | Gera variação de mensagem de campanha usando Gemini |

### 3.4 Para Lovable AI Gateway

| Edge Function | URL | Situação |
|---------------|-----|----------|
| `relatorio-imagem` | `https://ai.gateway.lovable.dev/v1/chat/completions` | Gera relatório visual com IA |

### 3.5 Para Supabase Edge Functions (self-calls)

| Edge Function | Chama | Situação |
|---------------|-------|----------|
| `processar-disparos-agendados` | `processar-envios-massa` | Cron dispara processamento de lotes pendentes |
| `processar-lote-diario` | `processar-envios-massa` | Cron diário 8h dispara lote do dia |

---

## 4. Diagrama de Fluxo de Integrações

```
┌─────────────────────────────────────────────────────────────┐
│                      EVOLUTION API                          │
│    https://sdsd-evolution-api.r65ocn.easypanel.host         │
└────────────┬───────────────────────────────┬────────────────┘
             │ webhooks                      ▲ API calls
             │                               │
             ▼                               │
┌────────────────────────┐     ┌─────────────────────────────┐
│  evolution-messages-   │     │ enviar-mensagem-evolution    │
│  webhook               │     │ enviar-midia-evolution       │
│  (messages.upsert,     │     │ buscar-qrcode               │
│   messages.update,     │     │ conectar/desconectar/criar   │
│   send.message)        │     │ message-actions-evolution    │
└────────┬───────────────┘     │ sincronizar-*                │
         │                     │ processar-disparos-agendados │
         │                     │ processar-disparo-direto     │
         ▼                     │ notificar-delegacao          │
┌────────────────────┐         └─────────────────────────────┘
│   BANCO DE DADOS   │                    ▲
│   (Supabase)       │◄───────────────────┘
│                    │
│ messages           │
│ mensagens          │
│ conversas          │
│ contacts           │
│ instancias_whatsapp│
│ campanha_envios    │
│ ...                │
└────────┬───────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                         n8n                                  │
│    https://sdsd-n8n.r65ocn.easypanel.host                   │
│                                                              │
│  webhook_url ──────────── calendar-webhook → n8n             │
│  webhook_ia_disparos ──── processar-envios-massa → n8n       │
│  webhook_ia_respondendo ─ (não usado no código atual)        │
│                                                              │
│  n8n → n8n-inbound-webhook (mensagens)                       │
│  n8n → n8n-instance-events (eventos de instância)            │
│  n8n → n8n-disparo-callback (resultado de disparos)          │
│  n8n → calendar-confirmed-callback (evento criado)           │
│  n8n → calendar-verify-callback (verificação agenda)         │
│  n8n → taskflow-webhook (criar tarefa)                       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    GOOGLE / IA                               │
│                                                              │
│  Gemini API ← gerar-variacao-mensagem                        │
│  Lovable AI ← relatorio-imagem                               │
│  Google Calendar ← (via n8n, não direto)                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Resumo Quantitativo

| Métrica | Valor |
|---------|-------|
| Webhooks configurados em `config_global` | 4 URLs |
| Edge functions que recebem chamadas externas | 11 |
| Edge functions que chamam Evolution API | 19 |
| Edge functions que chamam n8n | 3 |
| Edge functions que chamam Google/IA | 2 |
| Edge functions com self-calls | 2 |
| Total de edge functions com fetch externo | 31 de 48 |

---

## 6. Observações e Riscos

| Risco | Detalhe |
|-------|---------|
| ⚠️ **Webhook duplo** | `evolution-webhook` (legado) e `evolution-messages-webhook` podem estar ambos configurados na mesma instância, causando dual-write |
| ⚠️ **`webhook_ia_respondendo` não usado** | Campo existe em `config_global` com URL configurada, mas nenhuma edge function o utiliza |
| ⚠️ **Gemini API key** | `gerar-variacao-mensagem` usa `config.gemini_api_key` — não está nos secrets listados, provavelmente armazenada em outra tabela |
| ⚠️ **Self-calls sem circuit breaker** | `processar-disparos-agendados` chama `processar-envios-massa` a cada minuto sem verificar se já há processamento ativo |
| ⚠️ **Google Calendar indireto** | Toda integração com Google Calendar passa pelo n8n — não há acesso direto à API do Google |
