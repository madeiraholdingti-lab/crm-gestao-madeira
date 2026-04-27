# 📋 Passo a passo — Reativar a campanha "Pediatria Chapecó"

**Para:** Isadora (Iza) — operação Maikonect
**Tempo total estimado:** ~20 minutos
**Em caso de qualquer dúvida ou erro:** WhatsApp do Raul (54) 9 8435-1512

---

## ⚠️ Antes de começar — checklist

- [ ] Acesso ao CRM **https://madeiraholding.com/** (login funcionando)
- [ ] Celular com WhatsApp do **chip de disparo** "Bruna wpp3" em mãos (vou explicar abaixo)
- [ ] **20 minutos** sem interrupção pra você fazer com calma e validar cada passo
- [ ] WhatsApp do Raul aberto (caso precise tirar dúvida na hora)

---

## Visão geral — o que vamos fazer

A campanha "Pediatria Chapecó" já existe no sistema, **mas está em rascunho** — ou seja, não dispara nada. Pra ela voltar a operar, você vai:

1. **Reconectar 1 chip de disparo** via QR Code (porque os chips estão offline desde o fim de semana)
2. **Editar a campanha** pra apontar pro chip recém-conectado e ajustar 1 detalhe
3. **Mudar o status pra "Ativa"** — daí o sistema começa a disparar sozinho
4. **Acompanhar a primeira hora** pra garantir que tudo correu bem

---

## ✅ Etapa 1 — Reconectar o chip "Bruna wpp3"

### O que vai acontecer aqui

Hoje os 4 chips de disparo (Bruna wpp3, Disparos3367, Disparos Pediatria Chapecó, PacientesRafaela) estão **inativos** no sistema. Isso aconteceu porque saíram do ar no fim de semana e ninguém reconectou ainda. Sem chip ativo, **nenhuma campanha consegue disparar** — independente de você apertar play.

**Por que escolhemos a "Bruna wpp3"?** É o chip mais novo da lista (provavelmente o menos "queimado" pelo Meta). Se der ruim com ele, tentamos um dos outros.

### Como fazer

1. No menu lateral do CRM, clique em **"Configurações Zaps"** (ou abra direto em `https://madeiraholding.com/zaps`)

2. Procure o chip **"Bruna wpp3"** na lista. Se não estiver visível, role a página

3. Ao lado dele, clique no botão **"Conectar"** (ou ícone de QR Code)

4. Vai aparecer um **QR Code grande** na tela do CRM

5. Pegue o celular com o WhatsApp da Bruna wpp3:
   - Abra o WhatsApp
   - Toque nos **3 pontinhos** (canto superior direito) → **"Aparelhos conectados"** → **"Conectar um aparelho"**
   - Aponte a câmera do celular pro QR Code que está na tela do CRM

6. **Aguarde 30 a 60 segundos.** O CRM deve mostrar:
   - Bolinha verde
   - Status: **"Conectada"** ou **"Ativa"**

> **Se o QR Code expirar antes de você escanear:** ele atualiza sozinho a cada ~30 segundos. Se não atualizar, clique em "Gerar novo QR Code".

> **Se a Bruna wpp3 der problema** (não conecta, fica em loop, status "connecting" infinito): pause, me chama. Não tente forçar — pode piorar.

### Como validar que deu certo

- Volte na tela `/zaps` e confira:
  - **Bruna wpp3** → status "Ativa" (verde) ✅

---

## ✅ Etapa 2 — Editar a campanha "Pediatria Chapecó"

### O que vai acontecer aqui

A campanha está pronta com **briefing IA completo** (UTI Pediátrica, Hospital Regional do Oeste, todos os detalhes) — eu já configurei isso ontem. Falta apenas:

- Selecionar o chip que vai disparar (Bruna wpp3, que você acabou de conectar)
- **Corrigir 1 erro de digitação** no telefone de handoff (eu deixei um número sem o "9" mobile, precisa corrigir)
- Confirmar os limites de envio

### Como fazer

1. No menu lateral, clique em **"Prospecção"** (ou abra `https://madeiraholding.com/prospeccao`)

2. Procure a campanha **"Pediatria Chapecó 26/03/2026"** — vai estar com etiqueta cinza **"rascunho"**

