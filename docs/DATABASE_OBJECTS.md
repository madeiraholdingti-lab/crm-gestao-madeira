# Objetos do Banco de Dados (não-tabelas)

> Gerado em: 2026-03-22  
> Schema: `public` (salvo indicação)

---

## 1. Views

**Nenhuma view encontrada no schema `public`.**

---

## 2. Functions (SQL / PL/pgSQL)

| # | Função | Parâmetros | Retorno | Descrição |
|---|--------|------------|---------|-----------|
| 1 | `handle_new_user()` | — (trigger) | `trigger` | Cria perfil na tabela `profiles` quando novo usuário é registrado no `auth.users`; usuário começa inativo sem role |
| 2 | `handle_updated_at()` | — (trigger) | `trigger` | Atualiza `updated_at = NOW()` automaticamente em qualquer tabela vinculada |
| 3 | `update_updated_at_column()` | — (trigger) | `trigger` | Variante de `handle_updated_at` usada em `ia_scripts` |
| 4 | `has_role(_user_id uuid, _role app_role)` | `uuid, app_role` | `boolean` | Verifica se usuário possui determinada role (SECURITY DEFINER, evita recursão RLS) |
| 5 | `get_user_role(_user_id uuid)` | `uuid` | `app_role` | Retorna a role de um usuário (primeira encontrada) |
| 6 | `get_current_user_profile()` | — | `TABLE(id, nome, telefone_contato, cor_perfil, instancia_padrao_id, ativo, role, instancia_nome, instancia_numero)` | Retorna perfil completo do usuário autenticado com JOIN em `profiles`, `user_roles` e `instancias_whatsapp` |
| 7 | `get_instancia_ativa_numero(p_numero text)` | `text` | `uuid` | Busca UUID da instância ativa vinculada a um número WhatsApp |
| 8 | `migrar_numero_para_instancia(p_numero, p_nova_instancia_id, p_motivo)` | `text, uuid, text` | `uuid` | Migra número entre instâncias: atualiza `numeros_whatsapp`, registra histórico, reatribui conversas |
| 9 | `calculate_next_run(p_frequency, p_send_time, p_week_days, p_month_day, p_current_time)` | `text, time, int[], int, timestamptz` | `timestamptz` | Calcula próxima execução de disparo agendado (daily/weekly/monthly/once) no fuso America/Sao_Paulo |
| 10 | `cleanup_deleted_tasks()` | — | `void` | Remove tarefas com soft-delete há mais de 30 dias e todos os dados relacionados (comments, checklists, history, tags, attachments) |
| 11 | `notify_task_created()` | — (trigger) | `trigger` | Cria notificação broadcast para todos os profiles ativos quando nova tarefa é inserida no TaskFlow |

---

## 3. Triggers

| # | Trigger | Tabela | Quando | Função chamada | Obs |
|---|---------|--------|--------|----------------|-----|
| 1 | `update_profiles_updated_at` | `profiles` | BEFORE UPDATE | `handle_updated_at()` | Auto-atualiza `updated_at` |
| 2 | `update_instancias_updated_at` | `instancias_whatsapp` | BEFORE UPDATE | `handle_updated_at()` | Auto-atualiza `updated_at` |
| 3 | `update_conversas_updated_at` | `conversas` | BEFORE UPDATE | `handle_updated_at()` | Auto-atualiza `updated_at` |
| 4 | `update_config_global_updated_at` | `config_global` | BEFORE UPDATE | `handle_updated_at()` | Auto-atualiza `updated_at` |
| 5 | `update_contacts_updated_at` | `contacts` | BEFORE UPDATE | `handle_updated_at()` | Auto-atualiza `updated_at` |
| 6 | `update_eventos_agenda_updated_at` | `eventos_agenda` | BEFORE UPDATE | `handle_updated_at()` | Auto-atualiza `updated_at` |
| 7 | `update_numeros_whatsapp_updated_at` | `numeros_whatsapp` | BEFORE UPDATE | `handle_updated_at()` | Auto-atualiza `updated_at` |
| 8 | `update_scheduled_messages_updated_at` | `scheduled_messages` | BEFORE UPDATE | `handle_updated_at()` | Auto-atualiza `updated_at` |
| 9 | `update_leads_updated_at` | `leads` | BEFORE UPDATE | `handle_updated_at()` | Auto-atualiza `updated_at` |
| 10 | `update_campanhas_updated_at` | `campanhas_disparo` | BEFORE UPDATE | `handle_updated_at()` | Auto-atualiza `updated_at` |
| 11 | `update_task_flow_profiles_updated_at` | `task_flow_profiles` | BEFORE UPDATE | `handle_updated_at()` | Auto-atualiza `updated_at` |
| 12 | `update_task_flow_tasks_updated_at` | `task_flow_tasks` | BEFORE UPDATE | `handle_updated_at()` | Auto-atualiza `updated_at` |
| 13 | `update_ia_scripts_updated_at` | `ia_scripts` | BEFORE UPDATE | `update_updated_at_column()` | Auto-atualiza `updated_at` (função diferente, mesmo efeito) |
| 14 | `trigger_notify_task_created` | `task_flow_tasks` | AFTER INSERT | `notify_task_created()` | Cria notificação para todos os usuários ativos |

