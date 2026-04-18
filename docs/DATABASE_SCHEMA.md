# Mapeamento Completo do Banco de Dados — Maikonect CRM

> Gerado em: 2026-03-22  
> Schema: `public` | 39 tabelas | RLS ativo em todas  
> Enum: `app_role` → `admin_geral`, `medico`, `secretaria_medica`, `administrativo`, `disparador`

---

## 1. Conversas e Mensagens

### 1.1 `conversas`

Conversas do WhatsApp com status, qualificação e responsável.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| numero_contato | text | NO | — |
| nome_contato | text | YES | — |
| status | text | NO | `'novo'` |
| status_qualificacao | text | YES | `'Aguardando Triagem'` |
| ultima_mensagem | text | YES | — |
| ultima_interacao | timestamptz | YES | `now()` |
| unread_count | integer | YES | `0` |
| fixada | boolean | NO | `false` |
| foto_contato | text | YES | — |
| tags | text[] | YES | `'{}'` |
| anotacao_transferencia | text | YES | — |
| responsavel_atual | uuid | YES | — |
| instancia_id | uuid | YES | — |
| orig_instance_id | uuid | YES | — |
| current_instance_id | uuid | YES | — |
| contact_id | uuid | YES | — |
| numero_whatsapp_id | uuid | YES | — |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |

**Foreign Keys:**
| Coluna | → Tabela.Coluna |
|--------|-----------------|
| contact_id | contacts.id |
| current_instance_id | instancias_whatsapp.id |
| instancia_id | instancias_whatsapp.id |
| numero_whatsapp_id | numeros_whatsapp.id |
| orig_instance_id | instancias_whatsapp.id |
| responsavel_atual | auth.users.id |

**Índices:**
- `conversas_pkey` — UNIQUE (id)
- `idx_conversas_contact_id` — (contact_id)
- `idx_conversas_current_instance` — (current_instance_id)
- `idx_conversas_numero_whatsapp` — (numero_whatsapp_id)
- `idx_conversas_orig_instance` — (orig_instance_id)
- `idx_conversas_responsavel` — (responsavel_atual)
- `idx_conversas_status` — (status)
- `idx_conversas_status_qualificacao` — (status_qualificacao)
- `idx_conversas_tags` — GIN (tags)

**RLS Policies:**
| Policy | Comando | Condição |
|--------|---------|----------|
| Usuários podem ver apenas suas conversas atribuídas ou não a | SELECT | `responsavel_atual = auth.uid() OR responsavel_atual IS NULL OR has_role(uid, 'admin_geral')` |
| Usuários autenticados podem criar conversas | INSERT | `auth.uid() IS NOT NULL` |
| Usuários autenticados podem atualizar conversas | UPDATE | `auth.uid() IS NOT NULL` |
| Apenas admins podem deletar conversas | DELETE | `has_role(uid, 'admin_geral')` |

---

### 1.2 `mensagens`

Mensagens do sistema legado (SDR Zap interno).

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| conversa_id | uuid | NO | — |
| remetente | text | NO | — |
| conteudo | text | NO | — |
| tipo_mensagem | text | NO | `'texto'` |
| status | text | YES | `'PENDING'` |
| wa_message_id | text | YES | — |
| enviado_por | uuid | YES | — |
| lida | boolean | NO | `false` |
| created_at | timestamptz | NO | `now()` |

**Foreign Keys:**
| Coluna | → Tabela.Coluna |
|--------|-----------------|
| conversa_id | conversas.id |
| enviado_por | auth.users.id |

**Índices:**
- `mensagens_pkey` — UNIQUE (id)
- `idx_mensagens_conversa` — (conversa_id)
- `idx_mensagens_conversa_lida` — (conversa_id, lida)
- `idx_mensagens_created` — (created_at DESC)
- `idx_mensagens_status` — (status)
- `idx_mensagens_wa_message_id` — UNIQUE (wa_message_id) WHERE wa_message_id IS NOT NULL

**RLS Policies:**
| Policy | Comando | Condição |
|--------|---------|----------|
| Usuários podem ver mensagens apenas de suas conversas | SELECT | Subquery em conversas (responsavel_atual = uid OR admin) |
| Usuários podem criar mensagens apenas em suas conversas | INSERT | Subquery em conversas |
| Usuários podem atualizar apenas suas próprias mensagens | UPDATE | `enviado_por = uid OR admin` |
| Mensagens não podem ser deletadas | DELETE | `false` |

---

### 1.3 `messages`

