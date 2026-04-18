# Módulo Disparos em Massa — Manual Operacional

> **Última atualização:** Março/2026  
> **Rota base:** `/disparos-em-massa`

---

## Índice

1. [Visão Geral e Fluxo Completo](#1-visão-geral-e-fluxo-completo)
2. [Página de Leads](#2-página-de-leads)
3. [Página de Campanhas](#3-página-de-campanhas)
4. [Página de Envios](#4-página-de-envios)
5. [Blacklist](#5-blacklist)
6. [Fluxo Técnico (Campanha → n8n → Callback)](#6-fluxo-técnico)
7. [Limites Configuráveis](#7-limites-configuráveis)

---

## 1. Visão Geral e Fluxo Completo

O módulo de Disparos em Massa permite enviar mensagens WhatsApp em escala para uma base de leads, com controle anti-bloqueio, integração com IA e rastreamento de status.

### Fluxo passo a passo:

```
1. IMPORTAR LEADS
   └─ CSV / XLSX / Manual → tabela `leads`
   └─ Validação de telefone (formato 55DDDXXXXXXXXX)
   └─ Classificação por tipo_lead + especialidade

2. CRIAR CAMPANHA
   └─ Nome, mensagem, tipo, filtros
   └─ Vincular script de IA (obrigatório)
   └─ Tabela `campanhas_disparo`

3. CRIAR ENVIO (DISPARO)
   └─ Selecionar campanha + instância WhatsApp
   └─ Selecionar leads (com exclusões automáticas)
   └─ Registra em `envios_disparo` + `campanha_envios`

4. AGENDAR OU ENVIAR
   └─ Envio manual: botão "Enviar Agora" → `processar-envios-massa`
   └─ Envio automático: cron `processar-lote-diario` às 10h UTC (8h BRT)

5. PROCESSAMENTO
   └─ Edge function seleciona lote de até 70 leads
   └─ Marca como "tratando", valida números, exclui blacklist
   └─ Envia payload JSON ao webhook n8n (`webhook_ia_disparos`)

6. n8n PROCESSA
   └─ Envia mensagens via Evolution API
   └─ Para cada lead: chama callback com status

7. CALLBACK
   └─ `n8n-disparo-callback` recebe status de cada lead
   └─ Atualiza `campanha_envios` (enviado/erro/NoZap)
   └─ Sinaliza fim do lote → dispara próximo lote automaticamente
   └─ Atualiza contadores em `envios_disparo` e `campanhas_disparo`

8. CONCLUSÃO
   └─ Quando não restam leads pendentes → status "concluido"
   └─ Notificação in-app para o criador do disparo
```

---

## 2. Página de Leads

**Rota:** `/disparos-em-massa/leads`  
**Componente:** `src/pages/disparos/Leads.tsx`

### 2.1 Campos de cada lead

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| `telefone` | ✅ | Formato brasileiro: 55DDDXXXXXXXXX (13 dígitos) |
| `nome` | Não | Nome do lead |
| `email` | Não | Email de contato |
| `tipo_lead` | Não | Classificação (médico, paciente, etc.) — default: "novo" |
| `especialidade_id` | Não | Especialidade primária (FK para `especialidades`) |
| `especialidades_secundarias` | Não | Via tabela `lead_especialidades_secundarias` |
| `origem` | Não | De onde veio (importacao, manual, etc.) |
| `tags` | Não | Array de tags livres |
| `anotacoes` | Não | Texto livre |
| `ativo` | — | Default: true |
| `dados_extras` | Não | JSON livre para metadados |

### 2.2 Importação

#### Formatos aceitos:
- **CSV** (separador `;` ou `,`, encoding UTF-8 com BOM)
- **XLSX** (planilha Excel)

#### Colunas do arquivo:
- `nome`, `telefone`, `email`, `anotacoes`
- **Tipo de lead** e **Especialidade** são definidos globalmente no modal de prévia (não por linha)

#### Template CSV disponível:
```csv
nome;telefone;email;anotacoes
João da Silva;5511999887766;joao@email.com;Lead interessado
```

#### Processo de importação:
1. Upload do arquivo → parse no frontend
2. **Prévia** mostra leads válidos vs inválidos (telefone)
3. Usuário seleciona tipo_lead e especialidade globais
4. Importação em lotes de 100 (com progress bar)
5. **Deduplicação:** verifica telefones já existentes no banco
6. **Resultado:** dialog com contagem (importados, duplicados banco, duplicados arquivo, inválidos, erros)
7. Registro em `lead_importacoes` (histórico)

#### Validação de telefone:
- Aceita formatos variados na entrada (com/sem DDI, com/sem 9º dígito)
- Normaliza para 13 dígitos: `55` + DDD (2) + `9` + número (8)
- Valida DDDs brasileiros contra lista oficial
- Rejeita números sem DDD, fixos, ou com tamanho incorreto

### 2.3 Cadastro manual
- Dialog com campos: nome, telefone, email, tipo_lead, especialidade primária + secundárias, origem, anotações
- Especialidades usam combobox pesquisável (Popover + Command)
- Tipo de lead pode ser criado ad-hoc

### 2.4 Filtros e busca
- **Busca textual:** por nome, telefone ou email (debounce 500ms)
- **Filtro por tipo de lead:** dropdown com tipos do banco (`tipos_lead`)
- **Filtro por especialidade:** multi-select com especialidades do banco
- **Ordenação:** Recentes (padrão), A-Z, Z-A
- **Paginação:** 50 leads por página

### 2.5 Ações
- **Editar lead:** abre dialog com campos preenchidos
- **Ver detalhes:** abre `LeadDetailDialog` com histórico de campanhas, comentários e anexos
- **Reprocessar telefones:** valida e reformata todos os telefones no banco
- **Deletar todos:** remove todos os leads (somente admin)

---

## 3. Página de Campanhas

**Rota:** `/disparos-em-massa/campanhas`  
**Componente:** `src/pages/disparos/Campanhas.tsx`

### 3.1 Criação de campanha

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| `nome` | ✅ | Nome da campanha |
| `mensagem` | ✅ | Texto da mensagem (suporta variáveis) |
| `tipo` | ✅ | Tipo de campanha (ver abaixo) |
| `descricao` | Não | Descrição interna |
| `script_ia_id` | ✅ | Script de atendimento da IA |
| `filtro_tipo_lead` | Não | Array de tipos de lead para filtro |
| `instancia_id` | Não | Instância WhatsApp padrão |

### 3.2 Tipos de campanha

| Tipo | Descrição |
|------|-----------|
| `relacionamento` | Manter contato com clientes existentes |
| `captacao` | Atrair novos leads e clientes |
| `reativacao` | Recuperar leads inativos |
| `promocional` | Divulgar ofertas e promoções |
| `informativo` | Comunicados e informativos |
| `pesquisa` | Pesquisas de satisfação |

### 3.3 Integração com Scripts de IA

- **Obrigatório:** toda campanha deve ter um `script_ia_id` vinculado
- Scripts vêm da página `/contexto-ia` (tabela `ia_scripts`)
- O script fornece contexto para a IA responder automaticamente quando leads respondem
- Inclui: descrição da vaga, perguntas, tipo de vaga, detalhes
- Endpoint GET público: `/functions/v1/buscar-script-ia?id=<id>` (usado pelo n8n)

### 3.4 Filtro por tipo de lead na campanha

- Multi-select de tipos de lead (`tipos_lead` do banco)
- Armazenado em `filtro_tipo_lead` (array de strings)
- Usado como referência para seleção de leads nos envios

### 3.5 Status da campanha

| Status | Significado |
|--------|-------------|
| `rascunho` | Campanha criada, sem envios |
| `em_andamento` | Possui envios ativos |
| `concluida` | Todos os envios finalizados |
| `pausada` | Envios pausados |
| `cancelada` | Campanha cancelada |

### 3.6 Realtime

- Canal `campanhas-realtime` escuta INSERT/UPDATE/DELETE em `campanhas_disparo`
- Contadores atualizam automaticamente via callback do n8n

---

## 4. Página de Envios

**Rota:** `/disparos-em-massa/envios`  
**Componente:** `src/pages/disparos/Envios.tsx`

### 4.1 O que é um Envio

Um **envio** (`envios_disparo`) é uma execução concreta de uma campanha. Uma campanha pode ter **vários envios** (com instâncias ou leads diferentes).

### 4.2 Criar novo envio

1. Selecionar campanha
2. Selecionar instância WhatsApp
3. Selecionar leads (com filtros por tipo e especialidade)
4. Sistema calcula dias necessários (total ÷ 70/dia)

#### Regras de exclusão de leads na seleção:

| Regra | Escopo | Descrição |
|-------|--------|-----------|
| **Blacklist global** | Permanente | Leads na `lead_blacklist` nunca aparecem |
| **Mesma campanha** | Permanente | Lead já associado à campanha (qualquer envio) é excluído |
| **Cooldown 7 dias** | Temporário | Lead que participou de OUTRA campanha nos últimos 7 dias é excluído |
| **Envio atual** | Exceção | Leads do envio sendo editado continuam visíveis |

#### Limite por envio:
- Máximo de **350 leads** por envio
- DOM virtual limita exibição a 200 leads na lista de seleção

### 4.3 Status dos leads (campanha_envios)

| Status | Cor | Significado |
|--------|-----|-------------|
| `enviar` | 🔵 Azul | Pronto para envio, aguardando processamento |
| `reenviar` | 🟠 Laranja | Falhou, será reenviado (até 3 tentativas) |
| `tratando` | 🟣 Roxo (pulsa) | Em processamento pelo n8n |
| `enviado` | 🟢 Verde | Mensagem enviada com sucesso |
| `contatado` | 🩵 Teal | Contato já realizado (status manual ou via callback) |
| `NoZap` | 🔴 Vermelho | Número inválido / sem WhatsApp |
| `erro` | 🔴 Vermelho | Erro no envio (limite de tentativas, webhook falhou) |
| `cancelado` | ⚪ Cinza | Cancelado (disparo desativado pelo usuário) |
| `bloqueado` | 🟠 Laranja escuro | Lead na blacklist detectado em runtime |

### 4.4 Status do envio (envios_disparo)

| Status | Significado |
|--------|-------------|
| `pendente` | Criado, sem leads ou sem agendamento |
| `agendada` | Agendado para data/hora futura |
| `em_andamento` | Processamento em andamento |
| `concluido` | Todos os leads processados |
| `pausado` | Pausado (manual ou por falha de instância) |
| `cancelado` | Cancelado |

### 4.5 Reenvio de falhas

- Leads com status `reenviar` são reprocessados automaticamente no próximo lote
- Limite de **3 tentativas** por lead (`tentativas` na `campanha_envios`)
- Ao atingir 3 tentativas → status muda para `erro`
- Botão **"Limpar tratando"** reverte leads presos em `tratando` para `reenviar`

### 4.6 Ativar/Desativar envio

- **Desativar:** muda `ativo = false`, leads pendentes mudam para `cancelado` (não deleta)
- **Reativar:** muda `ativo = true`, leads `cancelado` voltam para `reenviar`
- Preserva constraint UNIQUE (lead_id, campanha_id) e histórico de cooldown

### 4.7 Agendamento

- Selecionar data e hora de início
- Horário no fuso America/Sao_Paulo
- Envio automático processado pelo cron `processar-lote-diario`

### 4.8 Envio manual

- Botão **"Enviar Agora"** chama `processar-envios-massa`
- Guard `enviandoIds` previne duplo-clique
- Toast informa progresso

### 4.9 Tabela expandida de leads

- Cada card de envio expande para mostrar tabela de leads
- Colunas: Nome, Telefone, Status (dropdown editável)
- Busca por nome/telefone
- Filtro por status
- Ordenação por coluna
- Borda colorida segue a cor do card

### 4.10 Realtime

- Canal `campanha-envios-realtime`: atualiza status dos leads em tempo real
- Canal `envios-disparo-realtime`: atualiza contadores e status dos envios

---

## 5. Blacklist

**Rota:** `/disparos-em-massa/blacklist`  
**Componente:** `src/pages/disparos/Blacklist.tsx`

### 5.1 O que é

Lista negra de leads que **nunca** receberão disparos em massa. Funciona em dois níveis:

1. **Frontend (seleção):** leads na blacklist não aparecem na seleção de leads para envios
2. **Backend (runtime):** `processar-envios-massa` verifica blacklist antes de enviar cada lote

### 5.2 Adicionar à blacklist

1. Buscar lead por nome ou telefone (mínimo 2 caracteres)
2. Selecionar lead da lista
3. Informar motivo (opcional)
4. Confirmar — registra `lead_id`, `motivo`, `adicionado_por`

### 5.3 Remover da blacklist

- Apenas **admin_geral** pode remover (RLS policy)
- Confirmação obrigatória
- Lead volta a ficar disponível para disparos

### 5.4 Tabela

| Coluna | Descrição |
|--------|-----------|
| Lead | Nome do lead (com ícone vermelho) |
| Telefone | Número formatado |
| Motivo | Motivo do bloqueio |
| Bloqueado em | Data de inclusão |
| Ação | Botão de remoção |

### 5.5 Busca
- Filtro local por nome, telefone ou motivo

---

## 6. Fluxo Técnico

### 6.1 Caminho: Enviar Agora (manual)

```
Frontend (botão "Enviar Agora")
  │
  ▼
processar-envios-massa (Edge Function)
  ├── Busca config_global.webhook_ia_disparos
  ├── Busca leads na blacklist → exclui
  ├── Busca campanha_envios com status IN ('enviar','reenviar')
  ├── Para cada lead: valida telefone → marca inválido como "NoZap"
  ├── Verifica limite de tentativas (3) → marca "erro" se excedeu
  ├── Marca lote como "tratando" e incrementa tentativas
  ├── Monta payload JSON normalizado
  └── POST para webhook n8n (com retry 3x, backoff 2s/4s)
        │
        ▼
n8n (automação externa)
  ├── Busca script IA via GET /buscar-script-ia?id=<script_ia_id>
  ├── Para cada lead do lote:
  │   ├── Envia mensagem via Evolution API
  │   └── Chama callback com resultado
  └── Sinaliza fim do lote
        │
        ▼
n8n-disparo-callback (Edge Function)
  ├── CASO 1: success=false → pausa envio + notifica
  ├── CASO 2: success=true → reverte "tratando" restantes + dispara próximo lote
  └── CASO 3: updates[] → atualiza status individual de cada lead
        ├── Atualiza campanha_envios (status, wa_message_id, enviado_em)
        ├── Atualiza contadores em envios_disparo
        └── Atualiza contadores em campanhas_disparo
```

### 6.2 Caminho: Automático (cron)

```
Cron: processar-lote-diario (diário às 10:00 UTC / 8:00 BRT)
  ├── Busca envios_disparo com ativo=true E status IN ('agendada','em_andamento')
  ├── Para cada envio:
  │   ├── Verifica dia da semana (dias_semana configurado)
  │   ├── Verifica instância ativa e conectada
  │   ├── Conta leads pendentes
  │   ├── Se 0 pendentes → marca "concluido" + notifica
  │   └── Chama processar-envios-massa internamente
  └── Retorna relatório de processamento
```

### 6.3 Payload enviado ao n8n

```json
{
  "campanha": {
    "id": "uuid",
    "nome": "Campanha Cirurgia Cardíaca",
    "tipo": "captacao",
    "mensagem": "Olá {nome}, temos uma oportunidade...",
    "script_ia_id": "uuid"
  },
  "instancia": {
    "nome": "numero-disparos",
    "id": "evolution-instance-id"
  },
  "envio_id": "uuid",
  "callback_url": "https://xxx.supabase.co/functions/v1/n8n-disparo-callback",
  "total": 70,
  "lote": [
    {
      "campanha_envio_id": "uuid",
      "lead_id": "uuid",
      "nome": "Dr. João",
      "numero": "5511999887766",
      "telefone_original": "11999887766",
      "tipo_lead": "medico",
      "especialidade": "Cirurgia Cardíaca",
      "status_anterior": "enviar"
    }
  ]
}
```

### 6.4 Formato do callback (n8n → Supabase)

#### Atualização individual de lead:
```json
{
  "updates": [
    {
      "telefone": "5547999999999",
      "campanha_id": "uuid",
      "envio_id": "uuid",
      "status": "enviado",
      "wa_message_id": "ABCDEF123456",
      "erro": null
    }
  ]
}
```

#### Status possíveis no callback: `enviado`, `erro`, `reenviar`, `NoZap`, `contatado`

#### Sinalização de fim de lote:
```json
{
  "success": true,
  "envio_id": "uuid"
}
```

#### Sinalização de falha na instância:
```json
{
  "success": false,
  "envio_id": "uuid",
  "tranfer": true
}
```

### 6.5 Lote automático contínuo

Quando o n8n sinaliza `success: true`:
1. Callback reverte leads `tratando` residuais para `reenviar`
2. Verifica se há leads pendentes (`enviar` ou `reenviar`)
3. Se houver → verifica dia válido e janela de horário (8h-16h BRT)
4. Se válido → chama `processar-envios-massa` para próximo lote
5. Se não houver leads → marca envio como `concluido` + notifica

### 6.6 Recuperação de falhas (verificar-disparos-enviados)

Edge function que consulta o histórico de mensagens da Evolution API para recuperar `wa_message_id` de leads que ficaram sem confirmação de envio.

---

## 7. Limites Configuráveis

### 7.1 Constantes no código

| Parâmetro | Valor | Onde |
|-----------|-------|------|
| **Envios por dia** | 70 | `ENVIOS_POR_DIA` / `BATCH_SIZE` em `processar-envios-massa` |
| **Máximo leads por envio** | 350 | `MAX_LEADS_POR_ENVIO` em `Envios.tsx` |
| **Limite por disparo (callback)** | 350 | `LIMITE_POR_DISPARO` em `n8n-disparo-callback` |
| **Intervalo mínimo** | 10 min | `INTERVALO_MIN` / `intervalo_min_minutos` |
| **Intervalo máximo** | 15 min | `INTERVALO_MAX` / `intervalo_max_minutos` |
| **Horário início** | 08:00 | `HORARIO_INICIO` / `horario_inicio` |
| **Horário fim** | 18:00 | `HORARIO_FIM` / `horario_fim` |
| **Dias da semana** | Seg-Sex (1-5) | `dias_semana` — default [1,2,3,4,5] |
| **Máximo tentativas por lead** | 3 | `MAX_TENTATIVAS` em ambas edge functions |
| **Cooldown entre campanhas** | 7 dias | Calculado na query de seleção de leads |
| **Guard conversa ativa** | 30 dias | Verificado em runtime (processar-envios-massa) |
| **Janela reenvio automático** | 08:00-16:00 BRT | `n8n-disparo-callback` |

### 7.2 Configurações por envio (personalizáveis na tabela)

Cada `envios_disparo` tem seus próprios:
- `envios_por_dia` (default 70)
- `intervalo_min_minutos` (default 10)
- `intervalo_max_minutos` (default 15)
- `horario_inicio` (default 08:00)
- `horario_fim` (default 18:00)
- `dias_semana` (default [1,2,3,4,5])

### 7.3 Anti-bloqueio

O sistema implementa múltiplas camadas para evitar bloqueio do WhatsApp:
1. **Limite diário:** máximo 70 mensagens por instância por dia
2. **Intervalo aleatório:** 10-15 minutos entre cada mensagem
3. **Janela de horário:** envios apenas em horário comercial
4. **Dias úteis:** por padrão apenas segunda a sexta (configurável)
5. **Cooldown:** lead não recebe de outra campanha por 7 dias
6. **Guard de conversa:** leads com interação manual nos últimos 30 dias são pulados
7. **Variação de mensagem:** integração com `gerar-variacao-mensagem` (IA Gemini)

---

## Tabelas Envolvidas

| Tabela | Função |
|--------|--------|
| `leads` | Base de leads com telefone, tipo, especialidade |
| `tipos_lead` | Catálogo de tipos (médico, paciente, etc.) com cor |
| `especialidades` | Catálogo de especialidades médicas |
| `lead_especialidades_secundarias` | N:N leads ↔ especialidades |
| `campanhas_disparo` | Campanhas com mensagem, tipo, filtros, script IA |
| `envios_disparo` | Execuções de campanha com configuração de envio |
| `campanha_envios` | Leads individuais por envio (status, tentativas) |
| `lead_blacklist` | Lista negra global |
| `lead_campanha_historico` | Histórico de participação em campanhas |
| `lead_importacoes` | Histórico de importações |
| `config_global` | URLs de webhook (n8n) |
| `instancias_whatsapp` | Instâncias Evolution API |
| `ia_scripts` | Scripts de IA vinculados às campanhas |
| `notificacoes` | Notificações de conclusão/erro |

---

## Edge Functions Envolvidas

| Função | Tipo | Descrição |
|--------|------|-----------|
| `processar-envios-massa` | Frontend/Cron | Processa lote de leads e envia ao n8n |
| `processar-lote-diario` | Cron (8h BRT) | Dispara lotes automáticos para envios agendados |
| `n8n-disparo-callback` | Webhook (n8n) | Recebe status de leads + sinaliza fim de lote |
| `verificar-disparos-enviados` | Utilitária | Recupera wa_message_id perdidos |
| `gerar-variacao-mensagem` | Utilitária | Gera variações de texto via Gemini |
| `buscar-script-ia` | GET público | Retorna script IA para n8n |
| `exportar-leads-enviados` | Frontend | Exporta relatório de leads enviados |
