# Implementado — Bloco Disparos+IA + Próximos

Documento técnico detalhando cada entrega da sessão 22-23/04/2026.

---

## Arquitetura de resposta (novo fluxo end-to-end)

```
Lead manda msg no WhatsApp
          ↓
Evolution API (VPS) → POST webhook pro Supabase
          ↓
Edge function evolution-messages-webhook
  ├─ Salva msg em messages (tabela)
  ├─ Se áudio: Whisper transcreve (OpenAI API)
  ├─ Se imagem: Vision descreve (Gemini 2.5 Flash)
  ├─ Se regex opt-out: marca campanha_envios=descartado, blacklist, confirma LGPD
  ├─ Se msg de contato em campanha ativa:
  │   ├─ Atualiza campanha_envios.respondeu_em + primeira_msg_contato_em
  │   ├─ INSERT em campanha_msg_queue
  │   └─ POST pro n8n webhook campanha-msg-debounce
  └─ Continua salvando conversa normal no SDR Zap
          ↓
n8n workflow "Campanha — Debounce 10s + IA"
  ├─ Wait 10s
  ├─ Query campanha_msg_queue: sou o owner (última msg desse phone)?
  ├─ Se NÃO: exit silencioso (outra msg chegou depois)
  └─ Se SIM:
      ├─ POST pro webhook maikonect-ia-responder-v2
      └─ DELETE campanha_msg_queue do phone
          ↓
n8n workflow "Maikonect — IA Responder v2" (22 nodes)
  ├─ Busca envio + campanha + briefing_ia
  ├─ Valida IA ativa (campanha.status='ativa', briefing.ia_ativa=true)
  ├─ Match contact_id por phone (7 variantes: cru/com55/sem55/last10/last11)
  ├─ Busca histórico messages (alwaysOutputData se vazio)
  ├─ Monta prompt estilo sigma (XML tags: contexto, naturalidade, fluxo,
  │   antes_de_handoff, handoff, anti_promessa, anti_loop, contato_dirige, saida)
  ├─ Gemini 2.5 Flash com responseSchema JSON estruturado
  ├─ Parse: {messages[], alerta_lead, motivo_alerta, conversa_encerrada}
  ├─ Re-check lock (anti-debounce adicional)
  ├─ Busca instância IA (chip_ia_id ou primeiro conectado)
  ├─ Code node "Enviar msgs + handoff" (via helpers.httpRequest):
  │   ├─ Loop de cada msg: sendPresence composing → sleep(len*60ms) → sendText
  │   ├─ Delay 900-2400ms entre mensagens consecutivas
  │   └─ Se alerta_lead: loop handoff_telefones[], envia alerta pra cada
  └─ Update campanha_envios.status (qualificado|descartado|em_conversa)
          ↓
Response webhook: { ok, processado, status_final, msgs_enviadas, handoff }
```

---

## Sprint 1: IA conversacional (commit `7cbfffb`)

### 1.1 Prompt estilo sigma adaptado pro Gemini

**Arquivo:** `scripts/update_workflow_v2.py` (gerador) → `docs/n8n-workflows/maikonect-ia-responder-v2.json`

**Estrutura:**
- `<contexto>` — persona + contexto extra do briefing
- `<objetivo>` — objetivo da campanha
- `<naturalidade>` — regras de fala humana (vírgulas omissas, sem emoji estruturado, sem markdown, variar cumprimentos, não dizer "sou IA")
- `<engajamento_proativo>` — quando o contato demonstra curiosidade, responde com FATO + PERGUNTA
- `<beneficios>` e `<objecoes>` — se fornecidos no briefing_ia
- `<fluxo>` — passos configuráveis (default: entender contexto → apresentar → qualificar → encaminhar)
- `<antes_de_handoff>` — regra dura de 3+/4 checklist mínimo antes de mencionar handoff
- `<handoff>` — quando e como fazer
- `<anti_promessa>` — palavras proibidas ("moderno", "oportunidade única", etc)
- `<anti_loop>` — leia TODO histórico antes de responder
- `<contato_dirige>` — contato guia, fluxo é só guia
- `<saida>` — JSON schema obrigatório