Mensagens brutas do webhook Evolution API (tabela de ingestão).

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| wa_message_id | text | NO | — |
| contact_id | uuid | NO | — |
| instance | text | NO | — |
| instance_uuid | text | NO | — |
| instancia_whatsapp_id | uuid | YES | — |
| from_me | boolean | NO | `false` |
| text | text | YES | — |
| status | text | YES | — |
| message_type | text | YES | — |
| media_url | text | YES | — |
| media_mime_type | text | YES | — |
| is_edited | boolean | YES | `false` |
| event | text | YES | — |
| destination | text | YES | — |
| sender_jid | text | YES | — |
| sender_lid | text | YES | — |
| source | text | YES | — |
| server_url | text | YES | — |
| apikey_hash | text | YES | — |
| tipo_jid | text | YES | — |
| wa_timestamp | bigint | YES | — |
| message_context_info | jsonb | YES | — |
| raw_payload | jsonb | YES | — |
| http_headers | jsonb | YES | — |
| http_params | jsonb | YES | — |
| http_query | jsonb | YES | — |
| http_meta | jsonb | YES | — |
| http_client_ip | text | YES | — |
| http_user_agent | text | YES | — |
| webhook_received_at | timestamptz | YES | — |
| created_at | timestamptz | NO | `now()` |

**Foreign Keys:**
| Coluna | → Tabela.Coluna |
|--------|-----------------|
| contact_id | contacts.id |
| instancia_whatsapp_id | instancias_whatsapp.id |

**Índices:**
- `messages_pkey` — UNIQUE (id)
- `messages_wa_message_id_key` — UNIQUE (wa_message_id)
- `idx_messages_contact_id` — (contact_id)
- `idx_messages_instance` — (instance)
- `idx_messages_instancia_whatsapp_id` — (instancia_whatsapp_id)
- `idx_messages_wa_timestamp` — (wa_timestamp DESC)
- `idx_messages_event` — (event)
- `idx_messages_destination` — (destination)
- `idx_messages_http_client_ip` — (http_client_ip)

**RLS Policies:**
| Policy | Comando | Condição |
|--------|---------|----------|
| Usuários autenticados podem ver mensagens | SELECT | `auth.uid() IS NOT NULL` |
| Usuários autenticados podem inserir mensagens | INSERT | `auth.uid() IS NOT NULL` |
| Usuários autenticados podem atualizar mensagens | UPDATE | `auth.uid() IS NOT NULL` |
| ❌ DELETE não permitido | — | — |

---

### 1.4 `message_reactions`

Reações (emoji) em mensagens.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| message_wa_id | text | NO | — |
| emoji | text | NO | — |
| contact_id | uuid | YES | — |
| from_me | boolean | NO | `false` |
| reacted_at | timestamptz | NO | `now()` |
| created_at | timestamptz | NO | `now()` |

**Foreign Keys:** contact_id → contacts.id

**Índices:**
- `message_reactions_pkey` — UNIQUE (id)
- `idx_message_reactions_wa_id` — (message_wa_id)

**RLS:** CRUD completo para autenticados.

---

## 2. Contatos

### 2.1 `contacts`

Contatos sincronizados do WhatsApp.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| jid | text | NO | — (UNIQUE) |
| phone | text | NO | — |
| name | text | YES | — |
| tipo_contato | text | YES | `'Outros'` |
| tipo_jid | text | YES | — |
| observacoes | text | YES | — |
| profile_picture_url | text | YES | — |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |

**Foreign Keys:** Nenhuma no schema public.

**Índices:**
- `contacts_pkey` — UNIQUE (id)
- `contacts_jid_key` — UNIQUE (jid)
- `idx_contacts_phone` — (phone)

**RLS Policies:**
| Policy | Comando | Condição |
|--------|---------|----------|
| Ver/Inserir/Atualizar | SELECT/INSERT/UPDATE | `auth.uid() IS NOT NULL` |
| ❌ DELETE não permitido | — | — |

---

### 2.2 `contact_attachments`

Anexos associados a contatos.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| contact_id | uuid | NO | — |
| file_name | text | NO | — |
| file_url | text | NO | — |
| file_type | text | YES | — |
| file_size | bigint | YES | — |
| uploaded_by | uuid | YES | — |
| created_at | timestamptz | YES | `now()` |

**Foreign Keys:** contact_id → contacts.id, uploaded_by → auth.users.id

**Índices:**
- `contact_attachments_pkey` — UNIQUE (id)
- `idx_contact_attachments_contact_id` — (contact_id)

**RLS:** SELECT/INSERT/DELETE para autenticados. ❌ UPDATE não permitido.

---

### 2.3 `leads`