> **Nota:** O trigger `handle_new_user` em `auth.users` (schema `auth`) não aparece na listagem pública mas está ativo — cria perfil automaticamente no signup.

### Tabelas SEM trigger de `updated_at` (potencial inconsistência)

| Tabela | Tem `updated_at`? | Trigger? |
|--------|-------------------|----------|
| `envios_disparo` | ✅ Sim | ❌ Não |
| `ia_script_perguntas` | ❌ Não | — |
| `mensagens` | ❌ Não | — |
| `messages` | ❌ Não | — |
| `notificacoes` | ❌ Não | — |
| `task_flow_columns` | ❌ Não | — |

> ⚠️ `envios_disparo` tem coluna `updated_at` mas **nenhum trigger** para atualizá-la automaticamente.

---

## 4. Policies RLS

### Resumo por tabela

| Tabela | SELECT | INSERT | UPDATE | DELETE | Padrão de acesso |
|--------|--------|--------|--------|--------|------------------|
| `campanha_envios` | auth ✅ | public ✅ | public ✅ | auth + status ✅ | Aberto para sistema; delete restrito a pendentes |
| `campanhas_disparo` | auth ✅ | auth ✅ | auth ✅ | admin ✅ | Qualquer auth CRUD; delete só admin |
| `config_global` | public ✅ | admin ✅ | admin ✅ | ❌ | Leitura pública; escrita só admin |
| `contact_attachments` | auth ✅ | auth ✅ | ❌ | auth ✅ | Sem update |
| `contacts` | auth ✅ | auth ✅ | auth ✅ | ❌ | Sem delete |
| `conversas` | dono/admin ✅ | auth ✅ | auth ✅ | admin ✅ | SELECT filtra por responsável |
| `envios_disparo` | auth ✅ | auth ✅ | auth ✅ | admin ✅ | Delete só admin |
| `especialidades` | auth ✅ | auth ✅ | ❌ | ❌ | Somente leitura + insert |
| `eventos_agenda` | dono/admin ✅ | dono/admin ✅ | dono/admin ✅ | dono/admin ✅ | Filtrado por `medico_id` |
| `historico_numero_instancia` | auth ✅ | admin ✅ | ❌ | ❌ | Append-only para admins |
| `ia_script_perguntas` | auth ✅ | auth ✅ | auth ✅ | auth ✅ | CRUD completo para auth |
| `ia_scripts` | auth ✅ | auth ✅ | auth ✅ | auth ✅ | CRUD completo para auth |
| `instance_events` | auth ✅ | public ✅ | ❌ | ❌ | Log append-only |
| `instancias_whatsapp` | auth ✅ | admin/med/sec ✅ | admin/med/sec ✅ | admin/med/sec ✅ | SELECT aberto; gestão restrita |
| `lead_blacklist` | auth ✅ | auth ✅ | ❌ | admin ✅ | Sem update; delete só admin |
| `lead_campanha_historico` | auth ✅ | auth ✅ | auth ✅ | ❌ | Sem delete |
| `lead_comment_attachments` | auth ✅ | auth ✅ | ❌ | autor ✅ | Delete só do próprio comentário |
| `lead_comments` | auth ✅ | auth ✅ | ❌ | autor ✅ | Delete só do próprio |
| `lead_especialidades_secundarias` | auth ✅ | auth ✅ | auth ✅ | auth ✅ | CRUD completo |
| `leads` | auth ✅ | auth ✅ | auth ✅ | admin ✅ | Delete só admin |
| `mensagens` | dono conversa ✅ | dono conversa ✅ | dono/admin ✅ | ❌ | Filtrado por conversa do usuário |
| `message_reactions` | auth ✅ | auth ✅ | auth ✅ | auth ✅ | CRUD completo |
| `messages` | auth ✅ | auth ✅ | auth ✅ | ❌ | Sem delete |
| `notificacoes` | auth ✅ | ❌ | auth ✅ | ❌ | Só leitura + marcar como lida |
| `numeros_whatsapp` | auth ✅ | admin ✅ | admin ✅ | ❌ | Gestão só admin |
| `profiles` | dono/admin ✅ | admin ✅ | dono/admin ✅ | ❌ | Perfil próprio ou admin |
| `scheduled_messages` | dono/admin ✅ | dono ✅ | dono/admin ✅ | dono/admin ✅ | Filtrado por `created_by` |
| `scheduled_messages_log` | dono/admin ✅ | public ✅ | ❌ | ❌ | Log append-only |
| `task_flow_attachments` | auth ✅ | auth ✅ | auth ✅ | auth ✅ | CRUD completo |
| `task_flow_checklists` | auth ✅ | auth ✅ | auth ✅ | auth ✅ | CRUD completo |
| `task_flow_columns` | auth ✅ | auth ✅ | auth ✅ | auth ✅ | CRUD completo |
| `task_flow_comments` | auth ✅ | auth ✅ | auth ✅ | auth ✅ | CRUD completo |
| `task_flow_history` | auth ✅ | auth ✅ | auth ✅ | auth ✅ | CRUD completo |
| `task_flow_profiles` | auth ✅ | auth ✅ | auth ✅ | auth ✅ | CRUD completo |
| `task_flow_tags` | auth ✅ | auth ✅ | auth ✅ | auth ✅ | CRUD completo |
| `task_flow_task_tags` | auth ✅ | auth ✅ | auth ✅ | auth ✅ | CRUD completo |
| `task_flow_tasks` | auth ✅ | auth ✅ | auth ✅ | auth ✅ | CRUD completo |
| `tipos_lead` | auth ✅ | auth ✅ | ❌ | ❌ | Somente leitura + insert |
| `user_roles` | dono/admin ✅ | admin ✅ | admin ✅ | ❌ | Gestão de roles só admin |

