# Guia passo-a-passo — Izadora testar Disparos em Massa

Este guia é pra você (Izadora) reativar e validar a campanha de disparos, incluindo a IA que conversa com os leads. Qualquer dúvida, me chama.

---

## O que mudou (resumo)

1. **IA conversando com os leads automaticamente** (em vez de ficar aguardando alguém responder manualmente)
2. **Lembrete Dr. Maikon corrigido** — o aviso diário das 7h agora pega TODAS as tarefas da coluna "Lembrar Dr. Maikon", agrupando por urgência (atrasadas, hoje, amanhã, futuras)
3. **Vários responsáveis podem receber alerta de handoff** (antes só 1)
4. **Resumo diário 18h** agora também traz status das campanhas (não só SDR Zap)

---

## Passo 1 — Revisar a campanha antes de ativar

Acessa `/disparos-em-massa/campanhas`. Na lista, acha a campanha que você quer reativar.

Clica em **Editar** (ícone de lápis). Confere **TODOS os campos da aba** de criação:

### Aba **Config**
- ✅ Nome da campanha tá certo
- ✅ Tipo (prospecção, evento, reativação, etc) tá certo
- ✅ Descrição (opcional, pra você lembrar do que é)
- ✅ **Filtros** — se você quer mandar só pra uma especialidade ou tipo de lead, confirma que tá marcado

### Aba **Disparo**
- ✅ **Chips selecionados** — quais números WhatsApp vão disparar. Se tiver mais de 1, eles rodam em rotação (anti-ban).
- ✅ **Envios por dia** — tipicamente 120 (se tiver 2 chips, dá 60 por chip. Passar disso arrisca banimento)
- ✅ **Horário início/fim** — 09:00 às 18:00 é o padrão (não dispara fora disso, fica mais natural)
- ✅ **Dias da semana** — confere que só tá ligado Seg-Sex se for só dia útil

### Aba **Mensagem**
- ✅ O **texto** que vai ser enviado. Testa fazer a leitura em voz alta, imagina um médico lendo sem contexto.
- ✅ Se usar **spintax** (ex: `{Oi|Opa|E aí}`), confirma que o switch "Spintax ativo" tá ON

### Aba **Briefing IA** (a mais importante agora)
- ✅ **IA ativa** — liga o toggle
- ✅ **Persona** — quem é você nessa conversa. Ex: "Você é da equipe do Dr. Maikon Madeira, cirurgião cardíaco em Itajaí/SC. Fala direto, sem formalidade."
- ✅ **Contexto** — o que é a situação. Ex: "Essa é uma campanha pra cirurgiões cardíacos interessados em evento técnico em novembro/2026."
- ✅ **Objetivo** — o que a IA deve fazer. Ex: "Qualificar interesse no evento. Se demonstrar interesse, escalar pra Iza ou Mariana."
- ✅ **Telefones de handoff** — quem recebe alerta quando a IA detectar lead interessado ou perguntando valor. Pode colocar MAIS DE UM (separa por vírgula). Ex: `5547999999999, 5547988888888`
- ✅ **Palavras-chave pra escalar** — o que dispara alerta automático. Padrão: `salário, valor, remuneração`

💡 **Dica**: o briefing é a alma da IA. Quanto mais contexto você der, mais natural ela vai responder. Se ficar só com o mínimo, ela vai genérico.

---

## Passo 2 — Ativar a campanha

Com tudo revisado, clica em **Salvar**. Depois, na lista de campanhas, clica em **Ativar** (botão verde).

- O status muda pra **ATIVA**
- Nos próximos 10 minutos, o sistema pega o primeiro lote de leads (do filtro que você configurou)
- As mensagens começam a sair respeitando o horário e os chips

---

## Passo 3 — Acompanhar em tempo real

### 3.1 Ver o que está sendo enviado

Vai em `/disparos-em-massa/envios`. Aqui você vê cada lead com:
- Status: `pendente` (ainda não saiu), `enviado` (mandado mas sem resposta), `em_conversa` (lead respondeu, IA conversando), `qualificado` (IA escalou pra humano), `descartado` (lead deu opt-out ou rejeitou)
- Horário de envio
- Horário da resposta (se houver)

### 3.2 Ver as métricas macro

Vai em `/disparos-em-massa/relatorios` (novidade!).

Nos cards do topo você vê:
- **Enviadas hoje** — total do dia
- **Respostas hoje** — quem respondeu
- **Quentes (qualificados)** — leads que a IA identificou como interessados
- **Em conversa agora** — leads onde a IA tá trocando msgs

E no grid abaixo, um card por campanha com taxa de resposta, taxa de qualificação, etc.

### 3.3 Ver as conversas individuais