Base de leads para disparos em massa.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| telefone | text | NO | — (UNIQUE) |
| nome | text | YES | — |
| email | text | YES | — |
| especialidade | text | YES | — |
| especialidade_id | uuid | YES | — |
| tipo_lead | text | YES | `'novo'` |
| origem | text | YES | — |
| tags | text[] | YES | `'{}'` |
| anotacoes | text | YES | — |
| dados_extras | jsonb | YES | `'{}'` |
| ativo | boolean | YES | `true` |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |

**Foreign Keys:** especialidade_id → especialidades.id

**Índices:**
- `leads_pkey` — UNIQUE (id)
- `leads_telefone_unique` — UNIQUE (telefone)
- `idx_leads_telefone` — (telefone)
- `idx_leads_tipo_lead` — (tipo_lead)
- `idx_leads_especialidade_id` — (especialidade_id)
- `idx_leads_tipo_especialidade` — (tipo_lead, especialidade_id)
- `idx_leads_ativo` — (ativo)

**RLS:** SELECT/INSERT/UPDATE para autenticados. DELETE apenas admin.

---

### 2.4 `lead_especialidades_secundarias`

Junction table: especialidades secundárias de um lead.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| lead_id | uuid | NO | — |
| especialidade_id | uuid | NO | — |
| created_at | timestamptz | NO | `now()` |

**Foreign Keys:** lead_id → leads.id, especialidade_id → especialidades.id

**Índices:**
- `lead_especialidades_secundarias_pkey` — UNIQUE (id)
- `lead_especialidades_secundarias_lead_id_especialidade_id_key` — UNIQUE (lead_id, especialidade_id)
- `idx_lead_esp_sec_lead_id` — (lead_id)
- `idx_lead_esp_sec_esp_id` — (especialidade_id)

**RLS:** CRUD completo para autenticados.

---

### 2.5 `lead_blacklist`

Leads bloqueados para disparos.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| lead_id | uuid | NO | — (UNIQUE) |
| motivo | text | YES | — |
| adicionado_por | uuid | YES | — |
| created_at | timestamptz | NO | `now()` |

**Foreign Keys:** lead_id → leads.id, adicionado_por → auth.users.id

**Índices:**
- `lead_blacklist_pkey` — UNIQUE (id)
- `lead_blacklist_lead_id_key` — UNIQUE (lead_id)
- `idx_lead_blacklist_lead_id` — (lead_id)

**RLS:** SELECT/INSERT para autenticados. DELETE apenas admin. ❌ UPDATE não permitido.

---

### 2.6 `lead_comments`

Comentários em leads.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| lead_id | uuid | NO | — |
| autor_id | uuid | YES | — |
| texto | text | NO | — |
| created_at | timestamptz | NO | `now()` |

**Foreign Keys:** lead_id → leads.id, autor_id → profiles.id

**Índices:** `lead_comments_pkey` — UNIQUE (id)

**RLS:** SELECT/INSERT para authenticated. DELETE apenas próprio (autor_id = uid). ❌ UPDATE não permitido.

---

### 2.7 `lead_comment_attachments`

Anexos de comentários de leads.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| comment_id | uuid | NO | — |
| file_name | text | NO | — |
| file_url | text | NO | — |
| file_type | text | YES | — |
| file_size | integer | YES | — |
| created_at | timestamptz | NO | `now()` |

**Foreign Keys:** comment_id → lead_comments.id

**Índices:** `lead_comment_attachments_pkey` — UNIQUE (id)

**RLS:** SELECT/INSERT para authenticated. DELETE apenas se o comentário é do próprio usuário. ❌ UPDATE não permitido.

---

### 2.8 `especialidades`

Catálogo de especialidades médicas.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| nome | text | NO | — (UNIQUE) |
| created_by | uuid | YES | — |
| created_at | timestamptz | NO | `now()` |

**Foreign Keys:** created_by → auth.users.id

**Índices:**
- `especialidades_pkey` — UNIQUE (id)
- `especialidades_nome_key` — UNIQUE (nome)

**RLS:** SELECT/INSERT para autenticados. ❌ UPDATE/DELETE não permitidos.

---

### 2.9 `tipos_lead`

Tipos de lead cadastráveis (ex: novo, quente, frio).

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| nome | text | NO | — (UNIQUE) |
| cor | text | NO | `'#6366F1'` |
| created_by | uuid | YES | — |
| created_at | timestamptz | NO | `now()` |

**Foreign Keys:** created_by → auth.users.id

**Índices:**
- `tipos_lead_pkey` — UNIQUE (id)
- `tipos_lead_nome_key` — UNIQUE (nome)

