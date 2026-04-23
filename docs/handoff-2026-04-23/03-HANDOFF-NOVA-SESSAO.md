# Handoff para a próxima sessão do Claude Code

Este doc é pra um Claude que **não participou** da sessão 22-23/04/2026. Leia antes de tocar no código.

---

## Contexto do projeto em 1 minuto

- **Cliente:** Dr. Maikon Madeira (cirurgião cardíaco, Itajaí/SC). Empresa GSS Saúde.
- **Equipe:** Dr. Maikon + secretárias Izadora (Iza) e Mariana.
- **Dev responsável:** Raul Seixas (carta branca, push direto no `main`).
- **Stack:** React 18 + TypeScript + Vite + shadcn/ui + TanStack Query + Supabase (Postgres + Edge Functions) + n8n self-hosted + Evolution API (WhatsApp multi-chip).
- **Frontend deploy:** Lovable Cloud (pega do `main` do GitHub automaticamente).
- **IA:** Gemini 2.5 Flash (conversação) + Whisper (áudio) + Gemini Vision (imagem).

Antes de assumir algo, leia: `CLAUDE.md` (raiz) e os memory files em `~/.claude/projects/C--Users-rauls-crm-gestao-madeira/memory/MEMORY.md`.

---

## O que mudou nessa sessão (22-23/04/2026)

Resumo ultra-curto: **máquina de disparos + IA conversacional passaram de ~60% pra ~90% prontas**. Pipeline completo funciona em teste sintético. Falta validação real com lead que Izadora vai reativar.

Detalhe completo em `01-IMPLEMENTADO.md`.

Commits:
- `7cbfffb` — IA responder v2 (prompt sigma, multi-msg, debounce, Whisper/Vision, LGPD, fix contador)
- `dcd5d8f` — Handoff múltiplo + resumo diário campanhas + relatório por campanha

---

## Estado dos serviços externos

### VPS do n8n (72.61.48.2)

- **SSH:** `ssh root@72.61.48.2` (chave configurada no PC do Raul)
- **URL:** https://sdsd-n8n.r65ocn.easypanel.host
- **Container:** `sdsd_n8n.1.HASH` (Docker Swarm via EasyPanel)
- **DB:** SQLite em `/etc/easypanel/projects/sdsd/n8n/volumes/data/database.sqlite`
  - **⚠️ NUNCA `docker cp` esse arquivo enquanto o serviço está ativo** (corrompe)
  - Se precisar manipular: `docker service scale sdsd_n8n=0` → mexer → `scale=1`
  - Backup manual: `cp database.sqlite database.sqlite.bak.$(date +%s)` antes
- **Env vars já injetadas** (via `docker service update --env-add`):
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
  - `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`
  - `GEMINI_API_KEY`
  - `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (permite `$env.X` no Code node)
- **Workflows ativos (11):** conect-what, Agenda, disparador, IAmaiconnect, IA-SDR, AvisosDiarios, avisosdisparos, avisosFim, ResumoDiario18h, **Maikonect — IA Responder v2**, **Campanha — Debounce 10s + IA**

### Supabase (yycpctrcefxemgahhxgx)

- **URL:** https://yycpctrcefxemgahhxgx.supabase.co
- **Access token** (Management API): ver `~/.claude/projects/C--Users-rauls-crm-gestao-madeira/memory/reference_supabase_novo.md`
- **Service role key + Anon key:** idem, mesmo arquivo de memory
- **Linked:** sim, em `C:/Users/rauls/crm-gestao-madeira`
- **CLI auth:** `SUPABASE_ACCESS_TOKEN=<token> npx supabase ...`
- **Secrets:** `GEMINI_API_KEY`, `OPENAI_API_KEY`, `EVOLUTION_API_KEY`, `GOOGLE_CLIENT_*`, `LOVABLE_API_KEY`
- **Pg_cron jobs ativos:**
  - `processar_campanhas_v2_job` — a cada 10min
  - `campanha_ia_responder_job` — a cada 2min (dispatcher legado, ainda roda como safety net)
  - `enviar_lembretes_wa_job` — a cada 5min
  - `google_calendar_sync_job` — a cada 10min (inerte até Google Cloud setup)
  - `limpar_campanha_msg_queue` — a cada 5min

### Evolution API

- **URL:** https://sdsd-evolution-api.r65ocn.easypanel.host
- **API Key:** ver `memory/reference_vps_maikon.md` (já está como env `EVOLUTION_API_KEY` no n8n + secret no Supabase)
- **Instâncias conectadas:** ~8, algumas de teste, algumas de produção (Iza, Mariana, consultório, disparos)

---

## Fluxos críticos pra entender antes de mexer

### Fluxo de resposta da IA (complexo, múltiplas peças)

```
1. Lead manda msg no WhatsApp → Evolution envia webhook pro Supabase
2. Edge evolution-messages-webhook:
   - Salva em messages
   - Se áudio → Whisper
   - Se imagem → Vision
   - Se regex opt-out → marca descartado + blacklist + confirma LGPD → STOP
   - Se em campanha ativa:
     - Atualiza campanha_envios.primeira_msg_contato_em
     - INSERT campanha_msg_queue
     - POST pro n8n /webhook/campanha-msg-debounce
