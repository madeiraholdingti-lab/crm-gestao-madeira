# Diagrama de Relações do Banco de Dados (ERD Textual)

> Gerado em: 2026-03-22  
> Schema: `public` (FKs para `auth.users` indicadas como referências externas)

---

## Legenda

- `→` = Foreign Key formal (N:1 por padrão, salvo indicação)
- **1:N** = Uma linha da tabela destino pode ter N linhas na origem
- **N:N** = Relação muitos-para-muitos via tabela junction
- **1:1** = Relação um-para-um (UNIQUE na FK)
- ⚠️ = FK implícita (sem constraint formal)
- ⭐ = Tabela central (referenciada por 4+ tabelas)

---

## 1. Tabelas Centrais (referenciadas por 4+ tabelas)

| Tabela | Nº de FKs apontando para ela | Quem referencia |
|--------|------------------------------|-----------------|
| ⭐ `instancias_whatsapp` | **9** | conversas (×3), messages, profiles, numeros_whatsapp, historico_numero_instancia, campanhas_disparo, envios_disparo, scheduled_messages |
| ⭐ `leads` | **5** | campanha_envios, lead_campanha_historico, lead_blacklist, lead_comments, lead_especialidades_secundarias |
| ⭐ `task_flow_tasks` | **5** | task_flow_task_tags, task_flow_attachments, task_flow_checklists, task_flow_comments, task_flow_history |
| ⭐ `contacts` | **4** | conversas, messages, contact_attachments, scheduled_messages, message_reactions |
| ⭐ `profiles` | **5** | task_flow_profiles, task_flow_tasks (criado_por), task_flow_comments, task_flow_history, lead_comments |
| ⭐ `campanhas_disparo` | **4** | campanha_envios, lead_campanha_historico, envios_disparo |
| ⭐ `auth.users` | **10+** | profiles, user_roles, conversas, mensagens, instancias_whatsapp, contact_attachments, notificacoes, lead_blacklist, ia_scripts, especialidades, tipos_lead |

---

## 2. Relações por Domínio

### 2.1 Conversas e Mensagens

```
conversas.contact_id          → contacts.id              (N:1)
conversas.instancia_id        → instancias_whatsapp.id   (N:1)
conversas.current_instance_id → instancias_whatsapp.id   (N:1)
conversas.orig_instance_id    → instancias_whatsapp.id   (N:1)
conversas.numero_whatsapp_id  → numeros_whatsapp.id      (N:1)
conversas.responsavel_atual   → auth.users.id            (N:1)

mensagens.conversa_id         → conversas.id             (N:1)
mensagens.enviado_por         → auth.users.id            (N:1)

messages.contact_id           → contacts.id              (N:1)
messages.instancia_whatsapp_id → instancias_whatsapp.id  (N:1)

message_reactions.contact_id  → contacts.id              (N:1)
```

**Diagrama visual:**
```
auth.users ←── conversas ──→ contacts
                  │  │  │
                  │  │  └──→ numeros_whatsapp
                  │  └─────→ instancias_whatsapp (×3)
                  │
                  ├──→ mensagens ──→ auth.users
                  │
                  └ messages ──→ contacts
                       └──→ instancias_whatsapp

message_reactions ──→ contacts
```

### 2.2 Contatos e Leads

```
contact_attachments.contact_id    → contacts.id        (N:1)
contact_attachments.uploaded_by   → auth.users.id      (N:1)

leads.especialidade_id            → especialidades.id   (N:1)

lead_especialidades_secundarias.lead_id          → leads.id            (N:1)
lead_especialidades_secundarias.especialidade_id → especialidades.id   (N:1)
  ↳ Tabela junction → relação N:N entre leads e especialidades

lead_blacklist.lead_id            → leads.id            (1:1, UNIQUE)
lead_blacklist.adicionado_por     → auth.users.id       (N:1)

lead_comments.lead_id             → leads.id            (N:1)
lead_comments.autor_id            → profiles.id         (N:1)

lead_comment_attachments.comment_id → lead_comments.id  (N:1)

lead_campanha_historico.lead_id      → leads.id              (N:1)
lead_campanha_historico.campanha_id  → campanhas_disparo.id  (N:1)
  ↳ Tabela junction → relação N:N entre leads e campanhas_disparo
```