**RLS:** SELECT/INSERT para autenticados. ❌ UPDATE/DELETE não permitidos.

---

## 3. WhatsApp

### 3.1 `instancias_whatsapp`

Instâncias da Evolution API.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| instancia_id | text | NO | — (UNIQUE) |
| nome_instancia | text | NO | — |
| status | text | NO | `'ativa'` |
| connection_status | text | YES | `'disconnected'` |
| ativo | boolean | NO | `true` |
| cor_identificacao | text | YES | `'#3B82F6'` |
| tipo_canal | text | YES | `'whatsapp'` |
| numero_chip | text | YES | — |
| token_instancia | text | YES | — |
| token_zapi | text | YES | — |
| qrcode_base64 | text | YES | — |
| qrcode_updated_at | timestamptz | YES | — |
| criado_por | uuid | YES | — |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |

**Foreign Keys:** criado_por → auth.users.id

**Índices:**
- `instancias_whatsapp_pkey` — UNIQUE (id)
- `unique_instancia_id` — UNIQUE (instancia_id)
- `idx_instancias_whatsapp_status` — (status)
- `idx_instancias_status` — (status) WHERE ativo = true

**RLS Policies:**
| Policy | Comando | Condição |
|--------|---------|----------|
| Usuários autenticados podem ver instâncias | SELECT | `auth.uid() IS NOT NULL` |
| Admins, médicos e secretarias podem gerenciar | ALL | `admin_geral OR medico OR secretaria_medica` |

---

### 3.2 `numeros_whatsapp`

Números de telefone WhatsApp e seu mapeamento para instâncias.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| numero | text | NO | — (UNIQUE) |
| jid | text | YES | — |
| nome_display | text | YES | — |
| instancia_atual_id | uuid | YES | — |
| ativo | boolean | NO | `true` |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |

**Foreign Keys:** instancia_atual_id → instancias_whatsapp.id

**Índices:**
- `numeros_whatsapp_pkey` — UNIQUE (id)
- `numeros_whatsapp_numero_key` — UNIQUE (numero)
- `idx_numeros_whatsapp_numero` — (numero)
- `idx_numeros_whatsapp_instancia_atual` — (instancia_atual_id)
- `idx_numeros_whatsapp_ativo` — (ativo)

**RLS:** SELECT para autenticados. INSERT/UPDATE apenas admin.

---

### 3.3 `historico_numero_instancia`

Histórico de vinculação número ↔ instância.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| numero_whatsapp_id | uuid | NO | — |
| instancia_id | uuid | NO | — |
| vinculado_em | timestamptz | NO | `now()` |
| desvinculado_em | timestamptz | YES | — |
| motivo | text | YES | — |
| created_at | timestamptz | NO | `now()` |

**Foreign Keys:** numero_whatsapp_id → numeros_whatsapp.id, instancia_id → instancias_whatsapp.id

**Índices:**
- `historico_numero_instancia_pkey` — UNIQUE (id)
- `idx_historico_numero_instancia_numero` — (numero_whatsapp_id)
- `idx_historico_numero_instancia_instancia` — (instancia_id)

**RLS:** SELECT para autenticados. INSERT apenas admin. ❌ UPDATE/DELETE não permitidos.

---

### 3.4 `config_global`

Configurações globais (Evolution API URL, webhooks).

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| evolution_base_url | text | NO | `'https://honourless-reusable-mercedez.ngrok-free.dev'` |
| evolution_api_key | text | YES | — |
| webhook_url | text | YES | — |
| webhook_ia_disparos | text | YES | — |
| webhook_ia_respondendo | text | YES | — |
| webhook_base64_enabled | boolean | YES | `false` |
| ignorar_mensagens_internas | boolean | YES | `true` |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |

**Índices:** `config_global_pkey` — UNIQUE (id)

**RLS:** SELECT público (`true`). INSERT/UPDATE apenas admin. ❌ DELETE não permitido.

---

### 3.5 `instance_events`

Eventos de instâncias (conexão, desconexão, etc.).

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| instance_name | text | NO | — |
| instance_uuid | text | YES | — |
| event | text | NO | — |
| payload | jsonb | YES | — |
| created_at | timestamptz | NO | `now()` |

**Índices:**
- `instance_events_pkey` — UNIQUE (id)
- `idx_instance_events_instance_name` — (instance_name)
- `idx_instance_events_event` — (event)
- `idx_instance_events_created_at` — (created_at DESC)

**RLS:** SELECT para autenticados. INSERT público (`true`). ❌ UPDATE/DELETE não permitidos.

