# Módulo de Configurações — Manual Operacional e Técnico

> Última atualização: 2026-03-22

---

## PARTE 1 — INSTÂNCIAS WHATSAPP (`/zaps`)

### 1.1 Visão Geral

A página `ConfiguracaoEvolution.tsx` (1262 linhas) gerencia instâncias WhatsApp via Evolution API. Organizada em **3 tabs**:

| Tab | Componente | Descrição |
|---|---|---|
| Config Evolution | Inline | Cards de instâncias com status em tempo real |
| Config Geral | `ConfigGeralSection` | URLs de webhook, Evolution API key/URL |
| Config IA | `ConfigIASection` | Ativação de IA por instância |

---

### 1.2 Criação de uma Instância

**Fluxo:**

```
1. Usuário clica "Nova Instância"
2. Preenche: nome_instancia, token_instancia (opcional), tipo_canal, numero_chip, cor_identificacao
3. Frontend chama edge function `criar-instancia-evolution`:
   - POST para Evolution API: POST /instance/create
   - Payload: { instanceName, token, integration: "WHATSAPP-BAILEYS" }
4. Evolution API retorna: instanceId (UUID) + opcionalmente QR Code base64
5. Frontend salva no banco (tabela `instancias_whatsapp`):
   - instancia_id = UUID retornado pela Evolution
   - ativo = false (ainda não conectada)
6. Se QR Code veio na resposta, abre modal automaticamente
```

**Edge Functions envolvidas:**
- `criar-instancia-evolution`: Cria instância na Evolution API

**Cores disponíveis:** 8 opções pré-definidas (azul, vermelho, verde, roxo, laranja, ciano, magenta, índigo)

---

### 1.3 Fluxo de Conexão (QR Code)

```
Criar instância
    ↓
QR Code gerado (base64)
    ↓
Modal QRCodeModal abre com imagem
    ↓
Polling a cada 1s (até 2 min / 120 tentativas)
    ↓
Chama `listar-instancias-evolution` para verificar status
    ↓
Se connectionStatus === "open" E ownerJid válido:
    ↓
Chama `configurar-webhook-evolution` automaticamente
    ↓
Modal mostra "Sucesso!" → fecha após 2s
    ↓
Lista de instâncias atualizada
```

**Estados do QR Code Modal (`QRCodeStatus`):**
- `loading` — Gerando QR Code
- `waiting` — QR Code exibido, aguardando scan
- `success` — Conectado com sucesso
- `error` — Erro na geração/conexão
- `timeout` — 2 minutos sem conexão

**Reconexão de instância desconectada:**
1. Primeiro tenta `reiniciar-instancia-evolution` (PUT /instance/restart/{name})
2. Se não retorna QR, tenta `conectar-evolution` (GET /instance/connect/{name})
3. Se ambos falham, exibe erro com botão "Tentar Novamente"

---

### 1.4 Configuração de Webhooks

Após conexão bem-sucedida, o sistema **automaticamente** configura o webhook da instância:

```
Edge function: configurar-webhook-evolution
    ↓
Busca webhook_url de config_global
    ↓
PUT para Evolution API: /webhook/set/{instanceName}
    ↓
Payload: { url: webhookUrl, webhook_by_events: false, webhook_base64: true, events: [...] }
    ↓
Eventos configurados: MESSAGES_UPSERT, MESSAGES_UPDATE, QRCODE_UPDATED, CONNECTION_UPDATE, etc.
```

**Webhook Base64:** O sistema tenta ativar `webhook_base64 = true` para receber mídia em base64. A UI mostra visualmente se base64 está ativo ou não para cada instância.

**Reconfiguração manual:** Botão "Configurar Webhook" disponível em cada card de instância para reconfigurar manualmente.

**Pré-requisito:** A `webhook_url` deve estar configurada na tab "Config Geral". Se não estiver, o frontend exibe alerta e impede a criação de instâncias.

---

### 1.5 Desconexão de Instância

Quando uma instância desconecta (WhatsApp deslogado, telefone sem internet, etc.):

