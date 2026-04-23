# Status geral do projeto Maikonect CRM — 23/04/2026

Snapshot de onde cada módulo/feature está. **% em "pronto pra produção"** (não % de código feito — foca no que o usuário usa sem quebrar).

---

## Resumo executivo

| Módulo | Status | % |
|---|---|---|
| **Infra (Supabase + n8n + Evolution API)** | Estável, 100% | 100% |
| **SDR Zap** (chat manual + Kanban) | Em produção | 100% |
| **Task Flow** (board de tarefas) | Em produção (bug Iza fixado) | 100% |
| **Contatos + importação** | Estável | 95% |
| **Disparos em massa — engine** | Em produção | 100% |
| **IA responder conversacional** | Código pronto, falta validação real | 90% |
| **Resumo diário 18h** | Deployado, primeira execução 23/04 18h | 85% |
| **Relatórios por campanha (UI)** | MVP funcional | 70% |
| **Google Calendar OAuth** | Código pronto, pendente setup manual | 60% |
| **Cadência multi-toque** | Não implementado | 0% |
| **openclaw (agente IA criar/analisar)** | Não implementado | 0% |
| **Mobile-first / UX geral** | Em evolução contínua | 80% |

**Status geral do projeto: ~83%** (média ponderada dos módulos críticos).

---

## Detalhe por módulo

### Infra

| Item | Status |
|---|---|
| Supabase cloud (yycpctrcefxemgahhxgx) | ✅ Pro plan, São Paulo |
| Edge functions deploy | ✅ Via `npx supabase functions deploy` |
| pg_cron jobs (3 ativos: disparos, IA, limpeza queue) | ✅ |
| n8n self-hosted (VPS 72.61.48.2) | ✅ Restaurado após crise de DB |
| Evolution API multi-instância | ✅ Várias instâncias conectadas |
| Supabase secrets | ✅ GEMINI_API_KEY, OPENAI_API_KEY, EVOLUTION_API_KEY, etc |
| n8n env vars | ✅ SUPABASE_*, EVOLUTION_*, GEMINI_API_KEY |

### SDR Zap (`/sdr-zap`)

| Item | Status |
|---|---|
| Kanban 3 colunas (Todos / Minha Instância / Com Responsável) | ✅ |
| Chat inline | ✅ |
| Drag-and-drop entre instâncias | ✅ |
| Virtualização (performance) | ✅ Refatoração recente |
| Busca | ⚠️ Backlog: global |
| Filtros avançados (tag, especialidade) | ⚠️ Backlog |

### Task Flow (`/task-flow`)

| Item | Status |
|---|---|
| Board Kanban configurável | ✅ |
| Perfis (Iza, Mariana, Maikon) | ✅ |
| Checklists, anexos, comentários | ✅ |
| Contador "realizadas hoje" no header | ✅ Fix aplicado nessa sessão |
| Dashboard de produtividade | ✅ |

### Contatos (`/contatos`)

| Item | Status |
|---|---|
| CRUD + importação CSV/VCF | ✅ |
| Sync Evolution API | ✅ |
| Classificação IA (perfil profissional) | ✅ |
| Foto de perfil auto | ✅ |
| 3022 contatos na base | - |

### Disparos em massa

| Item | Status |
|---|---|
| Criação de campanha com briefing_ia + chip_ids + horários | ✅ |
| Motor anti-ban (`processar-campanha-v2`) | ✅ Em produção |
| Spintax + placeholders | ✅ |
| Chip rotation + fallback | ✅ |
| Auto-pause de chip (>30% erro) | ✅ |
| Notificação quando chip pausa | ✅ Novo essa sessão |
| Pg_cron 10min | ✅ |
| UI Campanhas (criar/editar/ativar/pausar) | ✅ |
| UI Leads | ✅ |
| UI Envios | ✅ |
| UI Blacklist | ✅ |
| UI Relatórios por campanha | ✅ Novo essa sessão |
| Handoff múltiplo | ✅ Novo essa sessão |

### IA responder conversacional