3. Clique em **Editar** (ícone de lápis amarelo no card)

4. **Aba "Configuração":**
   - Confirme o nome da campanha
   - Tipo: **"Prospecção"**
   - Nada mais pra mexer aqui

5. **Aba "Disparo":**
   - **Selecione o chip "Bruna wpp3"** na lista de chips disponíveis
     - 🔒 Importante: os chips do Dr. Maikon, seu (Iza) e da Mariana **não vão aparecer** — isso é proposital, é proteção pra evitar que esses números sejam banidos
   - **Envios por dia:** mantenha em **70** (ou ajuste pra 50 se quiser começar mais devagar)
   - **Horário:** das **8h às 18h** (já configurado)
   - **Dias:** segunda a sexta (já configurado)
   - **Velocidade:** uma mensagem a cada 1-2 minutos (já configurado, é o seguro contra ban)

6. **Aba "Mensagem":**
   - A mensagem inicial já está pronta — fala da expansão da Pediatria pra Chapecó
   - **Não mexa** — está testada e revisada com o Dr. Maikon

7. **Aba "Briefing IA":** ⚠️ **AQUI TEM UMA CORREÇÃO IMPORTANTE**
   - Procure o campo **"Telefone de Handoff"** (telefone pra onde a IA manda alerta quando o lead "esquenta")
   - Onde está: `+555484351512`
   - Trocar para: `+5554984351512` (faltou um **9**)
   - Esse é o número do Raul. Quando a IA detectar que um pediatra demonstrou interesse forte (pediu valor, quer fechar), vai mandar um alerta pra esse número automaticamente

### O resto do briefing (já está preenchido)

Se quiser conferir o que a IA "sabe" sobre a vaga, dá uma olhada nesses campos. **Não precisa mexer**, só pra você ter contexto:

- **Hospital:** Hospital Regional do Oeste, Chapecó/SC
- **Vaga:** UTI Pediátrica, plantão 12h ou 24h, contratação PJ
- **Requisitos:** Intensivista Pediátrico com RQE em Medicina Intensiva Pediátrica OU Pediatra com experiência em UTI ped
- **Estrutura:** 10 leitos, suporte multi-especialidades, ponto de hemodiálise
- **Início:** 01/05/2026
- **Persona:** "Dr. Maikon Madeira" — colega cirurgião, não vendedor
- **Vídeo da cidade de Chapecó:** já configurado pra IA mostrar quando o médico não conhecer a região
- **Ajuda de custo:** "ver caso a caso" (IA não promete valores)

8. Clique em **"Salvar"** no rodapé

---

## ✅ Etapa 3 — Mudar o status para "Ativa"

### O que vai acontecer aqui

Esse é o passo que **liga a engine**. A partir desse momento, o sistema começa a disparar automaticamente respeitando todas as regras (horário, velocidade, anti-ban). Sem ação manual sua daqui em diante — o sistema cuida.

### Como fazer

1. Ainda na tela de edição da campanha (ou na lista de campanhas)

2. No topo, troque o status de **"Rascunho"** para **"Ativa"**

3. Confirme se aparecer um diálogo de confirmação

4. **Pronto.** A engine já está orquestrando o primeiro lote.

---

## ✅ Etapa 4 — Acompanhar na primeira hora

### O que está acontecendo nos bastidores

A cada **2-10 minutos**, o sistema escolhe um lead da fila e:

1. Substitui o `{{nome}}` na mensagem pelo nome do médico
2. Aplica **spintax** (variação automática) pra cada lead receber uma versão ligeiramente diferente — anti-detecção do Meta
3. Envia via Bruna wpp3
4. Aguarda 8-25 segundos aleatórios antes do próximo

### Como acompanhar

1. Volta na tela `/prospeccao` e clique no card da campanha **Pediatria Chapecó**

2. Você vai ver:
   - **Pendentes:** quantos ainda não foram disparados
   - **Enviados:** crescendo a cada minuto
   - **NoZap:** lead que não tem WhatsApp (o sistema pula automaticamente)
   - **Em conversa:** lead que respondeu — a IA já está conversando com ele
   - **Quentes:** lead que esquentou (pediu valor, quer fechar) — alerta vai pro Raul

