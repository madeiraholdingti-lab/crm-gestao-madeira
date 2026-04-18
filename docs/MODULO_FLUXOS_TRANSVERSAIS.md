# Módulo: Fluxos Transversais e Notificações

> Documentação dos fluxos que conectam múltiplos módulos do Maikonect CRM.
> Gerado em: 2026-03-22

---

## 1. Sistema de Notificações

### 1.1 Tipos de Notificação Existentes

| Tipo | Origem | Descrição |
|------|--------|-----------|
| `task_created` | Trigger SQL `notify_task_created()` | Nova tarefa criada no TaskFlow |
| `instancia_caiu` | Edge Function `n8n-disparo-callback` | Instância WhatsApp desconectou durante disparo |
| `disparo_agendado_sucesso` | Edge Function `notificar-disparo` | Disparo agendado executado com sucesso |
| `disparo_massa_concluido` | Edge Function `notificar-disparo` | Campanha de disparo em massa finalizada |
| `disparo_massa_parcial` | Edge Function `notificar-disparo` | Campanha concluída com falhas parciais |
| `disparo_erro` | Edge Function `notificar-disparo` | Erro crítico em disparo |

### 1.2 Como São Criadas

**Via Trigger SQL (automática):**
- `notify_task_created()` — dispara no `INSERT` da tabela `task_flow_tasks`
- Cria notificação **broadcast** para TODOS os `profiles` ativos (não apenas o responsável)
- Insere diretamente na tabela `notificacoes` com `user_id` de cada perfil

**Via Edge Function (chamada programática):**
- `notificar-disparo` — endpoint dedicado para criar notificações
  - Recebe: `{ user_id, tipo, titulo, mensagem, dados? }`
  - Insere na tabela `notificacoes` usando service role (bypassa RLS)
- `n8n-disparo-callback` — cria notificações inline quando instância cai
  - Insere diretamente na `notificacoes` sem `user_id` (broadcast implícito)
  - **⚠️ Inconsistência:** insere sem `user_id`, mas a tabela não tem policy de INSERT para frontend — apenas service role consegue inserir

**Não existe criação manual pelo frontend** — não há formulário ou botão para criar notificações.

### 1.3 Frontend: NotificationsDropdown

**Arquivo:** `src/components/NotificationsDropdown.tsx`

**Funcionamento:**
1. No mount, chama `fetchNotificacoes()` que busca as 20 notificações mais recentes do usuário logado
2. Filtra por `user_id = auth.uid()` (usando `as any` para contornar tipos)
3. Conta não-lidas (`lida = false`) e exibe badge no ícone do sino
4. Ao clicar em uma notificação não-lida, marca como lida via `UPDATE`
5. Botão "Marcar todas como lidas" atualiza todas de uma vez

**Som de notificação:**
- Usa Web Audio API para gerar dois beeps (880Hz + 1175Hz)
- Toca som quando:
  - Recebe evento `INSERT` via Realtime (som imediato)
  - Incremento no contador de não-lidas (verificado via `previousNaoLidasRef`)
- NÃO toca som no primeiro carregamento (`isFirstLoadRef`)

### 1.4 Realtime

**Sim, as notificações são em tempo real.**

O `NotificationsDropdown` assina o canal `notificacoes-changes` via Supabase Realtime:
- Escuta eventos `INSERT` e `UPDATE` na tabela `notificacoes`
- **⚠️ Problema:** O canal NÃO filtra por `user_id` — escuta TODOS os inserts. O som toca mesmo para notificações de outros usuários. O `fetchNotificacoes()` subsequente filtra corretamente por user_id, mas o som já tocou.
- **⚠️ Dupla notificação sonora:** O som toca tanto no handler do INSERT (imediato) quanto no `checkAndPlaySound` (via contagem), podendo duplicar.

**Publicação Realtime:** A tabela `notificacoes` **NÃO** está explicitamente adicionada ao `supabase_realtime` publication nos migrations visíveis. Pode ter sido adicionada manualmente ou pode estar funcionando via configuração global.

---

## 2. Fluxos entre Módulos

### 2.1 SDR Zap → TaskFlow (Criar tarefa a partir de conversa)

**Status atual: NÃO IMPLEMENTADO no frontend.**

