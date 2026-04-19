# Backlog de Melhorias UX/Design — Maikonect CRM

**Origem:** Auditoria heurística (Nielsen 10 + Krug) feita em 19/04/2026
**Score global atual:** 6/10 → meta 9/10 após implementar os itens 🔴
**Público-alvo primário:** Dr. Maikon (Home), Isadora + Mariana (SDR Zap, TaskFlow)

---

## Legenda

- 🔴 **Severidade 3-4 (Major/Crítico):** fixar primeiro, alto ROI
- 🟡 **Severidade 2 (Minor):** schedule fix
- 🟢 **Severidade 1 (Cosmetic):** fix se sobrar tempo
- ✅ **Implementado:** já entrou no código
- ⏳ **Pendente**

---

## 🔴 Severidade 3-4 — Prioridade máxima

### #1 Briefing IA enterra informação crítica em parágrafo corrido ⏳

**Heurística:** #8 Minimalism, Krug Lei 3 (cut words)
**Tela:** Home
**Esforço:** ~1h

**Problema:** Maikon escaneia, não lê. Número crítico ("190 tarefas atrasadas") enterrado no meio de 50 palavras.

**Fix proposto:**
- Separar em bullets com ícones de severidade (🔴 🟡 🟢)
- Métricas em bold + cor
- CTA direto ("Ver tarefas atrasadas →") quando aplicável

**Exemplo:**
```
🔴 190 tarefas atrasadas — priorizar Smart Fluency + anestesistas
🟢 0 conversas pendentes com secretárias
🟢 0 tarefas pra amanhã
```

**Arquivo:** depende de onde mora o Briefing IA (provável `src/components/BriefingIA.tsx` ou dentro de `src/pages/Home.tsx`)

---

### #2 SDR Zap — consolidar filtros em menos camadas ⏳

**Heurística:** #8 Minimalism, #6 Recognition
**Tela:** SDR Zap
**Esforço:** 2-3h

**Problema:** 4-5 controles empilhados no topo de cada coluna:
- Search
- Pills "Todas / Não lidas / Aguardando"
- Pills "Todas / Minhas / Sem dono"
- Dropdown instâncias
- Botões sync/camera

**Fix proposto:**
- Linha 1: Search (largura total) + ⚙️ drawer com instâncias + sync
- Linha 2: Segmented control unificado: `Todas | Não lidas | Aguardando | Minhas | Sem dono`

Redução: 5 controles visíveis → 3.

**Arquivos:**
- `src/components/sdr-zap/ConversationFilters.tsx`
- `src/components/sdr-zap/ConversationList.tsx`
- `src/pages/SDRZap.tsx` (header da Col1 + Col2)

---

### #3 Estado vazio da Agenda do Dia é passivo ⏳

**Heurística:** #1 Visibility, #10 Help
**Tela:** Home (AgendaList)
**Esforço:** ~1h

**Problema:** Metade do real estate mostra só "Nenhum compromisso para hoje" + ícone. Não ajuda Maikon a planejar.

**Fix proposto:**
- Se tem próximo compromisso nos próximos 7 dias: mostrar
- Se Google Calendar não conectado: CTA pra conectar
- Senão: mensagem simples

```
📅 Agenda do Dia

Sem compromissos hoje.

🔜 Próximo: amanhã 14h — Cirurgia Dr. Silva
[Ver semana completa →]
```

**Arquivo:** `src/components/AgendaList.tsx`

---

### #4 "Sem atribuição" repetido 9x no Monitor 🔴⏳

**Heurística:** #8 Minimalism
**Tela:** Home (MonitorSecretarias)
**Esforço:** 30min

**Problema:** Com 9 pendências sem dono, "Sem atribuição" aparece 9x → vira decoração cinzenta, Maikon para de registrar.

**Fix proposto:**
- Se tem dono: mostrar bolinha colorida + nome
- Sem dono: badge laranja "⚠️ Sem dono" destacado (pede ação)

**Arquivo:** `src/components/MonitorSecretarias.tsx`

---

## 🟡 Severidade 2 — Schedule

### #5 Avatar cinza genérico quebra visual do SDR Zap ⏳

**Heurística:** #4 Consistency
**Tela:** SDR Zap
**Esforço:** 2h

**Problema:** Cards sem foto mostram ícone cinza neutro — quebra o ritmo visual.

**Fix proposto:** Iniciais coloridas automáticas (hash do nome → cor determinística). Estilo Gmail/Discord. Número puro → últimos 4 dígitos.

**Arquivo:** `src/components/sdr-zap/ConversationCard.tsx`

---

### #6 "Cor do Perfil" em /perfil sem contexto ⏳