1. **Detecção:** O `fetchInstancias()` consulta `listar-instancias-evolution` e compara `connectionStatus`
2. **Sincronização:** Se instância existe no banco mas NÃO existe na Evolution API → marca `status = 'deletada'`
3. **Visual:** Card mostra `WifiOff` com badge "Desconectada"
4. **Ação:** Usuário pode clicar "Conectar" para gerar novo QR Code (usa fluxo de reconexão)

**Importante:** Instância desconectada ≠ deletada. A instância permanece no banco com todos os dados até ser explicitamente deletada.

---

### 1.6 Ações Disponíveis

| Ação | Edge Function | O que faz |
|---|---|---|
| **Conectar** | `conectar-evolution` / `reiniciar-instancia-evolution` | Gera QR Code para scan |
| **Reiniciar** | `reiniciar-instancia-evolution` | PUT /instance/restart — reinicia sem deletar |
| **Desconectar** | `desconectar-evolution` | DELETE /instance/logout — desloga WhatsApp |
| **Deletar** | `deletar-instancia-evolution` | Remove da Evolution API + marca `status = 'deletada'` no banco |
| **Testar Conexão** | `testar-evolution` | Verifica se instância responde |
| **Configurar Webhook** | `configurar-webhook-evolution` | (Re)configura webhook na Evolution |
| **Editar** | Direto no banco | Altera nome, cor, número do chip |
| **Ativar IA** | `configurar-webhook-evolution` (com URL de IA) | Troca webhook para `webhook_ia_respondendo` |

**Permissões:** Apenas `admin_geral`, `medico` e `secretaria_medica` podem gerenciar instâncias (RLS). Delete requer confirmação via `AlertDialog`.

---

### 1.7 Tab Config IA

Gerencia quais instâncias têm IA ativa (respostas automáticas):

- Busca `webhook_ia_respondendo` de `config_global`
- Para cada instância, verifica se o webhook configurado na Evolution é igual ao de IA
- Instâncias com IA: fundo preto, texto branco, selo roxo "IA Ativada"
- **Ativar IA:** Reconfigura webhook da instância para o URL de IA
- **Desativar IA:** Reconfigura webhook para o URL padrão (com confirmação)

---

## PARTE 2 — USUÁRIOS (`/usuarios`)

### 2.1 Fluxo de Criação de Usuário

```
Admin clica "Novo Usuário"
    ↓
Preenche: nome, email, senha, telefone, role, instância padrão, ativo
    ↓
Frontend chama edge function `criar-usuario`:
    - Cria usuário no Auth (admin.auth.createUser)
    - Trigger `handle_new_user` cria perfil em `profiles` (ativo = false por padrão)
    - Edge function atribui role em `user_roles`
    - Opcionalmente vincula instância padrão
    ↓
Usuário aparece na tabela
```

**Campos do formulário:**

| Campo | Obrigatório | Descrição |
|---|---|---|
| Nome | Sim | Nome do usuário |
| Email | Sim (criação) | Email para login |
| Senha | Sim (criação, ≥6 chars) | Senha inicial |
| Telefone | Não | Telefone de contato |
| Role | Sim | Dropdown com 5 opções |
| Instância Padrão | Não | WhatsApp vinculado |
| Ativo | Sim | Switch on/off |

---

### 2.2 Aprovação de Usuário

O sistema usa um modelo de **aprovação manual**:

1. Quando um usuário se cadastra (signup), o trigger `handle_new_user` cria o perfil com `ativo = false`
2. **Nenhuma role é atribuída automaticamente** (comentado no trigger)
3. Admin acessa `/usuarios`, vê o usuário com "Sem role" e inativo
4. Admin edita, atribui role e ativa (`ativo = true`)
5. Página `/aguardando-aprovacao` é exibida para usuários sem role

**Rota de espera:** `AguardandoAprovacao.tsx` — tela informativa para usuários pendentes.

---

### 2.3 Atribuição de Roles

**Roles disponíveis:**