O Dr. Maikon solicitou essa integração (Sprint atual, item 5), mas atualmente:
- Não existe botão no SDR Zap para criar tarefa
- Não existe fluxo no frontend que conecte uma conversa a uma tarefa
- O `taskflow-webhook` aceita criação de tarefas via API/n8n, mas não é chamado pelo SDR Zap

**Fluxo pretendido (documentado em FASE_4):**
1. Usuário abre menu de ações em uma conversa no SDR Zap
2. Seleciona "Criar Tarefa"
3. Modal preenche título (nome do contato) e descrição (última mensagem)
4. Tarefa criada no TaskFlow com responsável selecionado
5. Link bidirecional entre conversa e tarefa (campo `origem` na task)

**Fluxo existente via n8n:**
- O `taskflow-webhook` recebe POST de sistemas externos (n8n)
- Cria tarefa com `origem: 'api'`
- Resolve `responsavel_id` por nome ("Geral", "Iza", etc.)
- Suporta criação a partir de mensagens com áudio (converte base64)

### 2.2 Disparo em Massa → CRM (Retorno de status)

**Fluxo completo implementado:**

```
Frontend cria Envio → processar-envios-massa monta lote
    → POST para n8n (webhook_ia_disparos)
        → n8n processa e envia via Evolution API
            → n8n chama n8n-disparo-callback com status de cada lead
                → Atualiza campanha_envios.status
                → Atualiza contadores em envios_disparo e campanhas_disparo
                → Se status="enviado" e conversa existe: insere em mensagens
                → Se há mais leads: chama processar-envios-massa para novo lote
                → Se instância caiu: pausa envio + cria notificação
```

**Detalhes do callback (n8n-disparo-callback):**

| Caso | Payload | Ação |
|------|---------|------|
| Instância caiu | `{ success: false, envio_id }` | Pausa envio, desativa (ativo=false), cria notificação `instancia_caiu` |
| Transferência | `{ success: false, tranfer: true, envio_id }` | Marca leads "enviar/tratando" como "reenviar" (respeitando limite de 3 tentativas) |
| Lote concluído | `{ success: true, envio_id }` | Conta status, reverte "tratando" para "reenviar", dispara próximo lote se dentro da janela (8h-16h SP, seg-sex) |
| Update individual | `{ telefone, status, envio_id, ... }` | Atualiza `campanha_envios`, se "enviado" tenta salvar em `mensagens` |

**Limites:**
- `LIMITE_POR_DISPARO = 350` (máximo de envios com sucesso por envio)
- `BATCH_SIZE = 70` (tamanho de cada lote enviado ao n8n)
- `MAX_TENTATIVAS = 3` (tentativas por lead antes de marcar como erro)
- Janela automática: 8h-16h São Paulo, segunda a sexta

**Mensagens no chat:**
Quando um lead é marcado como "enviado" com `wa_message_id`, o callback:
1. Busca a conversa pelo `numero_contato`
2. Se existir, insere a mensagem na tabela `mensagens` com `remetente: 'atendente'`
3. Atualiza `ultima_mensagem` e `ultima_interacao` da conversa
4. Se a conversa não existir, **NÃO cria** — espera o `evolution-webhook` criar

### 2.3 Calendário → Conversa (Criar evento a partir do SDR Zap)

**Fluxo implementado (parcial):**

```
Usuário no SDR Zap → useCalendarAction hook
    → Verificar disponibilidade:
        1. POST para calendar-webhook com tipo="calendar", subtipo="verificar"
        2. calendar-webhook lê webhook_url de config_global
        3. Envia payload para n8n
        4. n8n consulta Google Calendar e responde
        5. Resposta retorna ao frontend
    → Confirmar agendamento:
        1. CalendarConfirmModal exibe horário proposto
        2. POST para calendar-webhook com subtipo="confirmar"
        3. n8n cria evento no Google Calendar
        4. Callback de confirmação chega em calendar-confirmed-callback
```

**Componentes envolvidos:**
- `useCalendarAction.ts` — hook que gerencia fluxo de verificação e confirmação
- `CalendarConfirmModal.tsx` — modal de confirmação com dados do evento
- `calendar-webhook` — proxy para n8n (lê `webhook_url` de `config_global`)
- `calendar-verify-callback` — recebe resposta de verificação do n8n
- `calendar-confirmed-callback` — recebe confirmação de criação do evento