**Saída JSON via responseSchema:**
```json
{
  "messages": ["msg1", "msg2"],
  "alerta_lead": false,
  "motivo_alerta": "",
  "conversa_encerrada": false
}
```

### 1.2 Multi-msg com delay humanizado

**Arquivo:** `docs/n8n-workflows/maikonect-ia-responder-v2.json` — node "Enviar msgs + handoff"

Antes: só a 1ª msg do array era enviada. Agora itera todas:
```js
for (msg of todas_msgs) {
  sendPresence(composing, delay=len*60ms)  // typing indicator
  sleep(delay)
  sendText(msg)
  sleep(900-2400ms)  // delay humano entre msgs
}
```

Usa `this.helpers.httpRequest` (bindado no topo) em vez de `fetch` nativo — resolvi bug de `ok: false`.

### 1.3 Fix bug do contador de tarefas

**Arquivo:** `src/pages/TaskFlow.tsx:230-256`

Query do contador no header removeu filtro `responsavel_id = selectedProfile.id`. Agora bate com dashboard da Home (TasksSummary).

---

## Sprint 2: Debounce + Multimodal + LGPD (commit `7cbfffb`)

### 2.1 Tabela campanha_msg_queue

**Migration:** `supabase/migrations/20260422_campanha_msg_queue.sql`

```sql
CREATE TABLE campanha_msg_queue (
  id UUID PRIMARY KEY,
  phone TEXT NOT NULL,
  contact_id UUID,
  wa_message_id TEXT,
  text TEXT,
  message_type TEXT,
  media_url TEXT,
  instance_name TEXT,
  instance_uuid UUID,
  from_me BOOLEAN,
  created_at TIMESTAMPTZ
);
CREATE INDEX idx_msg_queue_phone_created ON campanha_msg_queue(phone, created_at DESC);
CREATE INDEX idx_msg_queue_created ON campanha_msg_queue(created_at);
```

**pg_cron** limpa registros > 5min a cada 5min (evita lixo).

### 2.2 Workflow de debounce 10s

**Arquivo:** `docs/n8n-workflows/campanha-msg-debounce.json`
**ID:** `campanhaMsgDebounceV1`
**Webhook:** `POST /webhook/campanha-msg-debounce`

Nodes:
1. Webhook (entry)
2. Wait 10s
3. HTTP GET: última msg desse phone em `campanha_msg_queue`
4. Code "Sou o dono?": compara `queue_msg_id` com último da fila
5. IF: se `skip=false`, continua
6. POST webhook `maikonect-ia-responder-v2`
7. DELETE msgs do phone da fila

### 2.3 Whisper + Vision inline no webhook

**Arquivo:** `supabase/functions/evolution-messages-webhook/index.ts` (bloco ~1170-1240)

**Whisper (áudio):**
- Quando `messageType === 'audio' && mediaBase64`
- Converte base64 → Blob → FormData → POST pro OpenAI `/v1/audio/transcriptions`
- `model: whisper-1`, `language: pt`
- Salva em `messages.text` como `[Áudio]: <transcrição>` (sobrescreve placeholder)

**Vision (imagem):**
- Quando `messageType === 'image' && mediaBase64`
- POST pro Gemini `/v1beta/models/gemini-2.5-flash:generateContent`
- Prompt: "Descreva essa imagem em português, de forma objetiva, em 1-2 frases. Se for documento médico (CRM, RQE, diploma, exame, comprovante), extraia números e dados visíveis."
- Salva em `messages.text` como `[Imagem]: <descrição>` + caption original se tiver

**Importante:** só roda pra contatos em campanha ativa (economia de OpenAI/Gemini).

### 2.4 LGPD opt-out

**Arquivo:** `supabase/functions/evolution-messages-webhook/index.ts` (bloco ~1065-1120)

Regex:
```js
/^(parar?|pare|para de mandar|remover?|remove|saia?|sair|stop|
   descadastrar|desinscrever|unsubscribe|cancelar|
   nao.?quero.?mais|n[ãa]o.?envi(e|ar).?mais|nao.?me.?mand(e|ar))\b/i
```