---

## 4. Disparos

### 4.1 `campanhas_disparo`

Campanhas de disparo em massa.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| nome | text | NO | — |
| descricao | text | YES | — |
| mensagem | text | NO | — |
| tipo | text | YES | `'prospecção'` |
| status | text | YES | `'rascunho'` |
| filtro_tipo_lead | text[] | YES | — |
| script_ia_id | uuid | YES | — |
| instancia_id | uuid | YES | — |
| total_leads | integer | YES | `0` |
| enviados | integer | YES | `0` |
| sucesso | integer | YES | `0` |
| falhas | integer | YES | `0` |
| envios_por_dia | integer | YES | `70` |
| intervalo_min_minutos | integer | YES | `10` |
| intervalo_max_minutos | integer | YES | `15` |
| horario_inicio | time | YES | `'08:00'` |
| horario_fim | time | YES | `'18:00'` |
| dias_semana | integer[] | YES | `'{1,2,3,4,5}'` |
| agendado_para | timestamptz | YES | — |
| iniciado_em | timestamptz | YES | — |
| concluido_em | timestamptz | YES | — |
| proximo_envio_em | timestamptz | YES | — |
| created_by | uuid | YES | — |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |

**Foreign Keys:** instancia_id → instancias_whatsapp.id, script_ia_id → ia_scripts.id

**Índices:**
- `campanhas_disparo_pkey` — UNIQUE (id)
- `idx_campanhas_status` — (status)

**RLS:** SELECT/INSERT/UPDATE para autenticados. DELETE apenas admin.

---

### 4.2 `envios_disparo`

Lotes de envio dentro de uma campanha.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| campanha_id | uuid | NO | — |
| instancia_id | uuid | YES | — |
| status | text | YES | `'pendente'` |
| ativo | boolean | NO | `true` |
| total_leads | integer | YES | `0` |
| enviados | integer | YES | `0` |
| sucesso | integer | YES | `0` |
| falhas | integer | YES | `0` |
| envios_por_dia | integer | YES | `70` |
| intervalo_min_minutos | integer | YES | `10` |
| intervalo_max_minutos | integer | YES | `15` |
| horario_inicio | time | YES | `'08:00'` |
| horario_fim | time | YES | `'18:00'` |
| dias_semana | integer[] | YES | `'{1,2,3,4,5}'` |
| filtro_tipo_lead | text[] | YES | — |
| agendado_para | timestamptz | YES | — |
| iniciado_em | timestamptz | YES | — |
| concluido_em | timestamptz | YES | — |
| proximo_envio_em | timestamptz | YES | — |
| created_by | uuid | YES | — |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |

**Foreign Keys:** campanha_id → campanhas_disparo.id, instancia_id → instancias_whatsapp.id

**Índices:**
- `envios_disparo_pkey` — UNIQUE (id)
- `idx_envios_disparo_campanha` — (campanha_id)
- `idx_envios_disparo_status` — (status)

**RLS:** SELECT/INSERT/UPDATE para autenticados. DELETE apenas admin.

---

### 4.3 `campanha_envios`

Envios individuais (lead ↔ campanha).

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| campanha_id | uuid | NO | — |
| lead_id | uuid | NO | — |
| envio_id | uuid | YES | — |
| telefone | text | NO | — |
| status | text | YES | `'pendente'` |
| erro | text | YES | — |
| wa_message_id | text | YES | — |
| tentativas | integer | YES | `0` |
| enviado_em | timestamptz | YES | — |
| created_at | timestamptz | NO | `now()` |

**Foreign Keys:** campanha_id → campanhas_disparo.id, lead_id → leads.id, envio_id → envios_disparo.id

**Índices:**
- `campanha_envios_pkey` — UNIQUE (id)
- `unique_lead_per_campanha` — UNIQUE (lead_id, campanha_id)
- `idx_campanha_envios_campanha` — (campanha_id)
- `idx_campanha_envios_envio` — (envio_id)
- `idx_campanha_envios_status` — (status)

**RLS Policies:**
| Policy | Comando | Condição |
|--------|---------|----------|
| Usuários autenticados podem ver envios | SELECT | `auth.uid() IS NOT NULL` |
| Sistema pode inserir envios | INSERT | `true` |
| Sistema pode atualizar envios | UPDATE | `true` |
| Usuários podem deletar envios não enviados | DELETE | `auth.uid() IS NOT NULL AND status IN ('enviar','reenviar','pendente')` |

---

### 4.4 `lead_campanha_historico`

