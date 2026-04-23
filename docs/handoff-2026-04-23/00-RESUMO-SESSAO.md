# Resumo da Sessão — 22-23/04/2026

**Desenvolvedor:** Raul Seixas
**Projeto:** Maikonect CRM (Dr. Maikon Madeira, cirurgião cardíaco, Itajaí/SC)
**Duração:** ~12h (22/04 à noite → 23/04 manhã)
**Branch:** `main` (commits diretos autorizados)

---

## Objetivo da sessão

Levar a máquina de **disparos em massa + IA conversacional** a 100% funcional antes da secretária Izadora reativar a campanha antiga que estava travada.

---

## Estado de entrada

- Workflow n8n "Maikonect IA Responder v2" criado na sessão anterior mas **com bugs**:
  - `SplitInBatches v3` conectado na saída errada (`done` vazio)
  - `Buscar contact_id` com normalização de telefone restritiva
  - `Buscar histórico msgs` parando em array vazio
  - Parse de `$json` assumindo array
- API key do Gemini **vazou e foi auto-revogada** pelo Google
- **n8n em crash loop** — sqlite corrompido por `docker cp` do arquivo durante o serviço ativo

---

## Eventos críticos da sessão

### 1. Recuperação do n8n (crise)

Tentei forçar ativação de workflow via `docker cp` da sqlite manipulada → **corrompeu o banco do n8n** (tree 25 / `execution_data`).

Fix:
- Rebuild do sqlite a partir do `database.sqlite.old` (1.9GB, corrupto mas com tabelas leves OK)
- Excluí tabelas pesadas corrompidas (`execution_data`, `execution_entity`, `execution_metadata`, `binary_data`, etc)
- Re-dump de 47 tabelas via `sqlite3 .dump <tabela>`
- Reconstrução com 35 índices faltantes
- Resultado: 149 migrations + 12 workflows + 14 credentials **preservados**. Zero perda de dados operacionais (só histórico de executions passadas).

### 2. Nova Gemini key

A do workflow (`AIzaSy...`) foi revogada. Raul forneceu nova key (`AQ.Ab...`), injetei como env var no docker service do n8n (`GEMINI_API_KEY`), workflow passou a usar `$env.GEMINI_API_KEY` via header `x-goog-api-key`.

### 3. Teste end-to-end da IA

Sequência de fixes até passar:
- `SplitInBatches v3` → trocou por Code node que faz `arr.map(e => ({json: e}))`
- `Buscar contact_id` → query com `phone=in.(v1,v2,...)` com 7 variantes (cru/com55/sem55/last10/last11 etc)
- `Buscar histórico msgs` → `alwaysOutputData: true` pra não parar com array vazio
- `Montar prompt Gemini` → trata `$json` não-array via `Array.isArray()` check
- Contato de teste criado no DB (telefone do Raul não existia em `contacts`)
- **Resultado:** pipeline 22/22 nodes executou, IA respondeu "Recebi a conversa vazia..." via Evolution, mensagem entregue no WhatsApp do Raul

### 4. Bug reportado pela Izadora

Ela concluiu várias tarefas, contador no header do TaskFlow mostrava 0 mas dashboard da Home mostrava correto. Bug: query do header filtrava por `responsavel_id = selectedProfile.id`, restritivo demais. Fix: removeu o filtro, agora bate com dashboard.

### 5. Crise de segurança — commit com chaves

Primeiro commit bloqueado automaticamente pois workflows JSON e script Python tinham:
- Supabase service_role_key hardcoded
- Evolution API key hardcoded
- (Gemini já estava OK via env)

Fix: sanitizou todos os JSONs substituindo valores por `{{ $env.SUPABASE_SERVICE_ROLE_KEY }}`, `{{ $env.EVOLUTION_API_KEY }}` etc. Adicionou as env vars ao docker service do n8n. Redeployou workflows.

### 6. Plano de 4 sprints aprovado + executado

Sprint A (handoff múltiplo), B (resumo diário estendido), C (relatório UI) — todos executados e no main. Sprint D (teste real com Iza) e E (cadência) deferidos.

---

## Commits desta sessão

| Hash | Descrição |
|---|---|
| `7cbfffb` | IA Responder v2: prompt sigma + multi-msg + debounce + Whisper/Vision + LGPD + fix contador tarefas |
| `dcd5d8f` | Disparos 100%: handoff múltiplo + resumo diário de campanhas + relatório por campanha |

---

## Não foi feito (por escolha pragmática)

- **Cadência multi-toque** (follow-up automático) — deferido até medirmos taxa de resposta real
- **Teste end-to-end com lead real** — aguardando Izadora reativar a campanha
- **Feature "openclaw"** — integração futura com agente (Claude Code) que cria campanhas e analisa resultados via SSH/API
- **Gráfico temporal no relatório** — MVP sem, podemos adicionar depois
- **Seleção de leads com filtros avançados na UI** — atual usa filtro_tipo_lead + filtro_perfil_profissional mas não expõe todos filtros

---

## Próximo passo concreto

Izadora reativa a campanha antiga em `/disparos-em-massa/campanhas`. Observar 24-48h. Ajustar prompt se IA soar robô. Decidir cadência com base em dados reais (taxa de resposta).

Ver detalhes no `03-HANDOFF-NOVA-SESSAO.md`.
