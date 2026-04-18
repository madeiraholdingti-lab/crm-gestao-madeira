# Mapeamento de Cron Jobs e Edge Functions

> Gerado em: 22/03/2026

---

## 1. Cron Jobs Configurados (pg_cron)

| # | Nome do Job | Schedule | Intervalo Humano | Comando/Função |
|---|-------------|----------|------------------|----------------|
| 1 | `processar-disparos-agendados` | `* * * * *` | **A cada 1 minuto** | Chama edge function `processar-disparos-agendados` via `net.http_post` |
| 5 | `cleanup-deleted-tasks` | `0 3 * * *` | **Todo dia às 03:00 UTC (00:00 BRT)** | Executa `public.cleanup_deleted_tasks()` — limpa tarefas com soft-delete há +30 dias |
| 6 | `processar-lote-diario-8h` | `0 10 * * *` | **Todo dia às 10:00 UTC (07:00 BRT)** | Chama edge function `processar-lote-diario` via `net.http_post` |

**Total: 3 cron jobs**

---

## 2. Edge Functions — Mapeamento Completo

### Legenda de Tipos
- **webhook**: Recebe chamadas externas (Evolution API, n8n, Google Calendar)
- **cron**: Chamada por pg_cron em schedule fixo
- **frontend**: Chamada direta pelo frontend React
- **utilitária**: Função auxiliar ou administrativa, chamada pontualmente
- **api-externa**: Chamada por serviço externo (n8n, automações)

### Legenda de Frequência
- 🔴 **Alta**: Chamada frequentemente (a cada minuto, ou em cada interação do usuário)
- 🟡 **Média**: Chamada várias vezes ao dia
- 🟢 **Baixa**: Chamada raramente (ação administrativa, pontual)

---

### 2.1 — Webhooks (recebem dados externos)

| Função | Tipo | Freq. | Linhas | Queries Pesadas | Descrição |
|--------|------|-------|--------|-----------------|-----------|
| `evolution-webhook` | webhook | 🔴 Alta | 328 | Sim (múltiplos SELECTs, INSERTs, variações de telefone) | Webhook principal da Evolution API. Processa mensagens recebidas/enviadas, atualiza conversas, detecta disparos, processa status updates e connection updates |
| `evolution-messages-webhook` | webhook | 🔴 Alta | 965 | Sim (muitos JOINs, loops, upserts) | Webhook avançado de mensagens com parsing completo de mídia, contexto, metadados HTTP. Salva na tabela `messages` (modelo novo) |
| `n8n-inbound-webhook` | webhook | 🔴 Alta | 1419 | Sim (múltiplos SELECTs, INSERTs, loops complexos) | Recebe webhooks do n8n. Maior edge function do projeto. Processa mensagens, mídia, reações, edições, status updates |
| `n8n-instance-events` | webhook | 🟡 Média | 186 | Moderado (INSERT + SELECT) | Recebe eventos de instância do n8n (conexão, desconexão). Salva em `instance_events` e atualiza `instancias_whatsapp` |
| `n8n-disparo-callback` | webhook/api-externa | 🟡 Média | 911 | Sim (múltiplos SELECTs, UPDATEs, loops) | Callback do n8n após processar disparo. Atualiza status de envio, contadores de campanha |
| `calendar-webhook` | webhook | 🟢 Baixa | 104 | Leve (INSERT) | Recebe notificações do Google Calendar |
| `calendar-verify-callback` | webhook | 🟢 Baixa | 66 | Não | Callback de verificação OAuth do Google Calendar |
| `calendar-confirmed-callback` | webhook | 🟢 Baixa | 73 | Não | Callback de confirmação OAuth do Google Calendar |
| `taskflow-webhook` | webhook | 🟢 Baixa | — | Leve | Webhook externo para criar tarefas no TaskFlow |

---

### 2.2 — Cron (executadas por pg_cron)

| Função | Tipo | Freq. | Linhas | Queries Pesadas | Descrição |
|--------|------|-------|--------|-----------------|-----------|
| `processar-disparos-agendados` | cron | 🔴 Alta (1/min) | 435 | Sim (SELECT com filtros complexos, loops de envio, múltiplos UPDATEs) | Verifica `scheduled_messages` com `next_run_at <= now()`, envia via Evolution API, registra log, calcula próximo envio |
| `processar-lote-diario` | cron | 🟢 Baixa (1/dia) | 365 | Sim (SELECTs com JOINs, loops de processamento) | Processa lote diário de envios em massa. Seleciona leads pendentes, agenda envios do dia |

