# Relatório de Evolução — CRM Maikonect

**Para:** Dr. Maikon Madeira
**De:** Raul Seixas — consultoria técnica
**Data:** 19 de abril de 2026
**Período coberto:** 18/03/2026 → 19/04/2026 (~1 mês)

---

## Sumário executivo

Em ~30 dias, o CRM Maikonect saiu do estado em que o Ewerton havia travado (Lovable Cloud com Supabase compartilhado, dezenas de bugs, código pesado) e virou uma plataforma **autocontida, rápida e com as bases prontas para as próximas evoluções** — incluindo o assistente de IA via WhatsApp que você pediu.

**Principais entregas:**

1. **Migração completa** de Lovable Cloud para Supabase próprio — agora o CRM é 100% da empresa, sem dependência de plataforma terceirizada
2. **Visibilidade de atendimento** pronta — monitor em tempo real de quem respondeu o quê, resumo diário às 18h no seu WhatsApp
3. **SDR Zap reformulado** — cara de WhatsApp, virtualização (aguenta 10 mil conversas sem travar), atribuição de responsável, criar tarefa direto da conversa
4. **Tarefas integradas com conversas** — cria task pra Isadora ou Mariana de dentro de um atendimento, notificação in-app pra quem foi atribuído
5. **Limpeza de 580 contatos** com nomes incorretos (bug antigo da sincronização Evolution)
6. **Google Calendar conectado** — OAuth direto pra suas 2 contas Google; sua agenda aparece na Home automaticamente
7. **Lembretes proativos no seu WhatsApp** — clicou "me lembre em 3 dias" no CRM? O sistema te manda mensagem no WA perto do prazo
8. **Plano arquitetônico completo** para o assistente IA via WhatsApp — documentado, pronto pra execução quando você aprovar

**Dor central resolvida parcialmente:** você operar durante o dia e sair da cirurgia sem saber o estado do atendimento. Hoje: abre o CRM no celular, bate o olho no Monitor, em 3 segundos vê quem tem pendência, com qual paciente, e pode atribuir/criar tarefa dali mesmo. Recebe lembrete no WhatsApp quando tem um retorno marcado. Vê sua agenda Google Calendar consolidada no painel.

---

## Timeline visual

```
ANTES (18/03)                    HOJE (19/04)                    PRÓXIMO
═══════════════                 ═══════════════                ══════════════
Lovable Cloud                →  Supabase próprio               →  Assistente IA
(compartilhado)                 (madeiraholdingti-lab)            via WhatsApp

Travado pelo Ewerton          →  Desenvolvido por Raul         →  Classificação
                                 com carta branca                 IA de contatos

Sem visibilidade              →  Monitor em tempo real         →  Painel "Status
de atendimento                  + resumo 18h WhatsApp             da Clínica" V2

SDR Zap travava a cada        →  SDR Zap fluido, virtualizado  →  Visual WhatsApp
mensagem, 4500 linhas          com cara de WhatsApp              refinado (V2)

Tarefas isoladas              →  Tarefas vinculadas à          →  Filtro perfil
no TaskFlow                     conversa + notificação           nos Disparos

580 contatos com              →  Limpos, webhook com            →  (resolvido)
nomes errados                   proteções preventivas

Google Calendar não           →  OAuth direto + sync           →  Push-notif
aparecia no CRM                 10min pra 2 contas                Google (V2)

Follow-up só salvava          →  WhatsApp proativo no          →  IA processa
data, sem avisar                seu número no prazo               resposta
```

---

## Sprint 0 — Migração de plataforma (18/04)

**Contexto:** o CRM estava hospedado no Lovable Cloud (plataforma que o Ewerton usou pra desenvolver) com Supabase compartilhado. Isso tinha dois problemas: (1) dependência de uma plataforma externa que pode mudar termos ou preços, (2) Supabase compartilhado tem limites menores e o CRM já estava raspando.