Histórico de leads enviados por campanha.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| lead_id | uuid | NO | — |
| campanha_id | uuid | NO | — |
| status | text | YES | `'pendente'` |
| enviado_em | timestamptz | YES | — |
| created_at | timestamptz | NO | `now()` |

**Foreign Keys:** lead_id → leads.id, campanha_id → campanhas_disparo.id

**Índices:**
- `lead_campanha_historico_pkey` — UNIQUE (id)
- `lead_campanha_historico_lead_id_campanha_id_key` — UNIQUE (lead_id, campanha_id)

**RLS:** SELECT/INSERT/UPDATE para autenticados.

---

### 4.5 `scheduled_messages`

Disparos agendados (cron).

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| nome_disparo | text | NO | — |
| phone | text | NO | — |
| message_text | text | NO | — |
| frequency | text | NO | — |
| send_time | time | NO | — |
| week_days | integer[] | YES | — |
| month_day | integer | YES | — |
| instance_id | uuid | NO | — |
| contact_id | uuid | YES | — |
| created_by | uuid | NO | — |
| active | boolean | NO | `true` |
| next_run_at | timestamptz | YES | — |
| last_run_at | timestamptz | YES | — |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |

**Foreign Keys:** instance_id → instancias_whatsapp.id, contact_id → contacts.id

**Índices:**
- `scheduled_messages_pkey` — UNIQUE (id)
- `idx_scheduled_messages_active` — (active)
- `idx_scheduled_messages_contact` — (contact_id)
- `idx_scheduled_messages_instance` — (instance_id)
- `idx_scheduled_messages_next_run` — (next_run_at) WHERE active = true

**RLS:** CRUD para criador (`created_by = uid`) ou admin.

---

### 4.6 `scheduled_messages_log`

Log de execução de disparos agendados.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| scheduled_message_id | uuid | NO | — |
| success | boolean | NO | — |
| error_message | text | YES | — |
| wa_message_id | text | YES | — |
| sent_at | timestamptz | NO | `now()` |

**Foreign Keys:** scheduled_message_id → scheduled_messages.id

**Índices:**
- `scheduled_messages_log_pkey` — UNIQUE (id)
- `idx_scheduled_messages_log_scheduled` — (scheduled_message_id)
- `idx_scheduled_messages_log_sent_at` — (sent_at)

**RLS:** SELECT via subquery (criador ou admin). INSERT público (`true`). ❌ UPDATE/DELETE não permitidos.

---

## 5. TaskFlow

### 5.1 `task_flow_columns`

Colunas do board Kanban.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| nome | text | NO | — |
| tipo | text | NO | `'individual'` |
| ordem | integer | NO | `0` |
| icone | text | YES | — |
| cor | text | YES | — |
| created_at | timestamptz | NO | `now()` |

**Índices:** `task_flow_columns_pkey` — UNIQUE (id)

**RLS:** SELECT para autenticados. ALL apenas admin.

---

### 5.2 `task_flow_tasks`

Tarefas do board.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| titulo | text | NO | — |
| descricao | text | YES | — |
| resumo | text | YES | — |
| column_id | uuid | NO | — |
| responsavel_id | uuid | YES | — |
| criado_por_id | uuid | YES | — |
| ordem | integer | NO | `0` |
| prazo | timestamptz | YES | — |
| data_retorno | timestamptz | YES | — |
| origem | text | YES | `'manual'` |
| audio_url | text | YES | — |
| deleted_at | timestamptz | YES | — |
| deleted_by | uuid | YES | — |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |

**Foreign Keys:** column_id → task_flow_columns.id, responsavel_id → task_flow_profiles.id, criado_por_id → profiles.id

**Índices:**
- `task_flow_tasks_pkey` — UNIQUE (id)
- `idx_task_flow_tasks_deleted_at` — (deleted_at) WHERE deleted_at IS NULL

**RLS:** SELECT/INSERT/UPDATE para autenticados. DELETE apenas admin.

---

### 5.3 `task_flow_profiles`

Perfis de usuário no TaskFlow (separado de profiles).

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| nome | text | NO | — |
| avatar_url | text | YES | — |
| cor | text | NO | `'#3B82F6'` |
| ativo | boolean | NO | `true` |
| user_id | uuid | YES | — |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |

**Foreign Keys:** user_id → profiles.id

**Índices:**
- `task_flow_profiles_pkey` — UNIQUE (id)
- `idx_task_flow_profiles_user_id` — (user_id)

**RLS:** SELECT para autenticados. ALL apenas admin.

---

### 5.4 `task_flow_checklists`