| Role | Label UI | Acesso |
|---|---|---|
| `admin_geral` | Admin Geral | Tudo |
| `medico` | Médico | SDR Zap, Contatos, TaskFlow, Disparos, Relatórios, IA |
| `secretaria_medica` | Secretária | SDR Zap, Contatos, TaskFlow, Disparos, Relatórios, IA |
| `administrativo` | Administrativo | SDR Zap, Contatos, TaskFlow, Disparos, Relatórios, IA |
| `disparador` | Disparador | Home, SDR Zap, Disparos em Massa, Config Zaps, Perfil |

**Fluxo técnico de alteração de role:**
1. Frontend chama edge function `atualizar-role-usuario`
2. Edge function usa `service_role` para UPSERT em `user_roles`
3. Tabela `user_roles` armazena: `user_id` + `role` (enum `app_role`)

**Outras ações admin:**
- **Ativar/Desativar:** Toggle direto em `profiles.ativo`
- **Reset de senha:** Edge function `reset-user-password` → envia email de redefinição via Auth
- **Filtros:** Busca por nome/email + filtro por role

---

### 2.4 Instância Padrão

Cada usuário pode ter uma **instância padrão** (`profiles.instancia_padrao_id`):

- FK para `instancias_whatsapp.id`
- Usada como instância padrão no SDR Zap para enviar mensagens
- Selecionável no modal de edição do usuário (dropdown com instâncias ativas)
- Visível na tabela de usuários (nome + número do chip)
- Atualizada em tempo real via Supabase Realtime (canal `instancias-changes`)

**Dados combinados na listagem:**
- `profiles` — dados do usuário
- `user_roles` — role
- `instancias_whatsapp` — nome e número da instância padrão
- `listar-usuarios-admin` (edge function) — email do Auth

---

## PARTE 3 — CONTEXTO IA (`/contexto-ia`)

### 3.1 O que são Scripts de IA

Scripts de IA são **modelos de contexto** para respostas automáticas do WhatsApp. Cada script define o "personagem" e as perguntas que a IA deve fazer ao interagir com um lead.

**Tabela:** `ia_scripts`

**Campos do script:**

| Campo | Tipo | Descrição |
|---|---|---|
| `nome` | text | Nome identificador (ex: "Vaga Plantão Cardio Joinville") |
| `descricao_vaga` | text | Descrição detalhada da vaga/contexto |
| `tipo_vaga` | text | Enum: `plantao`, `por_hora`, `por_producao` |
| `presencial` | boolean | Se a vaga é presencial |
| `necessario_mudar` | boolean | Se é necessário mudar de cidade |
| `detalhes_vaga` | text[] | Array de gatilhos/detalhes adicionais |
| `ativo` | boolean | Se o script está ativo |

---

### 3.2 Perguntas Associadas

Cada script tem **perguntas ordenadas** que a IA deve fazer ao lead:

**Tabela:** `ia_script_perguntas`

| Campo | Descrição |
|---|---|
| `script_id` | FK para `ia_scripts.id` |
| `pergunta` | Texto da pergunta |
| `ordem` | Número sequencial (0, 1, 2...) |
| `obrigatoria` | Se a IA deve insistir na resposta |

**Na UI:**
- Perguntas são gerenciadas inline no modal de edição
- Botão "Adicionar pergunta" + campo de texto + checkbox "Obrigatória"
- Reordenação pela ordem de adição
- Ao salvar: DELETE ALL perguntas do script + INSERT novas (replace completo)

**Detalhes da vaga:**
- Array de strings livres (ex: "Salário R$ 5.000", "Plantão 12h")
- Adicionados um a um via campo de texto + botão "+"
- Removíveis com "X"

---

### 3.3 Uso nas Campanhas de Disparo

Cada campanha de disparo em massa (`campanhas_disparo`) tem um campo `script_ia_id`:

```
campanhas_disparo.script_ia_id → ia_scripts.id
```

**Fluxo:**
1. Ao criar campanha, usuário seleciona um script de IA
2. Quando o n8n processa o lead e a IA começa a responder, busca o script via `buscar-script-ia?id=<id>`
3. A IA usa a descrição, perguntas e metadados para conduzir a conversa

**Endpoint público:** `GET /functions/v1/buscar-script-ia?id=<uuid>`
- Sem verificação de JWT (acessível por automações externas)
- Retorna: script completo + array de perguntas ordenadas