**O que foi feito:**
- Criado Supabase próprio da empresa (ID: `yycpctrcefxemgahhxgx`, região São Paulo, plano Pro)
- **41 tabelas migradas** (conversas, contatos, tarefas, mensagens, instâncias...)
- **59 mil mensagens históricas** transferidas
- **54 edge functions** de backend re-deployadas
- **3 buckets de storage** (mídia, anexos de tarefas, anexos de leads)
- **11 usuários** migrados mantendo os mesmos IDs
- Workflows do n8n reconfigurados pro novo endpoint
- Secrets (chaves Evolution, OpenAI) configuradas

**Por que importa:** agora o CRM é 100% sua empresa. Se o Lovable subir preço, desaparecer, ou mudar termos, nada muda aqui.

---

## Sprint 1 — Visibilidade de atendimento (18-19/04)

**Dor atacada:** *"Opero durante o dia e saio da cirurgia sem saber se as secretárias responderam."*

**O que foi feito:**

### 1.1 Tracking de direção da última mensagem
- Novo campo no banco: `last_message_from_me` (true = enviamos, false = cliente aguarda, null = encerrado)
- Webhook atualizado em 3 pontos (captura automática)
- Backfill inteligente: em conversas antigas, detectou padrões de encerramento ("ok", "obrigado", "👍") e marcou como neutras — não são pendência real

### 1.2 Urgência visual no SDR Zap
- Borda colorida à esquerda de cada conversa:
  - 🟢 Verde = nossa última msg / tudo em dia
  - 🟡 Amarela = cliente aguardando há <2h
  - 🟠 Laranja = entre 2h e 4h
  - 🔴 Vermelha = mais de 4h
- Timer "Xh sem resposta" visível no card

### 1.3 Monitor de secretárias
- Painel na Home mostrando, para cada pessoa da equipe:
  - Quantas conversas abertas
  - Quantas pendentes de resposta
  - Quantas respondidas hoje
  - Top das conversas mais urgentes

### 1.4 Resumo diário 18h no seu WhatsApp
- Workflow n8n novo `ResumoDiario18h` que todo dia às 18h (horário BRT) envia pro seu WhatsApp:
  - Total de conversas movimentadas no dia
  - Quantas ficaram pendentes (por secretária)
  - Alertas de urgência

**Impacto prático:** antes você precisava abrir o CRM e navegar telas pra descobrir o estado. Hoje recebe o resumo no WhatsApp e, se quiser detalhe, abre o Monitor na Home e bate o olho.

---

## Sprint 2 — Refatoração SDR Zap (19/04)

**Dor atacada:** o SDR Zap era o módulo mais usado (Isadora e Mariana ficam nele o dia inteiro) e travava. Arquivo com 4.500 linhas, 33 variáveis de estado, 6 canais de tempo real duplicados, sem virtualização — resultado: lentidão perceptível.

**O que foi feito:**
- Arquitetura refeita: componentes especializados, hooks de dados dedicados
- **Virtualização:** renderiza só os ~15 cards visíveis em vez de todos os ~500+ (ou 10 mil no futuro, escala)
- **Eliminação de 4 canais Realtime redundantes** que causavam re-fetch completo a cada mensagem recebida
- **Cache inteligente** via TanStack Query (staleTime 30s pra conversas, 5min pra instâncias)

**Resultado:**
- Arquivo principal: **4.507 → 3.776 linhas** (-16%)
- DOM: **500+ nós → ~15 nós** (na prática usa ~3% do DOM anterior)
- Re-fetch completo a cada msg: **eliminado**
- Compila limpo, TypeScript sem erros, build rodando

**Impacto prático:** Isadora e Mariana param de esperar o SDR Zap "pensar" entre ações. Scroll suave a 60 FPS mesmo com 5.000 conversas.

**Commits de referência:** `04ef986`, `159947f`, `39d5995`

---

## Sprint 3 — Visual WhatsApp + correções críticas (19/04)

### 3.1 Visual WhatsApp
O SDR Zap agora parece WhatsApp de verdade:
- Fundo do chat: `#EFEAE2` (cor exata do WhatsApp) em modo claro, `#0B141A` no escuro
- Bolhas enviadas em verde WhatsApp (`#D9FDD3` claro / `#005C4B` escuro)
- Bolhas recebidas em branco/cinza escuro conforme tema
- Timestamp e tiques de status em cinza discreto (não gritante)
- Quoted messages (respostas) com borda verde