3. Workflow n8n "Debounce 10s + IA":
   - Wait 10s
   - Owner check (última msg do phone)
   - Se owner: POST pro /webhook/maikonect-ia-responder-v2
   - DELETE fila do phone
4. Workflow n8n "IA Responder v2":
   - Busca envio + briefing
   - Gera prompt Gemini (21k chars de sistema)
   - Gemini retorna {messages[], alerta_lead, ...}
   - Envia cada msg com typing+delay
   - Se alerta: envia handoff pra cada telefone em briefing.handoff_telefones[]
   - Update status_final
```

**Fallback:** o pg_cron `campanha_ia_responder_job` a cada 2min roda em modo batch — processa qualquer envio em_conversa com `primeira_msg_contato_em` > 15s atrás que não foi processado. É safety net se o debounce falhar.

### Fluxo de disparo

```
Lead criado em `leads` → admin cria campanha em /disparos-em-massa/campanhas com:
  - briefing_ia (persona, objetivo, handoff_telefones[])
  - chip_ids[] (instâncias Evolution que vão disparar)
  - mensagem (com spintax tipo {Oi|Opa|E aí})
  - envios_por_dia, dias_semana, horário
  - filtros por tipo_lead, perfil_profissional, especialidade
Admin clica "Ativar" → status='ativa'
pg_cron processar_campanhas_v2_job roda a cada 10min:
  - Acha campanhas ativas
  - Gera lote de campanha_envios pendentes (se não existe)
  - Envia 1 por vez, spintax aplicada, chip rotation
  - Loga em disparos_logs
  - Se chip com >30% erro: status='suspeito' + notifica admins