---

### 3.4 Edge Function `gerar-variacao-mensagem`

**O que faz:** Gera variações de uma mensagem de campanha para evitar que o WhatsApp identifique como spam.

**Input (POST):**
```json
{
  "mensagemBase": "Olá {nome}, temos uma vaga...",
  "tipoCampanha": "promocional" | "relacionamento" | "reativacao",
  "quantidade": 5
}
```

**Funcionamento:**
1. Busca `gemini_api_key` de `config_global` (⚠️ coluna NÃO existe atualmente no schema — possível bug)
2. Monta prompt para Gemini 2.0 Flash com regras:
   - Manter significado, variar estrutura
   - Preservar `{nome}` para personalização
   - Tom adequado ao tipo de campanha
   - Variações naturais (emojis, aberturas, fechamentos)
3. Chama API Gemini diretamente (não usa Lovable AI gateway)
4. Parseia JSON da resposta: `{ "variacoes": ["msg1", "msg2", ...] }`
5. Retorna array de variações

**⚠️ Nota:** Esta edge function usa API Gemini diretamente com key armazenada no banco, não o Lovable AI gateway. A coluna `gemini_api_key` pode não existir em `config_global`, o que causaria erro.

---

## PARTE 4 — DISPAROS AUTOMÁTICOS (`/disparos-automaticos`)

### 4.1 Diferença: Automáticos vs Em Massa

| Aspecto | Disparos Automáticos | Disparos em Massa |
|---|---|---|
| **Tabela** | `scheduled_messages` | `campanhas_disparo` + `campanha_envios` |
| **Destino** | 1 contato específico | Lista de leads (milhares) |
| **Frequência** | Recorrente (diário/semanal/mensal) | Uma vez (ou por envio) |
| **Processamento** | Cron a cada 1 minuto | n8n webhook em lotes |
| **Mensagem** | Fixa (texto único) | Com variações IA |
| **Uso** | Lembrete periódico a contato específico | Prospecção em massa |
| **Exemplo** | "Bom dia Dr. Silva" todo dia 8h | Disparo para 5000 médicos |

---

### 4.2 Criação de um Disparo Agendado

**Componente:** `DisparoForm.tsx` (490 linhas)

**Campos:**

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `nome_disparo` | text | Sim | Identificação do disparo |
| `instance_id` | uuid | Sim | Instância WhatsApp para envio |
| `phone` | text | Sim | Telefone destino (com busca de contatos) |
| `contact_id` | uuid | Não | Contato vinculado (preenchido automaticamente) |
| `message_text` | text | Sim | Mensagem a enviar (máx 1000 chars) |
| `frequency` | enum | Sim | `once`, `daily`, `weekly`, `monthly` |
| `send_time` | time | Sim | Horário de envio (HH:MM) |
| `week_days` | int[] | Se weekly | Dias da semana (0=Dom a 6=Sáb) |
| `month_day` | int | Se monthly | Dia do mês (1-31) |

**Busca de contatos:**
- Campo de telefone com busca em `contacts` por nome ou telefone
- Ao selecionar contato, preenche `phone` e `contact_id` automaticamente

**Cálculo de `next_run_at`:**
- Usa function SQL `calculate_next_run()` no banco
- Considera timezone America/Sao_Paulo
- Calcula próximo horário válido baseado na frequência

**Validação:** Schema Zod no frontend antes do envio.

---

### 4.3 Frequências Suportadas

| Frequência | Comportamento | Campos extras |
|---|---|---|
| `once` | Executa uma única vez, depois fica inativo | Nenhum |
| `daily` | Todo dia no horário definido | Nenhum |
| `weekly` | Nos dias da semana selecionados | `week_days` (array de 0-6) |
| `monthly` | Uma vez por mês no dia definido | `month_day` (1-31) |

**Para `monthly`:** Se o dia não existe no mês (ex: 31 de fevereiro), usa o último dia do mês.

---

### 4.4 Cron de Processamento

**Cron job:** `processar-disparos-agendados` — executa a cada 1 minuto

**Edge function:** `supabase/functions/processar-disparos-agendados/index.ts` (455 linhas)