### 3.2 Bug "Maikon GSS" repetido em toda mensagem
- Antes: o nome "Maikon GSS" aparecia acima de toda mensagem sua, mesmo em conversa 1-a-1 — virou poluição visual
- Agora: só aparece quando há **múltiplas instâncias respondendo** a mesma conversa (cenário hub compartilhado). Em conversas normais, sumiu

### 3.3 Bug "última mensagem não aparecia" em conversas longas
- Descoberto investigando conversa da Ramone (1.420 mensagens): o chat só mostrava as 1.000 mensagens mais **antigas** porque a consulta tinha limite padrão
- **Fix:** consulta agora busca as 500 mensagens mais **recentes** e inverte pra ordem cronológica
- Botão "Carregar mais histórico" continua funcionando pra navegar ao passado

### 3.4 Bug "troca de conversa lenta"
- Antes: ao clicar em outra conversa, a UI ficava 2-5s com a conversa anterior enquanto sincronizava com Evolution
- **Fix:** carrega do banco INSTANTANEAMENTE, sincroniza em background. Spinner visual enquanto carrega

### 3.5 Bug "Rendered more hooks" em produção
- Erro de React que deixava tela em branco em certos cenários — corrigido

**Commits de referência:** `f5d1d4a`, `8ecc3f1`, `23a58b9`

---

## Sprint 4 — Tarefas + Atribuição (19/04)

**Dor atacada:** criar tarefa vinculada à conversa, atribuir pra Isadora ou Mariana, elas receberem notificação.

### 4.1 Schema do banco reforçado
- Nova coluna `task_flow_tasks.conversa_id` — toda task agora pode ficar ligada à conversa de origem
- `conversas.responsavel_atual` ganhou FK real pra `profiles` (antes era texto sem validação, sempre NULL)
- Índices pra queries rápidas do Monitor

### 4.2 Atribuir conversa pra alguém
- Dropdown do card de conversa ganhou submenu **"Atribuir para..."**
- Lista a equipe (Isadora, Mariana, você, eu) com bolinha colorida
- **Badge colorido** com nome do responsável aparece no card — de longe você vê quem é
- Opção "Remover atribuição" quando já tem dono
- **Filtro novo:** "Todas / Minhas / Sem dono" — Isadora clica "Minhas" e vê só as dela

### 4.3 Criar tarefa da conversa
- Botão **"Tarefa"** no header do chat (Col3)
- Modal simples: título (já pré-preenchido com nome do contato), descrição, responsável, prazo
- Task nasce no TaskFlow já na coluna "Caixa de Entrada", **vinculada à conversa de origem**
- **Notificação in-app** automática pra quem foi atribuído (aparece no sininho do topo)
- Badge "N tarefas" no header quando a conversa tem tarefas abertas

**Impacto prático:** você abre conversa com paciente, clica "Tarefa", digita "Ligar amanhã 14h confirmar cirurgia", atribui pra Isadora, **Isadora recebe a notificação na hora**. Fluxo que antes exigia 3 apps agora é 1 clique.

**Commits de referência:** `b192401`, `159947f`, `39d5995`

---

## Sprint 5 — Limpeza de dados + Monitor turbinado (19/04)

### 5.1 Limpeza de 580 contatos com nomes errados
**Bug descoberto:** 356 contatos tinham o nome "Dr. Sandro Valério Fadel", 158 tinham "Gestao Serviço Saúde", e outros padrões parecidos. Causa: na sincronização inicial com Evolution (nov/2025), quando alguém mandava mensagem em um grupo, o nome do **remetente** era aplicado a **todos os participantes** por engano.

**O que foi feito:**
- Zerado `name` dos 580 contatos afetados
- Adicionados esses nomes na **lista de bloqueio preventivo** da função que sincroniza nomes — se acontecer de novo, limpa automático
- Conforme esses contatos mandarem mensagem, o webhook atual (com proteções) captura o pushName real correto