Ações se detectado:
1. Marca todos `campanha_envios` do phone (status in pendente/enviado/em_conversa/qualificado) como `descartado` com `erro: "Opt-out via WhatsApp: ..."`
2. Upsert em `lead_blacklist` com `lead_id` + motivo
3. Envia confirmação LGPD via Evolution: "Recebido. Seu contato foi removido das nossas listas de comunicação. Não enviaremos mais mensagens. Obrigado!"
4. Skippa callback de flip pra `em_conversa`

### 2.5 Detecção chip morto com notificação

**Arquivo:** `supabase/functions/processar-campanha-v2/index.ts` (bloco ~385-460)

Lógica existente de auto-pause (>30% erro em 20 últimas msgs → `status='suspeito'`) **agora também**:
- Insere em `notificacoes` pra todos `admin_geral` (tipo `chip_pausado`)
- Envia WhatsApp alert pro `config_global.telefone_alerta_chip` (se configurado), usando primeiro chip saudável disponível

---

## Sprint 3: Handoff múltiplo + Resumo diário + Relatório (commit `dcd5d8f`)

### 3.1 Handoff pra múltiplos responsáveis

**Frontend:** `src/pages/disparos/Campanhas.tsx`
- `BriefingIA.handoff_telefones: string[]` (novo campo)
- `BriefingIA.handoff_telefone: string` (legado, mantido com `@deprecated`)
- Input no dialog aceita telefones separados por vírgula
- Migração automática no `openEditDialog`: se JSONB antigo só tem `handoff_telefone`, converte pra array

**Workflow:** `docs/n8n-workflows/maikonect-ia-responder-v2.json` — node "Enviar msgs + handoff"
- Lê `briefing.handoff_telefones` (array) OU fallback `briefing.handoff_telefone` (string legada)
- Deduplica + normaliza + remove o próprio phone do lead
- Loop: envia alerta pra cada, com delay 600-1000ms entre eles
- `handoff_count` exposto no response

### 3.2 Resumo diário 18h estendido

**Edge function:** `supabase/functions/resumo-campanhas-diario/index.ts` (NOVA)

Retorna:
```json
{
  "gerado_em": "ISO",
  "totais": {
    "campanhas_ativas": N,
    "enviados_hoje": N,
    "respondidos_hoje": N,
    "qualificados_hoje": N,
    "descartados_hoje": N,
    "em_conversa_agora": N,
    "handoffs_pendentes": N,
    "chips_pausados": N
  },
  "por_campanha": [
    {
      "campanha_id": "uuid",
      "nome": "string",
      "tipo": "string",
      "enviados_hoje": N,
      "respondidos_hoje": N,
      "qualificados_hoje": N,
      "descartados_hoje": N,
      "em_conversa_agora": N,
      "falhas_hoje": N,
      "taxa_resposta_pct": N
    }
  ],
  "chips_pausados": [{ "nome", "numero" }],
  "handoffs_pendentes": [{ "telefone", "respondeu_em", "campanha_nome" }]
}
```

**Workflow n8n:** `ResumoDiario18h` (ID `ResumoDiario18h001`)
- Dispara a cada dia 18h BRT (schedule trigger existente)
- Encadeamento: `18h BRT → getResumo → getCampanhasResumo → formatarMsg → EnviarMaikon + EnviarRaul`
- Mensagem WhatsApp tem 2 seções:
  - **SDR ZAP:** conversas pendentes por responsável + respondidas hoje (bloco existente)
  - **CAMPANHAS:** breakdown por campanha ativa (enviadas/respondidos/%/quentes) + totais do dia + chips pausados + top 5 leads quentes aguardando handoff

### 3.3 Relatório por campanha

**View SQL:** `supabase/migrations/20260423_vw_metricas_campanha.sql`

```sql
CREATE VIEW vw_metricas_campanha AS
SELECT
  c.id, c.nome, c.tipo, c.status, c.created_at, ...,
  COUNT(e.id) AS total_envios,
  COUNT(*) FILTER (WHERE e.status = 'pendente') AS pendentes,
  ... enviados, em_conversa, qualificados, descartados ...
  COUNT(*) FILTER (WHERE e.enviado_em >= CURRENT_DATE) AS enviados_hoje,
  COUNT(*) FILTER (WHERE e.respondeu_em >= CURRENT_DATE) AS respostas_hoje,
  MAX(e.enviado_em) AS ultimo_envio,
  taxa_resposta_pct, taxa_qualificacao_pct
FROM campanhas_disparo c
LEFT JOIN campanha_envios e ON e.campanha_id = c.id
GROUP BY c.id;
```