**Fluxo:**

```
Cron dispara a cada minuto
    ↓
Busca scheduled_messages onde:
  - active = true
  - next_run_at <= NOW()
    ↓
Para cada disparo encontrado:
    ↓
Busca config_global (evolution_base_url, evolution_api_key)
    ↓
Busca instancias_whatsapp para obter nome da instância
    ↓
Envia mensagem via Evolution API:
  POST {baseUrl}/message/sendText/{instanceName}
  Body: { number: phone, text: message_text }
    ↓
Registra log em scheduled_messages_log:
  - success: true/false
  - wa_message_id (se sucesso)
  - error_message (se falha)
    ↓
Atualiza scheduled_messages:
  - last_run_at = NOW()
  - next_run_at = calculateNextRunBrazil(...)
  - Se frequency = "once" → active = false
```

**Cálculo de next_run (edge function):**
- Implementado em TypeScript (duplicado da function SQL)
- Usa offset UTC-3 para timezone do Brasil
- Para `once`: retorna null (não recalcula)
- Para `weekly`: encontra próximo dia válido na lista
- Para `monthly`: ajusta para último dia do mês se necessário

**Realtime:** A página escuta mudanças em `scheduled_messages` e `scheduled_messages_log` para atualizar automaticamente.

---

### 4.5 Ações na UI

| Ação | Descrição |
|---|---|
| **Criar** | Modal com `DisparoForm` |
| **Editar** | Mesmo modal, pré-preenchido |
| **Ativar/Pausar** | Toggle `active` (com ícone Play/Pause) |
| **Deletar** | Com confirmação, remove do banco |

**Informações exibidas por card:**
- Nome + badge de frequência
- Instância de envio
- Telefone/contato destino
- Horário + dias da semana (se weekly)
- Próximo envio (`next_run_at` em timezone Brasil)
- Status do último envio (✅ Enviado / ❌ Falha / ⚠️ Nunca executado)

---

## Resumo de Tabelas por Módulo

### Instâncias WhatsApp
| Tabela | Uso |
|---|---|
| `instancias_whatsapp` | Dados locais das instâncias |
| `config_global` | Evolution API URL/key, webhooks |

### Usuários
| Tabela | Uso |
|---|---|
| `profiles` | Dados do perfil (nome, telefone, instância padrão) |
| `user_roles` | Role do usuário (enum app_role) |
| `instancias_whatsapp` | Referência para instância padrão |

### Contexto IA
| Tabela | Uso |
|---|---|
| `ia_scripts` | Scripts de IA |
| `ia_script_perguntas` | Perguntas de cada script |
| `campanhas_disparo` | Referência via `script_ia_id` |

### Disparos Automáticos
| Tabela | Uso |
|---|---|
| `scheduled_messages` | Configuração dos disparos |
| `scheduled_messages_log` | Histórico de execuções |
| `contacts` | Busca de contato por nome/telefone |
| `instancias_whatsapp` | Instância de envio |

---

## Edge Functions Envolvidas

| Função | Módulo | Tipo |
|---|---|---|
| `criar-instancia-evolution` | Instâncias | Frontend |
| `conectar-evolution` | Instâncias | Frontend |
| `reiniciar-instancia-evolution` | Instâncias | Frontend |
| `desconectar-evolution` | Instâncias | Frontend |
| `deletar-instancia-evolution` | Instâncias | Frontend |
| `configurar-webhook-evolution` | Instâncias | Frontend |
| `listar-instancias-evolution` | Instâncias | Frontend (polling) |
| `testar-evolution` | Instâncias | Frontend |
| `buscar-webhooks-instancias` | Instâncias/IA | Frontend |
| `criar-usuario` | Usuários | Frontend |
| `atualizar-role-usuario` | Usuários | Frontend |
| `listar-usuarios-admin` | Usuários | Frontend |
| `reset-user-password` | Usuários | Frontend |
| `buscar-script-ia` | IA | Webhook (sem JWT) |
| `gerar-variacao-mensagem` | IA/Disparos | Frontend |
| `processar-disparos-agendados` | Disparos Auto | Cron (1 min) |