3. **O que é normal:**
   - 1 a 3 minutos entre cada envio
   - Alguns "NoZap" (taxa típica: 5-10%)
   - Alguns leads não responderem nada (taxa de resposta esperada: 5-15%)

4. **O que NÃO é normal — me avisa imediatamente:**
   - Vários envios consecutivos com erro
   - Bruna wpp3 ficar offline sozinho
   - IA respondendo coisa estranha ou agressiva
   - Aviso de "chip suspeito" na tela

---

## 🆘 Se algo der errado

| Situação | O que fazer |
|---|---|
| Chip "Bruna wpp3" caiu durante o disparo | Volta no `/zaps` e reconecte via QR (mesmo procedimento da Etapa 1). O sistema retoma sozinho de onde parou. |
| Quero pausar a campanha | Em `/prospeccao`, mude o status pra **"Pausada"**. Pra retomar, volta pra "Ativa". |
| IA respondeu algo errado pra um lead | Tira print e me manda no WhatsApp. Eu ajusto o briefing imediatamente. |
| Lead reclamou ("pare", "remover") | O sistema **já trata automaticamente** — adiciona em blacklist, manda confirmação. Mas se o caso for sensível, abre a conversa no SDR Zap e responde manualmente. A IA respeita o controle humano e para. |
| Quero ver os leads que estão respondendo | Tela `Relatórios` → filtre por campanha "Pediatria Chapecó" → status "em_conversa" |
| Não consigo acessar `/zaps` ou `/prospeccao` | Limpe o cache do navegador (Ctrl+Shift+R) ou tente em outro navegador. Se persistir, me chame. |

---

## 📞 Contato direto

- **Raul (suporte técnico):** WhatsApp **(54) 9 8435-1512**
- **Dúvida sobre conteúdo da campanha** (briefing, valores, requisitos): **Dr. Maikon**
- **Pra eu acompanhar junto na primeira hora:** me avisa antes de clicar "Ativar" que eu monitoro de fora

---

## 📝 Checklist final pra imprimir / colar no monitor

```
┌─────────────────────────────────────────────────────────────┐
│  REATIVAÇÃO PEDIATRIA CHAPECÓ — Maikonect                   │
│  Iza ─ data: ___ / ___ / ___                                │
├─────────────────────────────────────────────────────────────┤
│  [ ] 1.  Conectei chip Bruna wpp3 via QR (/zaps)            │
│  [ ] 2.  Confirmei bolinha verde + status "Ativa"           │
│  [ ] 3.  Abri campanha Pediatria Chapecó (/prospeccao)      │
│  [ ] 4.  Aba Disparo: selecionei chip Bruna wpp3            │
│  [ ] 5.  Aba Briefing IA: corrigi telefone do Raul          │
│         (de +555484351512 PARA +5554984351512)              │
│  [ ] 6.  Salvei tudo                                        │
│  [ ] 7.  Mudei status pra "Ativa"                           │
│  [ ] 8.  Vi os primeiros envios saindo (Pendentes diminuiu) │
│  [ ] 9.  Avisei o Raul que ativei                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Glossário rápido (só pra contexto, não precisa memorizar)

- **Chip de disparo:** número de WhatsApp **separado** do consultório, usado só pra mandar mensagem em massa. Se for banido, atendimento da clínica não para
- **Anti-ban:** conjunto de proteções (delay aleatório, mensagem variável, rotação) pra fingir que é uma pessoa digitando
- **Briefing IA:** "instruções" que a Inteligência Artificial usa pra responder os leads que voltarem a falar com a gente
- **Handoff:** quando a IA percebe que um lead "esquentou" e passa pro humano (Raul ou Dr. Maikon)
- **Lead "frio / morno / quente":** classificação automática que a IA dá pra cada conversa (ajuda a priorizar)
- **Spintax:** mensagem com variações `{opção1|opção2}` que o sistema embaralha automaticamente

---

**Última atualização:** 27/04/2026 — Raul Seixas (Pulse-ID)

**Versão impressa:** se imprimir, sugiro a página inteira mais o checklist na última. Em A4, deve dar 3-4 páginas.
