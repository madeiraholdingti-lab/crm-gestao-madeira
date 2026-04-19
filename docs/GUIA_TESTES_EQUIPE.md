# Guia de Testes — Maikonect CRM

**Para:** Dr. Maikon Madeira, Isadora (secretária), Mariana (secretária)
**Atualizado em:** 19/04/2026
**Link do sistema:** https://crm-gestao-madeira.lovable.app

Este guia lista, por papel, o que cada pessoa deve testar pra validar as novas funcionalidades. Em caso de erro ou dúvida, anotar a tela + descrição e enviar pro Raul.

---

## Índice

1. [Dr. Maikon — 10 cenários](#-dr-maikon--10-cenários-de-teste)
2. [Isadora / Mariana — 7 cenários](#-isadora--mariana--7-cenários-de-teste)
3. [Aparência e UX gerais](#-aparência-e-ux-gerais)
4. [Reportar problemas](#-reportar-problemas)

---

## 👨‍⚕️ Dr. Maikon — 10 cenários de teste

### 1. Resumo diário às 18h no WhatsApp
**O que testar:** entre as 18:00 e 18:05 BRT, você deve receber no seu WhatsApp uma mensagem automática com:
- Total de conversas do dia
- Pendentes por secretária (Isadora / Mariana / Sem dono)
- Alertas de urgência (se houver)

**Status esperado:** ✅ já funciona hoje

---

### 2. Abrir o app no celular/computador
**Passos:**
1. Acessar https://crm-gestao-madeira.lovable.app
2. Login com seu email + senha
3. Deve cair na tela Home com 4 seções: **Briefing IA**, **Monitor de Atendimento**, **Agenda do Dia**, **Produtividade de Tarefas**, **Métricas de Disparos**, **Próximas Tarefas**

**Validar:**
- O Briefing IA mostra um parágrafo explicando o estado atual
- Monitor tem 2 botões no canto superior direito: "Hoje" (padrão) e "Histórico"
- A Agenda pode estar vazia se você não conectou o Google Calendar ainda (ver cenário #5)

---

### 3. Monitor de Atendimento — filtro de pendências
**O que mudou:** antes mostrava pendências de 90+ dias como se fossem urgências reais. Agora filtra por 30 dias no máximo e tem toggle pra ver só as de hoje.

**Passos:**
1. No Home, olhar o Monitor de Atendimento
2. Clicar em **"Hoje"** — deve mostrar só pendências com última interação dentro do dia corrente
3. Clicar em **"Histórico"** — mostra pendências dos últimos 30 dias
4. Em cada linha da lista, confirmar que aparece:
   - Nome do contato
   - Badge roxo com perfil profissional (cirurgião cardíaco, paciente, etc.) — se o contato tiver
   - Nome da secretária responsável com bolinha colorida (ou "Sem atribuição")
   - Tempo sem resposta em horas (⏰ 3h)
   - Preview da última mensagem em cinza abaixo

**Validar:** nada mais de pendências de 90 dias bagunçando o painel. Se algo mais velho aparecer, reportar.

---

### 4. SDR Zap — atribuir conversa pra Isadora ou Mariana
**O que mudou:** antes não dava pra marcar quem estava responsável por cada conversa. Agora dá.

**Passos:**
1. Menu → **SDR Zap**
2. Escolher uma conversa qualquer na lista da Col1
3. Passar o mouse sobre o card — aparece um ícone `⋮` à direita
4. Clicar no `⋮` → **"Atribuir para…"**
5. Escolher Isadora, Mariana, você, ou Raul
6. O card deve mostrar imediatamente um **badge colorido com o nome** da pessoa atribuída
7. No filtro superior: clicar em **"Minhas"** pra ver só as suas, **"Sem dono"** pra ver as não atribuídas, **"Todas"** pra ver tudo

**Validar:** o nome + cor aparecem no card. Trocar de "Minhas" pra "Sem dono" filtra corretamente.

---

### 5. Conectar Google Calendar (suas 2 contas)
**O que foi preparado:** tela em `/perfil` pra você autorizar seus emails do Google e ver a agenda automaticamente no Home.

**Passos:**
1. Menu → **Perfil**
2. Rolar até o card **"Contas Google Calendar"**
3. Clicar em **"Conectar nova conta"**
4. Na tela do Google: escolher `maikonmadeira@gmail.com` (ou `maikon.madeira@gestaoservicosaude.com.br`)
5. Google vai mostrar aviso "App não verificado" — clicar em **"Avançado"** → **"Acessar Maikonect (não seguro)"** (isso é normal em modo de teste)
6. Autorizar as permissões (vai pedir leitura do calendário + email)
7. Deve voltar pra tela de Perfil com um **toast verde** "Conta \<email\> conectada"
8. No card deve aparecer o email + badge verde "Ativa"
9. Repetir pros 2 emails

**Validar após 10min:**
1. Voltar ao **Home**
2. Olhar o card "Agenda do Dia - Dr. Maikon"
3. Deve listar os eventos agendados pra hoje (consultas, reuniões) puxados dos 2 Google Calendar

**Se a agenda estiver vazia:** (a) pode ser que não tenha evento pra hoje; (b) esperar mais 10min — o sync roda a cada 10min; (c) me avisar se depois de 20min continuar vazio e você tem certeza que tem evento no Google.

---

### 6. Criar tarefa direto de uma conversa
**O que mudou:** antes TaskFlow e SDR Zap eram silos separados. Agora cria task da conversa com 1 clique.

**Passos:**
1. SDR Zap → abrir qualquer conversa clicando
2. No cabeçalho da conversa (Col3, ao lado do nome do contato) deve ter um botão **"📋 Tarefa"**
3. Clicar → modal abre com:
   - Título pré-preenchido "Retorno: \<nome do contato\>"
   - Descrição pré-preenchida
   - Dropdown "Atribuir para" (Isadora, Mariana, Geral...)
   - Campo "Prazo" (datetime)
4. Ajustar título/prazo → clicar **"Criar tarefa"**
5. Deve aparecer toast "Tarefa criada e atribuída para \<pessoa\>"
6. Abrir **TaskFlow** pelo menu — a nova task deve estar na coluna "Caixa de Entrada" com prazo + responsável
7. Voltar ao SDR Zap — o botão "📋 Tarefa" agora tem um **badge "1"** indicando 1 tarefa vinculada à conversa

**Validar:** a secretária que você atribuiu deve receber **notificação in-app** (sininho no topo do CRM).

---

### 7. Criar lembrete pra você mesmo (follow-up)
**O que mudou:** antes o "Follow-up" só salvava data no banco sem te avisar. Agora cria um lembrete que **manda WhatsApp pro seu telefone** perto do prazo.

**Passos:**
1. SDR Zap → no card de uma conversa, clicar no `⋮`
2. Clicar em **"Follow-up"**
3. Modal abre: "Criar lembrete pra você" com texto "Você receberá uma mensagem no seu WhatsApp perto do prazo"
4. Escolher data/hora (ex: daqui 15 minutos pra testar)
5. Escrever uma nota ("Ligar pra confirmar cirurgia")
6. Clicar **"Criar lembrete"**
7. Toast: "Lembrete criado — você receberá no WhatsApp perto do prazo"

**Validar:**
- Quando chegar o prazo (até 15min antes), você deve receber no WhatsApp **do seu número cadastrado** uma mensagem tipo:
  ```
  📌 Lembrete
  Retornar: <nome do contato>
  ⏰ Prazo: 22/04 14:00
  📝 Ligar pra confirmar cirurgia
  💬 Conversa: <nome do contato>
  ```
- Abrir TaskFlow → o lembrete deve estar lá também (na Caixa de Entrada) — é a **mesma task**

**Se não chegar:** verificar se seu `telefone_contato` está cadastrado no /perfil + Instância padrão selecionada. O cron roda a cada 5min.

---

### 8. Últimas mensagens aparecem certo no chat
**Bug antigo:** em conversas longas (>1000 mensagens), as mensagens mais recentes não apareciam ao abrir a conversa.

**Passos:**
1. SDR Zap → abrir conversa da Ramone (ou qualquer outra com histórico longo)
2. Ao abrir, deve aparecer o spinner "Carregando mensagens..."
3. Quando terminar, a ÚLTIMA mensagem trocada deve ser a que está mais embaixo
4. Comparar com o celular (WhatsApp direto) pra confirmar que bate

**Validar:** a última mensagem do banco aparece. Se faltar, me avisar.

---

### 9. Nomes de contatos corrigidos
**Bug antigo:** centenas de contatos tinham nomes errados (ex: "Dr. Sandro Valério Fadel" aplicado a 356 pessoas diferentes).

**Passos:**
1. SDR Zap → rolar a lista de conversas
2. Contatos que tinham nome contaminado agora aparecem com **número do telefone** (ex: `554799732077`) em vez de nome errado
3. Quando essas pessoas mandarem mensagem nova, o nome correto delas vai aparecer automaticamente

**Validar:** não deve ter 10+ pessoas com o mesmo nome. Se ver, reportar o nome repetido.

---

### 10. Performance geral
**O que mudou:** SDR Zap antes travava com muitas conversas. Agora usa virtualização (renderiza só o visível).

**Passos:**
1. Abrir SDR Zap → rolar a lista de conversas (Col1) de cima a baixo várias vezes
2. Scroll deve ser fluido a 60fps — sem pausas
3. Clicar em várias conversas em sequência — trocas rápidas, sem congelar
4. Enviar uma mensagem — aparece instantaneamente na conversa

**Validar:** se travar, me avisar **qual ação** e **quantas conversas** tinham na lista.

---

## 👩 Isadora / Mariana — 7 cenários de teste

### 1. Visualizar suas conversas atribuídas
**Passos:**
1. Menu → **SDR Zap**
2. No topo da coluna "Todos", clicar no filtro **"Minhas"**
3. Devem aparecer só as conversas onde você foi marcada como responsável

**Validar:** se aparecer conversa que não é sua, reportar.

---

### 2. Ver notificação de tarefa nova
**Quando o Dr. Maikon criar uma tarefa pra você:**
1. Um **sininho** no topo do CRM ganha um número vermelho (ex: "1")
2. Clicar no sininho — dropdown mostra "Nova tarefa atribuída: \<título\> (prazo: \<data\>)"
3. Clicar na notificação — abre o TaskFlow filtrado pela task

**Validar:** a notificação chega em tempo real (sem precisar recarregar página).

---

### 3. Abrir uma tarefa
**Passos:**
1. TaskFlow → coluna "Caixa de Entrada"
2. Clicar em qualquer card → modal abre com:
   - Título, descrição
   - Responsável (deve ser você)
   - Prazo
   - Se a tarefa veio de uma conversa, deve ter link/referência pro SDR Zap

**Validar:** consegue mover o card entre colunas arrastando (Caixa → Analisando → Em Execução → Finalizada).

---

### 4. Criar uma tarefa pro Dr. Maikon
**Quando precisar lembrar ele de algo:**
1. TaskFlow → botão "Nova tarefa" (ou ícone `+`)
2. Preencher título ("Retornar Dr. João", etc.)
3. **Atribuir para:** escolher Dr. Maikon
4. Prazo: quando ele deve ser lembrado
5. Criar

**Validar:** ele recebe notificação in-app (sininho) e, se a task for do tipo "lembrete", também recebe WhatsApp perto do prazo. Nota: isso ainda está em evolução — pra garantir envio por WhatsApp, peça pro Raul marcar como lembrete no banco (próxima versão terá opção direta na UI).

---

### 5. Responder uma conversa
**Passos:**
1. SDR Zap → abrir conversa pendente
2. Campo de texto no rodapé
3. Digitar resposta + Enter (ou clicar em enviar)
4. Mensagem aparece **instantaneamente** na conversa com "✓" e depois "✓✓" (entregue)

**Validar:** não deve haver delay de mais de 1 segundo. Se travar ao enviar, reportar.

---

### 6. Marcar o que foi seu ou do cliente
**Nos cards de conversa:**
- Borda esquerda **verde**: você respondeu por último (cliente deve responder)
- Borda esquerda **amarela/laranja/vermelha**: cliente está esperando resposta há X horas (quanto mais vermelho, mais urgente)
- **Sem borda colorida:** conversa neutra (encerrada, agradecimento, etc.)

**Validar:** pela cor da borda, você sabe em segundos onde precisa priorizar.

---

### 7. Fazer upload de imagem/áudio/documento
**Passos:**
1. Abrir conversa → no rodapé do chat, ícone de clip 📎
2. Escolher foto / áudio / PDF
3. Enviar
4. Mensagem aparece no chat com a mídia

**Validar:** enviar pelo menos um de cada tipo (foto, áudio, documento) e conferir que o paciente recebe.

---

## 🎨 Aparência e UX gerais

**O que ficou melhor nesse mês (comparar com o que você lembra de março):**

- **SDR Zap parece WhatsApp de verdade** — fundo bege/creme, bolhas verdes pras enviadas, brancas pras recebidas
- **Cards de conversa mostram mais contexto** — preview da última mensagem, timer "Xh sem resposta", badge do perfil profissional
- **Monitor na Home** virou útil de fato — antes mostrava lixo de 90 dias; agora foca no que importa
- **Troca de conversa instantânea** — antes demorava 2-5 segundos; agora é imediata com spinner

**O que ainda vai evoluir (próximas semanas):**

- Assistente IA via WhatsApp dedicado (Dr. Maikon pergunta relatórios em linguagem natural)
- Filtro de perfil profissional nos Disparos em Massa (pra segmentar eventos tipo o de novembro)
- Melhorias de design no Briefing IA e estados vazios

---

## 📞 Reportar problemas

Se encontrar qualquer bug, comportamento estranho ou sugestão:

1. **Anotar:** qual tela, o que fez, o que aconteceu, o que esperava
2. **Se possível:** tirar print
3. **Enviar pro Raul:** WhatsApp ou mencionar na próxima reunião

Não acumule — reportar ajuda a corrigir rápido enquanto o contexto está fresco.

---

*Este documento é vivo. A cada nova entrega, ele é atualizado com os novos cenários de teste.*