**Hook:** `src/hooks/useMetricasCampanha.ts` — TanStack Query com refetch 1min + filtro por status.

**Página:** `src/pages/disparos/Relatorios.tsx` — rota `/disparos-em-massa/relatorios`
- Cards de totais: enviadas hoje, respostas hoje, quentes (qualificados), em conversa agora
- Tabs: Todas / Ativas / Pausadas / Finalizadas
- Grid de cards por campanha com:
  - Nome + tipo + status badge
  - Métricas: Total / Respostas / Quentes
  - Taxa resposta % e Taxa qualificação % em destaque
  - Rodapé: enviados/respostas hoje + erros + última resposta

**Nav:** `src/components/DisparosTopNav.tsx` — entrada "Relatórios" adicionada entre Envios e Blacklist.

---

## Itens dos próximos blocos (não implementados ainda)

### Cadência multi-toque (deferido)

**Motivo do deferimento:** over-engineering sem dados. Só vale se taxa de resposta ao primeiro disparo for baixa (< 20%).

**Escopo previsto** (~3-4h):
- Tabela `campanha_cadencia_passos` (campanha_id, ordem, dia_offset, mensagem_template)
- Edge function `processar-cadencia-followup` + pg_cron diário
- Lógica: envio inicial → se não respondeu em N dias, dispara follow-up 1; em M dias, follow-up 2; em P dias, msg de "breakup"
- UI na criação de campanha pra configurar cadência
- Integração com existing campanha_envios (não duplicar)

### Feature "openclaw" — agente IA pra criar/analisar campanhas (deferido)

**Motivo:** escopo arquitetural maior, vem com decisão de qual agente (Claude Code? OpenAI Assistant? SDK custom?).

**Escopo previsto:**
- API REST ou SSH pra um agente externo poder:
  - Criar campanhas programaticamente (payload JSON estruturado)
  - Ler métricas (já coberto pela `vw_metricas_campanha`)
  - Analisar conversas e sugerir ajustes de prompt/briefing
  - Gerar relatório de performance periodicamente
- Auth: token dedicado ou service account
- Rate limiting
- Logs de auditoria

### Melhorias no relatório (futuro)

- Gráfico temporal (recharts) enviados vs respostas nos últimos 7/30 dias
- Drill-down por campanha → lista de leads qualificados com link pro SDR Zap
- Export CSV
- Filtro por data range

### Teste end-to-end real (aguardando Iza)

Plano de observação em `03-HANDOFF-NOVA-SESSAO.md`.

---

## Arquivos-chave modificados/criados

### Novos
- `supabase/migrations/20260422_campanha_msg_queue.sql`
- `supabase/migrations/20260423_vw_metricas_campanha.sql`
- `supabase/functions/resumo-campanhas-diario/index.ts`
- `docs/n8n-workflows/maikonect-ia-responder-v2.json` (v2, sanitizado)
- `docs/n8n-workflows/campanha-msg-debounce.json`
- `docs/n8n-workflows/resumo-diario-18h.json`
- `docs/n8n-workflows/iamaiconnect-backup.json` (backup Everton)
- `docs/n8n-workflows/iasdr-backup.json` (backup Everton)
- `src/hooks/useMetricasCampanha.ts`
- `src/pages/disparos/Relatorios.tsx`
- `scripts/update_workflow_v2.py` (gerador do workflow n8n)

### Modificados
- `supabase/functions/evolution-messages-webhook/index.ts` (+ ~200 linhas: Whisper, Vision, LGPD, fila)
- `supabase/functions/processar-campanha-v2/index.ts` (chip notification)
- `src/pages/TaskFlow.tsx` (fix contador)
- `src/pages/disparos/Campanhas.tsx` (handoff_telefones array)
- `src/components/DisparosTopNav.tsx` (nav "Relatórios")
- `src/App.tsx` (rota `/disparos-em-massa/relatorios`)