### Padrões de segurança identificados

| Padrão | Tabelas |
|--------|---------|
| **CRUD completo para auth** | Todas as `task_flow_*`, `ia_scripts`, `ia_script_perguntas`, `message_reactions`, `lead_especialidades_secundarias` |
| **Delete restrito a admin** | `campanhas_disparo`, `envios_disparo`, `leads`, `lead_blacklist` |
| **Filtrado por ownership** | `conversas` (responsável), `mensagens` (via conversa), `scheduled_messages` (created_by), `eventos_agenda` (medico_id) |
| **Append-only (sem update/delete)** | `instance_events`, `historico_numero_instancia`, `scheduled_messages_log` |
| **Insert aberto (sistema/webhook)** | `campanha_envios`, `instance_events`, `scheduled_messages_log` |

---

## 5. Extensions Ativas

| Extension | Versão | Descrição |
|-----------|--------|-----------|
| `plpgsql` | 1.0 | Linguagem procedural padrão do PostgreSQL |
| `uuid-ossp` | 1.1 | Geração de UUIDs (v1, v4, etc.) |
| `pgcrypto` | 1.3 | Funções criptográficas (hash, encrypt, gen_random_uuid) |
| `pg_cron` | 1.6.4 | Agendamento de jobs cron dentro do PostgreSQL |
| `pg_net` | 0.19.5 | Chamadas HTTP assíncronas de dentro do banco (usado por webhooks) |
| `pg_graphql` | 1.5.11 | API GraphQL automática sobre o schema (usado pelo Supabase) |
| `pg_stat_statements` | 1.11 | Estatísticas de queries executadas (monitoramento de performance) |
| `supabase_vault` | 0.3.1 | Armazenamento seguro de secrets no banco |

### Extensions NÃO instaladas (relevantes)

| Extension | Status | Potencial uso |
|-----------|--------|---------------|
| `pgvector` | ❌ Não instalada | Necessária se implementar busca semântica / embeddings de IA |
| `pg_trgm` | ❌ Não instalada | Busca fuzzy/trigram em textos (nomes de contatos, leads) |
| `unaccent` | ❌ Não instalada | Normalizar acentos em buscas (útil para português) |

---

## 6. Enums

| Enum | Valores |
|------|---------|
| `app_role` | `admin_geral`, `medico`, `secretaria_medica`, `administrativo`, `disparador` |

---

## 7. Resumo Quantitativo

| Objeto | Quantidade |
|--------|-----------|
| Views | 0 |
| Functions | 11 |
| Triggers | 14 (13 de updated_at + 1 de notificação) |
| Policies RLS | ~90 |
| Extensions | 8 |
| Enums | 1 |