---

### 2.3 — Chamadas pelo Frontend

| Função | Tipo | Freq. | Linhas | Queries Pesadas | Descrição |
|--------|------|-------|--------|-----------------|-----------|
| `enviar-mensagem-evolution` | frontend | 🔴 Alta | 334 | Moderado (SELECT config, INSERT mensagem) | Envia mensagem de texto via Evolution API. Chamada a cada mensagem enviada pelo chat |
| `enviar-midia-evolution` | frontend | 🟡 Média | 274 | Moderado (SELECT config, INSERT mensagem) | Envia mídia (imagem, documento, áudio) via Evolution API |
| `marcar-mensagens-lidas` | frontend | 🟡 Média | 84 | Moderado (UPDATE em lote na `mensagens`, UPDATE em `conversas`) | Marca mensagens como lidas ao abrir conversa |
| `message-actions-evolution` | frontend | 🟡 Média | 363 | Moderado (SELECT + UPDATE) | Ações em mensagens: reagir, editar, deletar via Evolution API |
| `buscar-qrcode` | frontend | 🟡 Média | 116 | Leve (SELECT config) | Busca QR Code de uma instância Evolution para conexão |
| `verificar-status-evolution` | frontend | 🟡 Média | — | Leve | Verifica status de conexão de uma instância |
| `conectar-evolution` | frontend | 🟢 Baixa | 151 | Leve | Conecta uma instância à Evolution API |
| `desconectar-evolution` | frontend | 🟢 Baixa | 168 | Leve | Desconecta instância da Evolution API |
| `reiniciar-instancia-evolution` | frontend | 🟢 Baixa | 169 | Leve | Reinicia instância na Evolution API |
| `criar-instancia-evolution` | frontend | 🟢 Baixa | 163 | Leve (INSERT) | Cria nova instância na Evolution API e salva no banco |
| `deletar-instancia-evolution` | frontend | 🟢 Baixa | 151 | Leve (DELETE) | Remove instância da Evolution API e do banco |
| `listar-instancias-evolution` | frontend | 🟢 Baixa | 103 | Leve (SELECT) | Lista instâncias da Evolution API |
| `configurar-webhook-evolution` | frontend | 🟢 Baixa | 189 | Leve | Configura webhook de uma instância na Evolution API |
| `buscar-webhooks-instancias` | frontend | 🟢 Baixa | 91 | Leve | Busca configuração de webhooks das instâncias |
| `testar-evolution` | frontend | 🟢 Baixa | — | Não | Testa conexão com a Evolution API |
| `gerar-variacao-mensagem` | frontend | 🟡 Média | 155 | Leve | Gera variação de mensagem usando IA para disparos |
| `processar-envios-massa` | frontend | 🟡 Média | 554 | Sim (SELECT com JOINs, loops, múltiplos INSERTs) | Inicia processamento de envios em massa para uma campanha |
| `processar-disparo-direto` | frontend | 🟡 Média | 474 | Sim (SELECT com filtros, loops de envio) | Processa disparo direto (sem n8n) — envia via Evolution API |
| `notificar-transferencia` | frontend | 🟢 Baixa | 111 | Leve (INSERT notificação) | Cria notificação ao transferir conversa entre responsáveis |
| `notificar-delegacao` | frontend | 🟢 Baixa | 109 | Não | Notifica delegação de conversa |
| `notificar-disparo` | frontend | 🟢 Baixa | 73 | Leve (INSERT) | Cria notificação sobre status de disparo |
| `gerar-relatorio-crm` | frontend | 🟢 Baixa | 424 | Sim (múltiplos COUNTs, GROUP BY, JOINs) | Gera relatório completo do CRM com métricas |
| `relatorio-imagem` | frontend | 🟢 Baixa | 375 | Sim (COUNTs, agregações) | Gera relatório em formato de imagem |
| `exportar-leads-enviados` | frontend | 🟢 Baixa | 111 | Moderado (SELECT com JOINs) | Exporta leads enviados em uma campanha |
| `verificar-disparos-enviados` | frontend | 🟢 Baixa | — | Moderado | Verifica status dos disparos enviados |