**Diagrama visual:**
```
especialidades ←── leads ──→ (especialidade principal)
       ↑              │
       └── lead_especialidades_secundarias (N:N junction)
                      │
       ┌──────────────┼──────────────┐
       ↓              ↓              ↓
  lead_blacklist  lead_comments  lead_campanha_historico
                      │                    │
                      ↓                    ↓
              lead_comment_attachments  campanhas_disparo
```

### 2.3 WhatsApp / Instâncias

```
instancias_whatsapp.criado_por          → auth.users.id           (N:1)

numeros_whatsapp.instancia_atual_id     → instancias_whatsapp.id  (N:1)

historico_numero_instancia.instancia_id       → instancias_whatsapp.id (N:1)
historico_numero_instancia.numero_whatsapp_id → numeros_whatsapp.id    (N:1)
```

**Diagrama visual:**
```
auth.users ←── instancias_whatsapp ←── numeros_whatsapp
                      ↑                      │
                      └── historico_numero_instancia
```

### 2.4 Disparos (Campanhas e Envios)

```
campanhas_disparo.instancia_id    → instancias_whatsapp.id  (N:1)
campanhas_disparo.script_ia_id    → ia_scripts.id           (N:1)

envios_disparo.campanha_id        → campanhas_disparo.id    (N:1)
envios_disparo.instancia_id       → instancias_whatsapp.id  (N:1)

campanha_envios.campanha_id       → campanhas_disparo.id    (N:1)
campanha_envios.envio_id          → envios_disparo.id       (N:1)
campanha_envios.lead_id           → leads.id                (N:1)

scheduled_messages.contact_id     → contacts.id             (N:1)
scheduled_messages.instance_id    → instancias_whatsapp.id  (N:1)

scheduled_messages_log.scheduled_message_id → scheduled_messages.id (N:1)
```

**Diagrama visual:**
```
ia_scripts ←── campanhas_disparo ──→ instancias_whatsapp
                    │       │
                    │       └──→ envios_disparo ──→ instancias_whatsapp
                    │                 │
                    └──→ campanha_envios ──→ leads
                              │
                              └──→ envios_disparo

scheduled_messages ──→ contacts
       │           ──→ instancias_whatsapp
       └── scheduled_messages_log
```

### 2.5 TaskFlow (Kanban)

```
task_flow_profiles.user_id          → profiles.id            (N:1)

task_flow_tasks.column_id           → task_flow_columns.id   (N:1)
task_flow_tasks.responsavel_id      → task_flow_profiles.id  (N:1)
task_flow_tasks.criado_por_id       → profiles.id            (N:1)

task_flow_task_tags.task_id         → task_flow_tasks.id     (N:1)
task_flow_task_tags.tag_id          → task_flow_tags.id      (N:1)
  ↳ Tabela junction → relação N:N entre task_flow_tasks e task_flow_tags

task_flow_attachments.task_id       → task_flow_tasks.id       (N:1)
task_flow_attachments.uploaded_by   → task_flow_profiles.id    (N:1)

task_flow_checklists.task_id        → task_flow_tasks.id       (N:1)

task_flow_comments.task_id          → task_flow_tasks.id       (N:1)
task_flow_comments.autor_id         → profiles.id              (N:1)
task_flow_comments.attachment_id    → task_flow_attachments.id  (N:1)

task_flow_history.task_id           → task_flow_tasks.id       (N:1)
task_flow_history.autor_id          → profiles.id              (N:1)
```

**Diagrama visual:**
```
profiles ←── task_flow_profiles ←── task_flow_tasks ──→ task_flow_columns
                    ↑                    │  │  │  │
                    │                    │  │  │  └── task_flow_history ──→ profiles
                    │                    │  │  └───── task_flow_comments ──→ profiles
                    │                    │  └──────── task_flow_checklists
                    └── task_flow_attachments
                                         │
                    task_flow_task_tags ──→ task_flow_tags (N:N)
```