Cada lead que responder vai aparecer no **SDR Zap** normalmente. Mas diferente de antes, **a IA vai responder SOZINHA nos primeiros 10-20s**. Não precisa que você responda manualmente.

Você pode entrar na conversa e ver o que a IA tá falando. Se ficar estranho:
1. **Assume a conversa** (botão "Assumir" ou mudar o responsável)
2. A IA **para automaticamente** quando detectar que alguém assumiu

---

## Passo 4 — Quando o alerta de handoff chega

Quando a IA identificar um lead interessado OU o lead perguntar sobre valor/salário, os telefones configurados no briefing recebem uma msg WhatsApp tipo:

```
🚨 Lead pediu atenção — <NOME DA CAMPANHA>

Telefone: 5554988888888
Motivo: perguntou valor

Última msg do lead: "qual o salário?"

Abra a conversa no CRM pra assumir.
```

**O que você faz**:
1. Abre o SDR Zap
2. Busca pelo telefone do lead
3. Assume a conversa e continua o papo humanamente
4. Dá as informações que a IA não pode dar (valores, detalhes financeiros)

---

## Passo 5 — Opt-out (LGPD)

Se um lead responder "parar", "não quero mais", "cancelar" etc., o sistema:
1. Para TODAS as campanhas desse telefone automaticamente
2. Adiciona na **blacklist** (nunca mais recebe)
3. Manda msg de confirmação LGPD automática

**Você não precisa fazer nada.** Só saber que funciona.

---

## Passo 6 — Se o chip for banido

Se o WhatsApp banir um chip (taxa de erro acima de 30% nas últimas 20 msgs), o sistema:
1. Para de usar aquele chip automaticamente (tira da rotação)
2. Manda notificação in-app pros admins
3. Se tiver outro chip saudável, continua a campanha normalmente com os outros

Você vai ver o aviso em `/zaps` (indicador vermelho no chip problemático). Aí você tenta reconectar.

---

## Passo 7 — Resumo diário 18h

Todo dia às 18h, o Dr. Maikon (e você, Raul) recebem um WhatsApp com:
- **SDR Zap:** conversas pendentes por secretária (você + Mariana)
- **Campanhas:** quantos disparados hoje, respostas, quentes, descartados
- **Chips pausados** (se houver)
- **Leads quentes aguardando handoff** (top 5)

Não precisa fazer nada, é automático.

---

## Passo 8 — Aviso das 7h (Lembrar Dr. Maikon)

Todo dia às 7h, o Dr. Maikon recebe a lista da coluna **"Lembrar Dr. Maikon"** do TaskFlow.

**Mudou:** antes vinha só tarefas com prazo exato de hoje. Agora vem TODAS da coluna (qualquer tarefa que você colocou lá está nessa lista), agrupadas por urgência:
- 🔴 **ATRASADAS** (prazo passou)
- 🟡 **HOJE**
- 🟢 **AMANHÃ**
- ⏳ **FUTURAS**
- 📝 **SEM PRAZO**

Então se você move uma tarefa pra essa coluna, o Maikon vai ser lembrado dela todo dia até você tirar.

---

## Checklist final antes de reativar a campanha

- [ ] Fiz revisão completa nas 4 abas da campanha
- [ ] Briefing da IA tem persona + objetivo claros
- [ ] Configurei pelo menos 1 telefone de handoff (ideal: eu + Mariana)
- [ ] Chips selecionados estão conectados (verde em /zaps)
- [ ] Horário de disparo é só em horário comercial
- [ ] Se é teste, coloquei filtro pra mandar pra poucos leads primeiro (5-10)
- [ ] Vou monitorar nas primeiras 2h pra ver se a IA tá respondendo natural

---

## O que fazer se algo der errado

### "A IA não respondeu o lead"

- Abre `/disparos-em-massa/envios` e confere se o status ficou em `em_conversa`
- Se ficou em `em_conversa` há mais de 2min sem resposta da IA → me chama (Raul)
- Se o lead acabou de mandar, aguarda 15s (há um debounce pra evitar IA responder múltiplas vezes seguidas)

### "A IA respondeu algo esquisito/robô"

- Tira print da conversa e me manda
- Vamos ajustar o prompt baseado no que observarmos

### "O chip caiu"

- Vai em `/zaps`, vê se tem chip com status vermelho/suspeito
- Se sim: abre Evolution, reconecta com QR Code
- Depois, no CRM, clica em "reativar chip" (ou muda o status pra conectada)

### "Recebi alerta de handoff mas não tenho contexto"

- Abre o SDR Zap, busca pelo telefone do lead
- Lê a conversa completa ali mesmo (a IA manteve todo o histórico)
- Responde humanamente a partir daí

---

## Contatos

Dúvida urgente durante o teste: me chama no WhatsApp direto (Raul).