**⚠️ Incompleto:** Os callbacks (`calendar-verify-callback` e `calendar-confirmed-callback`) atualmente apenas logam o payload recebido. Não salvam na tabela `eventos_agenda` nem atualizam o frontend em tempo real. O comentário no código diz "Here you could store the result..."

### 2.4 Transferência de Conversa → Notificação ao Novo Responsável

**Fluxo implementado:**

```
SDR Zap → Seleciona novo responsável → ModalAnotacaoTransferencia
    → Confirma com anotação → transferirConversa()
        → UPDATE conversas: current_instance_id, responsavel_atual, anotacao_transferencia
    → Chama notificar-delegacao (edge function)
        → Envia WhatsApp para o telefone do novo responsável via Evolution API
```

**Detalhes:**

1. **Modal de transferência** (`ModalAnotacaoTransferencia.tsx`):
   - Exibe nome do contato e do novo responsável
   - Campo de texto para anotação (ex: "Paciente do zap pessoal, deseja agendar...")
   - Anotação é salva no campo `conversas.anotacao_transferencia`

2. **Atualização do banco** (`transferirConversa.ts`):
   - Atualiza `current_instance_id`, `responsavel_atual`, `anotacao_transferencia`
   - Atualiza `updated_at`
   - Operação direta no Supabase (não usa edge function para a transferência em si)

3. **Notificação via WhatsApp** (`notificar-delegacao`):
   - Envia mensagem WA formatada para o telefone do novo responsável
   - Usa a Evolution API diretamente
   - Mensagem inclui: emoji 🚨, nome do responsável, link wa.me do contato, instrução
   - **⚠️ URL da Evolution está hardcoded** no edge function (ngrok URL), não lê de `config_global`

4. **Edge Function `notificar-transferencia`** (separada):
   - Faz a transferência via edge function (alternativa ao `transferirConversa.ts`)
   - Atualiza `conversas` com os novos dados
   - **NÃO envia notificação WhatsApp** (apenas atualiza o banco)
   - Parece ser uma versão anterior/alternativa não usada pelo frontend

**⚠️ Notificação in-app NÃO é criada** — a transferência só notifica via WhatsApp, não cria registro na tabela `notificacoes`.

### 2.5 n8n → CRM (Dados que entram e saem via Webhooks)

#### Dados que ENTRAM no CRM (n8n → Edge Functions):

| Edge Function | Quem chama | Payload principal | Tabelas tocadas |
|---|---|---|---|
| `n8n-inbound-webhook` | n8n (via Evolution API) | Mensagens WA: `{ event, contact_jid, contact_phone, wa_message_id, message_text, raw_payload, ... }` | `contacts`, `conversas`, `mensagens`, `messages`, `message_reactions` |
| `n8n-disparo-callback` | n8n (após processar lote) | Status de envio: `{ success, envio_id, updates: [{ telefone, status, wa_message_id }] }` | `campanha_envios`, `envios_disparo`, `campanhas_disparo`, `mensagens`, `conversas`, `notificacoes` |
| `n8n-instance-events` | n8n (eventos de instância) | Eventos: `{ event, instance_name, instance_uuid, payload }` | `instance_events`, `instancias_whatsapp` |
| `taskflow-webhook` | n8n (automações) | Tarefa: `{ titulo, descricao, responsavel_id/responsavel_nome, column_id }` | `task_flow_tasks`, `task_flow_columns`, `task_flow_profiles` |
| `calendar-verify-callback` | n8n (Google Calendar) | Resposta: `{ request_id, status, suggested_times }` | Nenhuma (apenas log) |
| `calendar-confirmed-callback` | n8n (Google Calendar) | Confirmação: `{ request_id, status, event_id, event }` | Nenhuma (apenas log) |

#### Dados que SAEM do CRM (Edge Functions → n8n):

| Edge Function | Destino | Payload enviado | Quando |
|---|---|---|---|
| `processar-envios-massa` | n8n (`webhook_ia_disparos`) | Lote: `{ campanha: {...}, instancia: {...}, lote: [{telefone, nome, lead_id}], callback_url, script_ia_id }` | Ao iniciar envio de lote |
| `calendar-webhook` | n8n (`webhook_url`) | Ação de calendário: `{ tipo: "calendar", subtipo, ...dados }` | Verificar/confirmar agendamento |
| `notificar-delegacao` | Evolution API (direto) | Mensagem WA: `{ number, text }` | Ao transferir conversa |

#### URLs de Webhook em `config_global`:

| Campo | Uso | Destino |
|---|---|---|
| `webhook_url` | Webhook geral (Calendar) | n8n |
| `webhook_ia_disparos` | Disparos em massa | n8n |
| `webhook_ia_respondendo` | IA respondendo (não implementado) | n8n |
| `evolution_base_url` | Base URL da Evolution API | VPS Hostinger |
| `evolution_api_key` | Chave da Evolution API | — |

---

## 3. Diagrama de Fluxos

```
┌──────────────────────────────────────────────────────────┐
│                    FRONTEND (React)                       │
├──────────┬──────────┬──────────┬──────────┬──────────────┤
│ SDR Zap  │ TaskFlow │ Disparos │ Calendar │ Notificações │
└────┬─────┴────┬─────┴────┬─────┴────┬─────┴──────┬───────┘
     │          │          │          │            │
     │          │          │          │     ┌──────▼───────┐
     │          │          │          │     │  Realtime     │
     │          │          │          │     │  (INSERT/     │
     │          │          │          │     │   UPDATE)     │
     │          │          │          │     └──────▲───────┘
     │          │          │          │            │
┌────▼──────────▼──────────▼──────────▼────────────▼───────┐
│                 SUPABASE (Edge Functions)                  │
├──────────────────────────────────────────────────────────┤
│ n8n-inbound-webhook    ← mensagens WA                    │
│ n8n-disparo-callback   ← status de envios                │
│ n8n-instance-events    ← eventos de instância            │
│ notificar-disparo      ← criar notificação               │
│ notificar-delegacao    → envia WA para responsável       │
│ calendar-webhook       → consulta n8n/Google Calendar    │
│ processar-envios-massa → envia lote para n8n             │
│ taskflow-webhook       ← cria tarefas via API            │
└────────────┬──────────────────────────────┬──────────────┘
             │                              │
     ┌───────▼───────┐              ┌───────▼───────┐
     │   SUPABASE    │              │     n8n       │
     │   (Postgres)  │              │  (Automação)  │
     │               │              │               │
     │ conversas     │              │ Processa WA   │
     │ mensagens     │              │ Google Cal    │
     │ contacts      │              │ Disparos      │
     │ notificacoes  │              │ TaskFlow      │
     │ campanha_*    │              │               │
     │ task_flow_*   │              └───────┬───────┘
     └───────────────┘                      │
                                    ┌───────▼───────┐
                                    │ Evolution API │
                                    │ (WhatsApp)    │
                                    └───────────────┘
```

---

## 4. Problemas e Inconsistências Identificados

### 4.1 Notificações

1. **Som duplicado:** O `NotificationsDropdown` toca som tanto no handler do INSERT quanto no `checkAndPlaySound`, resultando em som duplo para cada notificação.

2. **Canal Realtime sem filtro:** O canal escuta TODOS os inserts, independente do `user_id`. O som toca mesmo para notificações de outros usuários.

3. **INSERT sem user_id:** O `n8n-disparo-callback` insere notificações `instancia_caiu` sem `user_id`, tornando-as invisíveis para todos (o `fetchNotificacoes` filtra por `user_id = auth.uid()`).

4. **RLS impede INSERT do frontend:** A tabela `notificacoes` não tem policy de INSERT — apenas service role (via edge functions) consegue inserir. Isso é intencional mas impede criação de notificações locais.

### 4.2 Transferência

5. **Sem notificação in-app:** Transferir conversa notifica apenas via WhatsApp, não cria registro em `notificacoes`.

6. **URL hardcoded:** `notificar-delegacao` tem a URL da Evolution API hardcoded em vez de ler de `config_global`.

7. **Duas implementações:** `transferirConversa.ts` (frontend) e `notificar-transferencia` (edge function) fazem coisas similares mas com comportamentos diferentes.

### 4.3 Calendário

8. **Callbacks incompletos:** `calendar-verify-callback` e `calendar-confirmed-callback` apenas logam — não persistem dados nem notificam o frontend.

### 4.4 TaskFlow ↔ SDR Zap

9. **Integração não implementada:** Criar tarefa a partir de conversa não existe no frontend, apenas via webhook externo.

### 4.5 Trigger de Tarefas

10. **Broadcast excessivo:** O trigger `notify_task_created` cria notificação para TODOS os perfis ativos, mesmo que a tarefa seja irrelevante para a maioria.