Itens de checklist dentro de tarefas.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| task_id | uuid | NO | — |
| texto | text | NO | — |
| concluido | boolean | NO | `false` |
| ordem | integer | NO | `0` |
| created_at | timestamptz | NO | `now()` |

**Foreign Keys:** task_id → task_flow_tasks.id

**Índices:** `task_flow_checklists_pkey` — UNIQUE (id)

**RLS:** SELECT + ALL para autenticados.

---

### 5.5 `task_flow_comments`

Comentários/notas em tarefas.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| task_id | uuid | NO | — |
| autor_id | uuid | YES | — |
| texto | text | NO | — |
| tipo | text | NO | `'nota'` |
| attachment_id | uuid | YES | — |
| created_at | timestamptz | NO | `now()` |

**Foreign Keys:** task_id → task_flow_tasks.id, autor_id → profiles.id, attachment_id → task_flow_attachments.id

**Índices:** `task_flow_comments_pkey` — UNIQUE (id)

**RLS:** SELECT + ALL para autenticados.

---

### 5.6 `task_flow_attachments`

Anexos de tarefas.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| task_id | uuid | NO | — |
| file_name | text | NO | — |
| file_url | text | NO | — |
| file_type | text | YES | — |
| file_size | bigint | YES | — |
| uploaded_by | uuid | YES | — |
| created_at | timestamptz | NO | `now()` |

**Foreign Keys:** task_id → task_flow_tasks.id, uploaded_by → task_flow_profiles.id

**Índices:** `task_flow_attachments_pkey` — UNIQUE (id)

**RLS:** SELECT + ALL para autenticados.

---

### 5.7 `task_flow_tags`

Tags disponíveis para tarefas.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| nome | text | NO | — |
| cor | text | NO | `'#6366F1'` |
| created_at | timestamptz | NO | `now()` |

**Índices:** `task_flow_tags_pkey` — UNIQUE (id)

**RLS:** SELECT + ALL para autenticados.

---

### 5.8 `task_flow_task_tags`

Junction table: tags ↔ tarefas.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| task_id | uuid | NO | — |
| tag_id | uuid | NO | — |
| created_at | timestamptz | NO | `now()` |

**Foreign Keys:** task_id → task_flow_tasks.id, tag_id → task_flow_tags.id

**Índices:**
- `task_flow_task_tags_pkey` — UNIQUE (id)
- `task_flow_task_tags_task_id_tag_id_key` — UNIQUE (task_id, tag_id)

**RLS:** SELECT + ALL para autenticados.

---

### 5.9 `task_flow_history`

Histórico de alterações em tarefas.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| task_id | uuid | NO | — |
| autor_id | uuid | YES | — |
| tipo | text | NO | — |
| descricao | text | NO | — |
| valor_anterior | text | YES | — |
| valor_novo | text | YES | — |
| created_at | timestamptz | NO | `now()` |

**Foreign Keys:** task_id → task_flow_tasks.id, autor_id → profiles.id

**Índices:** `task_flow_history_pkey` — UNIQUE (id)

**RLS:** SELECT/INSERT para autenticados. ❌ UPDATE/DELETE não permitidos.

---

## 6. Usuários

### 6.1 `profiles`

Perfis de usuário do sistema.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | — (= auth.users.id) |
| nome | text | NO | — |
| telefone_contato | text | YES | — |
| cor_perfil | text | NO | `'#3B82F6'` |
| instancia_padrao_id | uuid | YES | — |
| ativo | boolean | NO | `true` |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |

**Foreign Keys:** id → auth.users.id, instancia_padrao_id → instancias_whatsapp.id

**Índices:**
- `profiles_pkey` — UNIQUE (id)
- `idx_profiles_instancia_padrao` — (instancia_padrao_id)

**RLS Policies:**
| Policy | Comando | Condição |
|--------|---------|----------|
| Ver próprio perfil ou admin vê todos | SELECT | `uid = id OR admin` |
| Usuários podem atualizar seu próprio perfil | UPDATE | `uid = id` |
| Apenas admins podem atualizar todos os perfis | UPDATE | `admin` |
| Apenas admins podem inserir perfis | INSERT | `admin` |

---

### 6.2 `user_roles`

Roles de usuário (separada de profiles por segurança).

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| user_id | uuid | NO | — |
| role | app_role (enum) | NO | — |
| created_at | timestamptz | NO | `now()` |

**Foreign Keys:** user_id → auth.users.id

**Índices:**
- `user_roles_pkey` — UNIQUE (id)
- `user_roles_user_id_role_key` — UNIQUE (user_id, role)