### 2.6 Usuários e Configuração

```
profiles.id                    → auth.users.id           (1:1)
profiles.instancia_padrao_id   → instancias_whatsapp.id  (N:1)

user_roles.user_id             → auth.users.id           (N:1)

notificacoes.user_id           → auth.users.id           (N:1)

especialidades.created_by      → auth.users.id           (N:1)
tipos_lead.created_by          → auth.users.id           (N:1)
```

### 2.7 IA e Scripts

```
ia_scripts.created_by                → auth.users.id    (N:1)
ia_script_perguntas.script_id        → ia_scripts.id    (N:1)
campanhas_disparo.script_ia_id       → ia_scripts.id    (N:1)
```

---

## 3. FKs Implícitas (sem constraint formal) ⚠️

Campos que parecem ser FK pelo nome/uso mas **não possuem constraint** no banco:

| Tabela | Coluna | Provável destino | Evidência |
|--------|--------|-------------------|-----------|
| `conversas` | `nome_contato` | `contacts.name` | Texto duplicado, sem FK |
| `conversas` | `numero_contato` | `contacts.phone` | Match por telefone, sem FK formal |
| `conversas` | `foto_contato` | `contacts.profile_picture_url` | Texto duplicado |
| `campanha_envios` | `telefone` | `leads.telefone` | Telefone copiado do lead |
| `campanhas_disparo` | `created_by` | `auth.users.id` / `profiles.id` | UUID de criador, sem FK |
| `envios_disparo` | `created_by` | `auth.users.id` / `profiles.id` | UUID de criador, sem FK |
| `eventos_agenda` | `medico_id` | `auth.users.id` / `profiles.id` | UUID sem FK formal |
| `eventos_agenda` | `paciente_id` | `contacts.id` | UUID sem FK formal |
| `messages` | `instance` | `instancias_whatsapp.instancia_id` | Nome da instância (texto) |
| `messages` | `instance_uuid` | `instancias_whatsapp.id` | UUID mas sem FK |
| `messages` | `sender_jid` | `contacts.jid` | JID do remetente |
| `leads` | `especialidade` | `especialidades.nome` | Texto legado (pré-migração FK) |
| `leads` | `tipo_lead` | `tipos_lead.nome` | Match por nome, sem FK |
| `scheduled_messages` | `created_by` | `auth.users.id` | UUID sem FK formal (tem na RLS) |

---

## 4. Tabelas Órfãs (sem FK entrando ou saindo)

| Tabela | Observação |
|--------|------------|
| `config_global` | Tabela de configuração singleton — esperado sem FKs |
| `instance_events` | Log de eventos de instância — referencia por texto (`instance_name`) sem FK formal |
| `tipos_lead` | Apenas `created_by → auth.users`; nenhuma tabela referencia formalmente `tipos_lead` |

> **Nota:** `tipos_lead` é usada via match textual em `leads.tipo_lead` e `campanhas_disparo.filtro_tipo_lead`, mas sem FK formal.

---

## 5. Tabelas Junction (N:N)

| Junction Table | Tabela A | Tabela B | Descrição |
|----------------|----------|----------|-----------|
| `lead_especialidades_secundarias` | `leads` | `especialidades` | Especialidades secundárias do lead |
| `lead_campanha_historico` | `leads` | `campanhas_disparo` | Histórico de envio por campanha |
| `task_flow_task_tags` | `task_flow_tasks` | `task_flow_tags` | Tags das tarefas |

---

## 6. Resumo Quantitativo

| Métrica | Valor |
|---------|-------|
| Total de tabelas (public) | 39 |
| Total de FKs formais (public) | 52 |
| FKs para `auth.users` | 12 |
| FKs implícitas identificadas | 14 |
| Tabelas centrais (4+ refs) | 7 |
| Tabelas junction (N:N) | 3 |
| Tabelas órfãs | 3 |