**Heurística:** #2 Match Real World, #10 Help
**Tela:** /perfil
**Esforço:** 15min

**Problema:** 8 bolinhas coloridas sem explicar pra que serve.

**Fix proposto:** Subtítulo: *"Esta cor identifica você no Monitor e nas conversas que você responde."* Opcional: preview ao vivo de um card de conversa com a cor escolhida.

**Arquivo:** `src/pages/Perfil.tsx`

---

### #7 Donut de "Tipos de Disparos" com 1 só categoria ⏳

**Heurística:** #8 Minimalism
**Tela:** Home
**Esforço:** 30min

**Problema:** Donut grande mostrando 1 fatia só é desperdício visual.

**Fix proposto:** Se só 1 tipo, trocar por frase direta ("Todos os 77 disparos do mês foram de captação"). Donut volta com 2+ categorias.

**Arquivo:** depende da localização do componente de métricas de disparos

---

### #8 Título da aba "lovably-care-hub" ⏳

**Heurística:** #4 Consistency, Trunk Test
**Tela:** Todas
**Esforço:** 15min (grátis)

**Problema:** Aba sempre mostra "lovably-care-hub". Nome velho do projeto Lovable.

**Fix proposto:**
- `index.html` → `<title>Maikonect</title>`
- Usar `<Helmet>` por página pra mostrar "Maikonect — SDR Zap", etc.

**Arquivos:** `index.html` + adicionar Helmet em cada página principal

---

### #9 Cards de "Produtividade" sem escala pra comparar ⏳

**Heurística:** #2 Match Real World, #6 Recognition
**Tela:** Home
**Esforço:** 1-2h

**Problema:** Números de Isadora vs Mariana exigem cálculo mental pra saber quem tá mais produtiva.

**Fix proposto:** Barra de progresso horizontal sob cada número mostrando proporção na equipe. Exemplo: `Isadora concluídas: 20 [████████░░] 83%`.

**Arquivo:** componente de produtividade na Home

---

## 🟢 Severidade 1 — Cosmético

### #10 Label "Follow-up" → "Criar lembrete" ⏳

**Heurística:** #2 Match Real World
**Tela:** SDR Zap (dropdown do card)
**Esforço:** 10min

**Problema:** "Follow-up" é jargão anglófono.

**Fix proposto:** Renomear dropdown item pra "📌 Lembrar-me" ou "⏰ Criar lembrete". Parcialmente já feito no modal — falta no menu.

**Arquivo:** `src/components/sdr-zap/ConversationCard.tsx`

---

### #11 Sidebar sem "você está aqui" mais forte ⏳

**Heurística:** Trunk Test
**Tela:** Todas (AppLayout)
**Esforço:** 20min

**Problema:** Item ativo com cinza sutil.

**Fix proposto:** Item ativo = fundo `bg-primary/10` + borda esquerda `3px` azul.

**Arquivo:** `src/App.tsx` (sidebar)

---

### #12 Emojis no nome de contato (observação) ⏳

**Heurística:** #2 Match Real World
**Tela:** SDR Zap, Monitor
**Esforço:** N/A

**Observação:** Pacientes podem ter emojis no nome (vindo do WhatsApp deles). Não é bug — só verificar se vira problema visual em alguma tela. Por enquanto manter.

---

## Propostas adicionais (veio da análise anterior mas fora das 12)

### #A1 Notificação com preview da nova task no sininho 🟡⏳
Clicar no sino deve mostrar o título da task atribuída + prazo (hoje só badge "9+").

### #A2 Espaço morto Col2 do SDR Zap quando vazia 🟡⏳
"Minha Instância (0)" ocupa coluna inteira vazia. Colapsar ou reduzir.

### #A3 Sombras sutis nos cards 🟢⏳
`shadow-sm` dá profundidade sem poluir. Cards hoje são bordas chapadas.

### #A4 "Ver tarefas atrasadas →" no Briefing IA já existe mas pode destacar 🟢⏳

---

## Meta pós-implementação

| Momento | Score | Deltas |
|---|---|---|
| Atual (pré-refactor UX) | 6/10 | Baseline |
| Após itens #1, #2, #3 | ~8/10 | Home + SDR Zap — maior uso diário |
| Após todos 🔴 (+#4) | ~8.5/10 | Bate 🟢 nas 10 heurísticas |
| Após todos 🟡 | ~9/10 | Polido |
| Após todos 🟢 | ~9.5/10 | Craft nível "wow" |

---

*Este backlog é vivo. Cada item implementado vira ✅. Novos achados em auditorias futuras entram como #13, #14, etc.*