**RLS:** SELECT próprio (`uid = user_id`). ALL apenas admin.

---

### 6.3 `notificacoes`

Notificações in-app.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| titulo | text | NO | — |
| mensagem | text | NO | — |
| tipo | text | NO | — |
| dados | jsonb | YES | — |
| user_id | uuid | YES | — |
| lida | boolean | NO | `false` |
| created_at | timestamptz | NO | `now()` |

**Foreign Keys:** user_id → auth.users.id

**Índices:**
- `notificacoes_pkey` — UNIQUE (id)
- `idx_notificacoes_user_id` — (user_id)

**RLS:** SELECT/UPDATE para autenticados. ❌ INSERT/DELETE não permitidos (inserção via trigger/edge function).

---

## 7. IA e Scripts

### 7.1 `ia_scripts`

Scripts de IA para respostas automáticas no WhatsApp.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| nome | text | NO | — |
| descricao_vaga | text | YES | — |
| tipo_vaga | text | YES | — |
| presencial | boolean | YES | — |
| necessario_mudar | boolean | YES | — |
| detalhes_vaga | text[] | YES | `'{}'` |
| ativo | boolean | NO | `true` |
| created_by | uuid | YES | — |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |

**Foreign Keys:** created_by → auth.users.id

**Índices:** `ia_scripts_pkey` — UNIQUE (id)

**RLS:** CRUD completo para autenticados.

---

### 7.2 `ia_script_perguntas`

Perguntas de checklist vinculadas a scripts IA.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| script_id | uuid | NO | — |
| pergunta | text | NO | — |
| ordem | integer | NO | `0` |
| obrigatoria | boolean | NO | `true` |
| created_at | timestamptz | NO | `now()` |

**Foreign Keys:** script_id → ia_scripts.id

**Índices:** `ia_script_perguntas_pkey` — UNIQUE (id)

**RLS:** CRUD completo para autenticados.

---

## 8. Outras Tabelas

### 8.1 `eventos_agenda`

Eventos do Google Calendar.

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| **id** (PK) | uuid | NO | `gen_random_uuid()` |
| titulo | text | NO | — |
| descricao | text | YES | — |
| tipo_evento | text | NO | `'consulta'` |
| status | text | NO | `'pendente'` |
| medico_id | uuid | NO | — |
| paciente_id | uuid | YES | — |
| google_event_id | text | YES | — |
| data_hora_inicio | timestamptz | NO | — |
| data_hora_fim | timestamptz | NO | — |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |

**Índices:**
- `eventos_agenda_pkey` — UNIQUE (id)
- `idx_eventos_agenda_medico_id` — (medico_id)
- `idx_eventos_agenda_data_hora_inicio` — (data_hora_inicio)
- `idx_eventos_agenda_status` — (status)

**RLS:** CRUD para `medico_id = uid` ou admin.

---

## Resumo de Contagem

| Domínio | Tabelas | Total Índices |
|---------|---------|---------------|
| Conversas e Mensagens | 4 | 21 |
| Contatos | 9 | 16 |
| WhatsApp | 5 | 16 |
| Disparos | 6 | 17 |
| TaskFlow | 9 | 11 |
| Usuários | 3 | 5 |
| IA e Scripts | 2 | 2 |
| Outras | 1 | 4 |
| **Total** | **39** | **92** |

---

## Funções SQL Relevantes

| Função | Tipo | Descrição |
|--------|------|-----------|
| `has_role(uuid, app_role)` | SECURITY DEFINER | Verifica se usuário tem role específica |
| `get_user_role(uuid)` | SECURITY DEFINER | Retorna role do usuário |
| `get_current_user_profile()` | SECURITY DEFINER | Retorna perfil completo com role e instância |
| `handle_new_user()` | TRIGGER | Cria profile ao criar user (ativo=false) |
| `handle_updated_at()` | TRIGGER | Atualiza updated_at automaticamente |
| `migrar_numero_para_instancia(...)` | SECURITY DEFINER | Transfere número entre instâncias |
| `get_instancia_ativa_numero(text)` | SECURITY DEFINER | Busca instância ativa de um número |
| `calculate_next_run(...)` | SECURITY DEFINER | Calcula próxima execução de disparo agendado |
| `cleanup_deleted_tasks()` | SECURITY DEFINER | Limpa tarefas deletadas há +30 dias |
| `notify_task_created()` | TRIGGER | Cria notificação quando tarefa é criada |

## Storage Buckets

| Bucket | Público |
|--------|---------|
| `message-media` | ✅ |
| `lead-attachments` | ✅ |
| `task-attachments` | ✅ |