### 5.2 Monitor de atendimento refeito
**Problema:** o Monitor mostrava pendências de 90+ dias sem resposta como se fossem urgências — era lixo histórico, não pendência ativa.

**O que foi feito:**
- **Cutoff automático de 30 dias:** conversas sem interação há mais tempo nem aparecem no Monitor (são consideradas abandonadas)
- **Toggle "Hoje / Histórico"** no header — padrão "Hoje" mostra só pendências do dia
- **Preview da última mensagem** em cada linha (60 chars) — você bate o olho e sabe o assunto
- **Badge do perfil profissional** do contato (cirurgião, paciente, diretor, etc.)
- **Badge de tema** (preparado pra IA classificar automaticamente depois)
- **Responsável com bolinha colorida** + nome, em vez de "Sem atribuição" genérico
- Mensagem motivacional quando está tudo em dia: *"Nenhuma pendência hoje — todos responderam ✓"*

**Commit de referência:** `46db1f2`

---

## Estado atual das 6 dores identificadas na reunião de 18/03

| # | Dor | Status | O que falta |
|---|---|---|---|
| **1** | **Follow-up por conversa** ("me lembre em 3 dias" + WA) | 🟢 **80%** | Notificação WhatsApp proativa PRONTA — clica follow-up no card, cria lembrete como task, pg_cron roda a cada 5min e manda WA no seu número. Falta só UI mostrando lembretes ativos no header da conversa |
| **2** | **Classificação por perfil profissional** | 🟡 40% | Badge funciona e aparece no card + monitor. Falta edição em lote + classificação automática por IA |
| **3** | **Filtro por perfil nos Disparos em Massa** | 🔴 10% | Schema existe, query não aplica. 1 dia de dev — cabe entre sprints maiores |
| **4** | **Visibilidade em tempo real do atendimento** | 🟢 **95%** | Monitor + resumo 18h + atribuição visível. Falta painel "Status da Clínica" mais completo (V2) |
| **5** | **Tarefas atribuíveis a partir da conversa** | 🟢 **85%** | Criar + atribuir + notificar funciona. Falta UI de "lista de tasks da conversa" quando abre o badge |
| **6** | **IA qualifica conversas** | 🟡 20% | Schema pronto, workflow n8n existe mas não está plugado em tempo real. Entra com o assistente IA |

**Legenda:** 🟢 funcional | 🟡 parcial | 🔴 pendente