| Item | Status |
|---|---|
| Workflow n8n "Maikonect IA Responder v2" (22 nodes) | ✅ Ativo |
| Prompt estilo sigma (XML tags, naturalidade, anti-loop) | ✅ |
| Gemini 2.5 Flash com responseSchema | ✅ |
| Multi-msg com delay humanizado | ✅ Novo essa sessão |
| Typing indicator (presence composing) | ✅ |
| Handoff automático pra múltiplos telefones | ✅ Novo essa sessão |
| Histórico lido de `messages` | ✅ |
| Whisper transcreve áudio | ✅ Novo essa sessão |
| Vision descreve imagem | ✅ Novo essa sessão |
| Fila campanha_msg_queue + debounce 10s | ✅ Novo essa sessão |
| LGPD opt-out automático | ✅ Novo essa sessão |
| Teste end-to-end passou (mock) | ✅ |
| Teste com lead real | ❌ Aguardando Izadora reativar |
| Ajuste fino do prompt pós-observação | ❌ Fase seguinte |

**Por que 90% e não 100%:** o workflow passou teste sintético mas nunca rodou com um lead real respondendo mensagens ambíguas, áudios longos, fotos de documentos etc. O prompt provavelmente vai precisar ajustes finos após as primeiras 10-20 conversas reais.

### Resumo diário 18h

| Item | Status |
|---|---|
| Edge function `resumo-campanhas-diario` | ✅ Deployada |
| Workflow n8n `ResumoDiario18h` (3 nodes + 2 sends) | ✅ Ativo |
| Envia pra Maikon + Raul via WhatsApp | ✅ |
| Schedule trigger 18h BRT diário | ✅ |
| Primeira execução real com formato novo | ⏸️ Hoje 18h |

### Google Calendar OAuth

| Item | Status |
|---|---|
| Migration + edge functions deployadas em 19/04 | ✅ |
| Tabela `google_accounts` criada | ✅ |
| Edge `google-oauth-init` + `google-oauth-callback` + `google-calendar-sync` | ✅ |
| UI em `/perfil` pra conectar contas | ✅ |
| **Setup Google Cloud Console** (criar OAuth client) | ❌ Manual pendente |
| **Secrets no Supabase** (CLIENT_ID, SECRET, REDIRECT_URI, ENCRYPTION_KEY) | ❌ Manual pendente |
| **ALTER DATABASE SET app.service_role_key** pro pg_cron | ❌ Manual pendente |

**Ver:** `~/.claude/projects/.../memory/project_google_calendar_pending.md`

---

## Métricas de volume

| Métrica | Valor (23/04/2026) |
|---|---|
| Contatos na base | 3022 |
| Messages históricos | ~34k |
| Campanhas cadastradas | ~10 (algumas teste) |
| Instâncias WhatsApp configuradas | ~8 |
| Migrations n8n | 149 |
| Workflows n8n ativos | 11 |
| Credentials n8n | 14 |
| Edge functions deployadas | ~40+ |

---

## Tecnical debt

| Débito | Impacto | Prioridade |
|---|---|---|
| Dois modelos de mensagem (`mensagens` e `messages`) coexistem | Médio — confunde ao adicionar features | Alto |
| `Equipe.tsx` existe sem rota (código morto) | Baixo | Baixo |
| `update_workflow_v2.py` usa `update:workflow` (deprecated no n8n) | Baixo — funciona | Baixo |
| Sem testes unitários no frontend | Médio | Médio |
| Sem CI/CD explícito (Lovable pega direto do main) | Médio | Médio |
| `docs/` tem muitos planos antigos misturados | Baixo | Baixo |
| Backup automático do Supabase — verificar frequência | Alto | Alto |

---

## Próximas prioridades (ordem sugerida)

1. **Teste real com lead da Izadora** — bloqueador pra "100%" da IA
2. **Cadência multi-toque** — se taxa de resposta baixa após teste
3. **Setup Google Calendar manual** — 3 passos manuais documentados
4. **openclaw** — quando Raul decidir qual agente usar
5. **Melhorias no relatório** (gráfico temporal, drill-down)
6. **Limpeza de technical debt** — unificar `mensagens`/`messages`