Lead recebe msg. Se responder: callback flippa pra em_conversa → IA entra
```

---

## O que pode dar errado e como debugar

### "Webhook n8n retorna 404 'not registered'"

- Workflow não está ativo. Solução:
  ```bash
  ssh root@72.61.48.2 'docker exec $(docker ps --no-trunc -q -f name=sdsd_n8n.1) n8n update:workflow --id=<ID> --active=true'
  ssh root@72.61.48.2 'docker service update --force sdsd_n8n'
  ```
- Espera 30s e tenta de novo.

### "Workflow ativa mas Gemini retorna 403 Forbidden"

- A API key do Gemini vazou pro repo e Google revogou. Substitua:
  1. Gera nova key em https://aistudio.google.com/app/apikey
  2. `ssh root@72.61.48.2 'docker service update --env-add GEMINI_API_KEY=<NEW_KEY> sdsd_n8n'`
  3. Workflow pega automaticamente via `$env.GEMINI_API_KEY` no header `x-goog-api-key`
- Também atualiza no Supabase secrets pro edge `evolution-messages-webhook` usar no Vision:
  ```bash
  SUPABASE_ACCESS_TOKEN=sbp_04... npx supabase secrets set GEMINI_API_KEY=<NEW_KEY> --project-ref yycpctrcefxemgahhxgx
  ```

### "Lead respondeu mas IA não respondeu"

Diagnóstico em ordem:
1. `SELECT * FROM campanha_msg_queue WHERE phone LIKE '%<ultimos_digitos>%';` — ainda enfileirado?
2. `SELECT * FROM campanha_envios WHERE telefone LIKE '%<ultimos_digitos>%' AND status IN ('enviado','em_conversa');` — tem envio ativo?
3. No n8n UI: executions do workflow "Campanha — Debounce 10s + IA" — rodou?
4. Executions do "Maikonect — IA Responder v2" — rodou?
5. Se rodou e falhou: clica na execução pra ver qual node quebrou
6. Se nem trigou: verifica se a edge `evolution-messages-webhook` chamou o debounce (logs do Supabase)

### "n8n crashloop"

- **NÃO tente fix por `docker cp`** do sqlite. Sigma seguro:
  1. `docker service scale sdsd_n8n=0`
  2. Espera service convergir
  3. Faz o que precisa no arquivo sqlite
  4. `docker service scale sdsd_n8n=1`
- Se corrompeu: procedimento de rebuild em `00-RESUMO-SESSAO.md` seção "Recuperação do n8n"

### "Edge function deploy falha com 403"

- Falta o access token. Pegar em `memory/reference_supabase_novo.md` e usar:
  ```bash
  SUPABASE_ACCESS_TOKEN=<token_do_memory> npx supabase functions deploy <name> --project-ref yycpctrcefxemgahhxgx --no-verify-jwt
  ```

### "pré-commit bloqueia por chaves"

- Nunca commite JWT do Supabase, Evolution API key, ou Gemini key em plain text
- Use `$env.X` em workflows n8n, `Deno.env.get()` em edge functions, `import.meta.env` no frontend
- Keys que sobraram hardcoded em qualquer arquivo — substitua antes de comitar

---

## Arquivos que você vai precisar ler

Em ordem sugerida:

1. **`CLAUDE.md`** (raiz) — convenções do projeto
2. **`docs/handoff-2026-04-23/01-IMPLEMENTADO.md`** — o que fizemos tecnicamente
3. **`docs/handoff-2026-04-23/02-STATUS-PROJETO.md`** — status macro + debts
4. **`scripts/update_workflow_v2.py`** — gerador do workflow IA Responder. Modifica aqui + `python3 scripts/update_workflow_v2.py` + redeploy
5. **`supabase/functions/evolution-messages-webhook/index.ts`** — onde entra msg do WhatsApp
6. **`supabase/functions/processar-campanha-v2/index.ts`** — motor de disparo
7. **`supabase/functions/resumo-campanhas-diario/index.ts`** — endpoint do resumo 18h
8. **`src/pages/disparos/Campanhas.tsx`** — UI de criação/edição
9. **`src/pages/disparos/Relatorios.tsx`** — UI de métricas
10. **`docs/n8n-workflows/`** — JSONs dos workflows n8n (sanitizados com `$env.*`)

---

## Itens em aberto (por prioridade)

### Alta

1. **Teste end-to-end com lead real** (Izadora reativa campanha)
   - Como: ela abre `/disparos-em-massa/campanhas`, edita a campanha antiga dela, clica "Ativar"
   - Observar por 24-48h:
     - IA respondeu natural?
     - Handoff disparou no momento certo?
     - Chip(s) aguentaram?
     - Resumo 18h chegou no WhatsApp do Maikon?
   - Relatório de observação com ~10-20 conversas reais

2. **Ajuste fino do prompt** (depois do teste)
   - Se IA soar robô: iterar sobre `scripts/update_workflow_v2.py` → `NEW_PROMPT_CODE`
   - Provável ajuste: tom mais informal, menos regras duras, ou mais contexto do briefing

### Média

3. **Cadência multi-toque** — se taxa de resposta baixa
   - Tabela `campanha_cadencia_passos`
   - Edge function `processar-cadencia-followup` + pg_cron diário
   - UI na criação de campanha

4. **Google Calendar — 3 setups manuais pendentes**
   - Ver `memory/project_google_calendar_pending.md`

5. **openclaw** — integração com agente IA externo (decisão arquitetural pendente)

### Baixa

6. Gráfico temporal no relatório
7. Unificar `mensagens` e `messages` (technical debt)
8. Testes unitários frontend

---

## Regras não-negociáveis (ler antes de fazer qualquer coisa)

Do `CLAUDE.md` e memory:

- **Toast:** sempre `import { toast } from "sonner"` — nunca do shadcn
- **Supabase client:** sempre `import { supabase } from "@/integrations/supabase/client"`
- **Tipos:** sempre de `@/integrations/supabase/types` — nunca editar manualmente
- **Commits:** mensagens em português, descritivas (ver histórico pra formato)
- **Push:** autorizado direto no `main`. Mas confirmar antes de mexer em creds de usuário
- **NUNCA skip hooks** (--no-verify) sem pedir ao Raul
- **NUNCA commitar secrets** (JWT, API keys) — usar env vars sempre
- **Plan mode** pra mudanças que tocam 3+ arquivos
- **Cache local:** Raul quer reduzir re-fetches (conversas/contatos/fotos) — ver `memory/feedback_cache_local.md`

---

## Perguntas úteis pra fazer no começo da próxima sessão

Antes de codar, o Claude novo deveria perguntar ao Raul:

1. "A campanha real da Iza foi ativada? Qual é o estado da taxa de resposta até agora?"
2. "Algum bug novo observado que eu não sei?"
3. "A gente vai pra cadência agora ou openclaw, ou ainda estamos na fase de observação?"
4. "Mudou alguma coisa no setup (secrets, env vars, URLs)?"

---

## Contatos pro Raul (fora do Claude Code)

- **WhatsApp direto:** —
- **Github:** `madeiraholdingti-lab/crm-gestao-madeira`
- **EasyPanel UI:** http://72.61.48.2:3000
- **Supabase Dashboard:** https://supabase.com/dashboard/project/yycpctrcefxemgahhxgx
- **n8n UI:** https://sdsd-n8n.r65ocn.easypanel.host

---

## Um último aviso

Quando o Raul diz **"pode tocar"** ou **"vai"** → execução autônoma autorizada. **"confirma pra mim"** → pergunta antes.

Quando em dúvida sobre uma decisão arquitetural com blast radius grande (ex: mudar schema de tabela com dados em prod, mexer em workflow em produção que afeta várias campanhas ativas): **pergunte**. Ele prefere que você pergunte a que assuma errado.

Boa sorte.

— Claude Opus 4.7 (1M context), sessão de 22-23/04/2026