---

### 2.4 — Administrativas / Utilitárias

| Função | Tipo | Freq. | Linhas | Queries Pesadas | Descrição |
|--------|------|-------|--------|-----------------|-----------|
| `criar-usuario` | frontend/admin | 🟢 Baixa | 102 | Leve (auth.admin.createUser) | Cria novo usuário no sistema (admin only) |
| `atualizar-role-usuario` | frontend/admin | 🟢 Baixa | 88 | Leve (UPDATE/INSERT em user_roles) | Atualiza role de um usuário |
| `atualizar-senha-usuario` | frontend/admin | 🟢 Baixa | 80 | Leve (auth.admin.updateUserById) | Admin reseta senha de um usuário |
| `reset-user-password` | frontend | 🟢 Baixa | 98 | Não (auth.admin) | Reset de senha via link |
| `listar-usuarios-admin` | frontend/admin | 🟢 Baixa | 55 | Leve (auth.admin.listUsers) | Lista todos os usuários do auth |
| `restaurar-perfis` | utilitária | 🟢 Baixa | — | Moderado | Restaura perfis faltantes no banco |
| `sincronizar-fotos-contatos` | utilitária | 🟢 Baixa | — | Sim (loop de contatos, chamadas à Evolution API) | Sincroniza fotos de perfil dos contatos via Evolution API |
| `sincronizar-nomes-contatos` | utilitária | 🟢 Baixa | — | Sim (loop de contatos) | Sincroniza nomes dos contatos via Evolution API |
| `sincronizar-contato-individual` | utilitária | 🟢 Baixa | — | Leve | Sincroniza um único contato com a Evolution API |
| `sincronizar-historico-mensagens` | utilitária | 🟢 Baixa | — | Sim (busca e insere histórico completo) | Sincroniza histórico de mensagens de uma instância |
| `buscar-script-ia` | api-externa | 🟡 Média | 61 | Leve (2 SELECTs) | API pública para buscar script de IA por ID (usada pelo n8n) |
| `taskflow-lembrar-maikon` | api-externa | 🟢 Baixa | 90 | Leve (SELECT filtrado) | API com auth por API key — retorna tarefas do dia para lembrete |

---

## 3. Resumo de Impacto

### Funções com maior carga no banco (atenção especial):

| Função | Linhas | Motivo |
|--------|--------|--------|
| `n8n-inbound-webhook` | 1419 | Maior função, processa todos os eventos do n8n com muitos loops e queries |
| `evolution-messages-webhook` | 965 | Parsing pesado de mensagens com múltiplos upserts |
| `n8n-disparo-callback` | 911 | Callback complexo com múltiplas atualizações |
| `processar-envios-massa` | 554 | Loops de envio com múltiplos INSERTs |
| `processar-disparo-direto` | 474 | Similar ao envios-massa mas sem n8n |
| `processar-disparos-agendados` | 435 | Roda a cada minuto — maior impacto contínuo |
| `gerar-relatorio-crm` | 424 | Múltiplos COUNTs e agregações |

### Cron jobs — frequência de execução:

| Job | Frequência | Impacto |
|-----|-----------|---------|
| `processar-disparos-agendados` | 1x/min | 🔴 Alto — roda continuamente mesmo sem disparos pendentes |
| `cleanup-deleted-tasks` | 1x/dia | 🟢 Baixo — DELETEs pontuais |
| `processar-lote-diario-8h` | 1x/dia | 🟢 Baixo — processamento batch |

### Observações importantes:

1. **Dois modelos de mensagens coexistindo**: `evolution-webhook` salva em `mensagens` (modelo antigo), enquanto `evolution-messages-webhook` e `n8n-inbound-webhook` salvam em `messages` (modelo novo). Ambos recebem webhooks simultaneamente.

2. **`processar-disparos-agendados`** roda a cada minuto mesmo quando não há disparos — considerar otimização com early-return rápido.

3. **`n8n-inbound-webhook`** é a maior função (1419 linhas) e deveria ser refatorada em módulos menores.

4. **Funções de sincronização** (`sincronizar-fotos`, `sincronizar-nomes`, `sincronizar-historico`) fazem loops potencialmente grandes — devem ser executadas com cuidado para não exceder timeout de 60s.