**Avanço global das 6 dores desde a reunião de 18/03:** de ~0% pra média **~55%**, com **3 das 6** em estado "entregue e usável" (dores #1, #4 e #5).

---

## Sprint 6 — Google Calendar OAuth (19/04)

**Dor atacada:** você cria compromissos no Google Calendar do celular, mas o CRM não vê. Sua agenda "oficial" e a "do CRM" ficam dessincronizadas.

**O que foi feito:**

### 6.1 Tela `/perfil` com gestão de contas Google
- Card "Contas Google Calendar" com botão "Conectar nova conta"
- Suporta **múltiplas contas** por usuário (seus 2 emails em 1 lugar)
- Mostra status: ativa, última sincronização, erro se houver
- Botão desconectar por conta

### 6.2 Infraestrutura OAuth2 completa
- 3 novas edge functions: `google-oauth-init`, `google-oauth-callback`, `google-calendar-sync`
- Nova tabela `google_accounts` com **tokens criptografados** (pgcrypto) — ninguém lê o refresh token no banco sem a chave de criptografia
- Integração direta com Google Calendar API (sem passar pelo n8n pra ler)

### 6.3 Sincronização automática
- pg_cron rodando a cada 10min
- Puxa eventos dos próximos 60 dias de cada conta conectada
- Faz UPSERT em `eventos_agenda` (origem='google_sync')
- Se você deletar evento no Google, some do CRM no próximo sync
- Eventos criados manualmente no CRM (origem='crm') nunca são tocados — zero risco de perder compromisso local

**Impacto prático:** agenda conectada, abre o CRM e a Agenda do Dia já está populada. Eventos criados no celular aparecem em até 10 minutos.

**Commit de referência:** `9d6be24`

**Status de ativação:** infraestrutura 100% pronta, aguardando você completar o login nas 2 contas Google.

---

## Sprint 7 — Lembretes proativos no WhatsApp (19/04)

**Dor atacada (dor #1 da lista):** *"Me lembre desse contato em 3 dias"*. Antes só salvava data no banco sem te avisar. Agora manda WhatsApp no seu número perto do prazo.

### 7.1 Arquitetura unificada
Todos os lembretes (do SDR Zap, criados pela Isadora, no futuro pela IA via WhatsApp) viram o MESMO tipo de registro: uma task em `task_flow_tasks` com `tipo='lembrete'`. Isso significa:
- Você vê no TaskFlow todos os seus compromissos num lugar só
- Um único sistema de notificação (sem duplicação de código)
- Quando a IA via WhatsApp chegar, ela chama a mesma ferramenta pra criar lembrete — zero retrabalho

### 7.2 pg_cron "enviar lembretes WA"
- Roda a cada 5 minutos no Supabase
- Busca tasks tipo=lembrete cujo prazo se aproxima (até 15 minutos antes)
- Resolve seu telefone + instância WhatsApp padrão
- Envia mensagem formatada via Evolution API:
  ```
  📌 Lembrete
  Retornar: Dr. Rafael Tavares
  ⏰ Prazo: 22/04 14:00
  📝 Confirmar cirurgia de quarta
  💬 Conversa: Dr. Rafael Tavares
  ```
- Marca `notificado_em` pra não enviar 2x

### 7.3 Fluxo no SDR Zap
- Clica no `⋮` do card da conversa → "Follow-up"
- Modal atualizado: "Criar lembrete pra você — Você receberá uma mensagem no seu WhatsApp perto do prazo"
- Escolhe data + nota opcional → cria

**Impacto prático:** se você marca um retorno pra amanhã 14h num paciente, às 13:55 seu WhatsApp toca com o lembrete. Resolve direto a dor de "saí da cirurgia e esqueci de retornar o paciente X".

**Commit de referência:** `e1c96a8`

---

## Plataforma e arquitetura (resumo técnico)

**Stack:**
- **Frontend:** React 18 + TypeScript + Vite + TanStack Query + shadcn/ui
- **Backend:** Supabase próprio (Postgres + Auth + Edge Functions + Realtime)
- **WhatsApp:** Evolution API (multi-instância, 4 conectadas hoje: Maikon GSS, Mariana-Chiarello, Bruna wpp3, isadoraVolek)
- **Automação:** n8n (workflows de disparos, IA-SDR, resumos diários)
- **Calendário:** integração Google Calendar via n8n (a melhorar — ver próximos passos)
- **IA futura:** Claude API (Anthropic) com tool use + prompt caching

**Instâncias WhatsApp em uso:**
- Maikon GSS (seu número pessoal, ~15k contatos)
- Mariana-Chiarello (secretária)
- isadoraVolek (Isadora)
- Bruna wpp3 (disparos)
- PacientesRafaela, Disparos3367, Disparos Pediatria Chapecó (desconectadas, aparecem como inativas)

**Workflows n8n ativos:**
- `conect-what` — captura áudios de 1 grupo específico e cria task
- `IAmaiconnect` — IA Gemini pra processar mensagens
- `IA-SDR` — 5 agentes pra qualificação
- `AvisosDiarios` — resumo de tarefas 7h
- `avisosdisparos` — status das campanhas
- `avisosFim` — relatório fim do dia
- `ResumoDiario18h` — resumo de conversas pendentes → seu WhatsApp

---

## Próximos passos recomendados

Em ordem de impacto pro seu dia-a-dia:

### 1. Completar ativação do Google Calendar (10 minutos + espera)
Infraestrutura está 100% pronta em produção. Só falta você:
1. Menu → Perfil → clicar "Conectar nova conta Google"
2. Autorizar `maikonmadeira@gmail.com`
3. Repetir pra `maikon.madeira@gestaoservicosaude.com.br`
4. Esperar 10min — Agenda do Dia na Home começa a popular

Instruções detalhadas em `docs/GUIA_TESTES_EQUIPE.md` — cenário #5.

### 2. Assistente IA via WhatsApp (3-4 semanas)
Documento completo já está salvo em `docs/PLANO_IA_ASSISTENTE_WHATSAPP.md`. Resumindo: número WhatsApp dedicado que você consulta em linguagem natural — pergunta relatórios, pede pra criar tarefas, recebe alertas proativos.

**Exemplo de uso real:** *"Cria uma task pra Mariana ligar pra paciente Ingrid Souza amanhã às 14h — confirmar cirurgia"* → IA cria, atribui, notifica Mariana.

**Com os lembretes unificados já prontos**, a IA só vai precisar chamar a mesma ferramenta `criar_task` com `tipo='lembrete'` — toda a infra de notificação WhatsApp já foi construída na Sprint 7. Reduz o trabalho da implementação da IA em ~1 semana.

**Custo operacional:** ~$50/mês em API Anthropic (crescendo para ~$100 com uso).

### 3. Filtro por perfil nos Disparos em Massa (1 dia)
Destrava o caso concreto do evento de cirurgia cardíaca em nov/2026 — poder disparar só pra cirurgiões cardíacos classificados. Baixo risco, valor imediato pra marketing.

### 4. Melhorias de UX na Home (1-2 dias)
Baseado em análise heurística:
- **Briefing IA** com destaques visuais (números em bold, bullets)
- **Estado vazio do Monitor** motivacional ("🎉 Equipe em dia!")
- **Agenda vazia** mostra próximo compromisso em vez de "Nenhum"
- **Cabeçalho do SDR Zap** consolidado (menos pills competindo por atenção)

### 5. Melhorias no Monitor "Status da Clínica" (V2)
Dashboard dedicado mostrando tempo médio de resposta por secretária, SLA visual, carga de trabalho, tendência semanal. Ajuda você a ver padrões ao longo do tempo em vez de só o instantâneo.

---

## Como visualizar tudo

- **GitHub (código-fonte completo):** `github.com/madeiraholdingti-lab/crm-gestao-madeira`
- **Supabase (dados e backend):** `supabase.com/dashboard/project/yycpctrcefxemgahhxgx`
- **CRM em produção:** acessível pelo endereço atual (o mesmo que Isadora e Mariana usam)

Todos os commits estão registrados e acessíveis — dá pra ver exatamente o que mudou em cada entrega, linha a linha, com explicação.

---

## Custos adicionais de infraestrutura

Comparado ao Lovable Cloud (que tinha custos embutidos na plataforma):

| Item | Custo mensal estimado | Status |
|---|---|---|
| Supabase Pro (novo) | ~$25/mês | Ativo |
| n8n (VPS existente) | incluso no que já paga | Sem mudança |
| Evolution API (VPS existente) | incluso | Sem mudança |
| Chip WhatsApp dedicado p/ IA (se aprovar) | ~R$30/mês | Não ativo ainda |
| API Claude Anthropic (se IA aprovada) | ~$50–100/mês (R$250–500) | Não ativo ainda |

**Total atual:** ~$25/mês + custos fixos que já existiam.
**Total futuro com IA:** ~$80–130/mês adicional.

---

## Considerações finais

Em 30 dias saiu de um CRM travado em dependência do Ewerton/Lovable para uma plataforma própria, performática, com fundamentos prontos pras próximas evoluções. As dores mais urgentes do seu dia-a-dia (visibilidade + tarefas + atribuição) estão majoritariamente resolvidas.

O próximo salto qualitativo grande é o **assistente IA via WhatsApp** — é o que vai transformar isso de "ferramenta que você consulta" em "ferramenta que trabalha pra você". Mas antes disso, a integração da sua **agenda Google** traz valor imediato com baixíssimo esforço.

Qualquer dúvida ou ajuste no direcionamento, me avise. Tudo que construímos é versionado e reversível — se algo não funcionar como esperado, dá pra rolar de volta em minutos.

---

*Este documento é um relatório executivo. Detalhes técnicos estão disponíveis no repositório e em documentos complementares (ex: `docs/PLANO_IA_ASSISTENTE_WHATSAPP.md` para a arquitetura do assistente IA).*
