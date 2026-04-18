# Fase 4 — Agente de Tarefas por Linguagem Natural

**Princípio:** Um médico entre cirurgias não preenche formulário.
Ele fala ou digita uma frase e o sistema entende, cria e notifica.
Usabilidade é prioridade absoluta sobre funcionalidade.

---

## O que é

Uma barra de input flutuante disponível em qualquer página do CRM onde o
Dr. Maikon (ou qualquer usuário) digita uma instrução em linguagem natural,
e o sistema:
1. Interpreta a intenção (criar tarefa, criar lembrete, disparar mensagem)
2. Exibe confirmação do que entendeu antes de executar
3. Executa e notifica os envolvidos via WhatsApp

---

## Interface — "Comando rápido"

### Acesso
- Atalho de teclado: `Cmd/Ctrl + K` (abre modal de comando)
- Botão flutuante no canto inferior direito (ícone de microfone/lápis)
- Campo fixo no topo do Home (versão desktop)

### Fluxo de uso

```
1. Usuário abre o modal de comando

2. Digita: "Iza precisa enviar os exames da Dona Maria até sexta"

3. Sistema exibe confirmação:
   ┌──────────────────────────────────────────┐
   │ Entendi isso:                            │
   │                                          │
   │ 📋 Nova tarefa                           │
   │ Título: Enviar exames Dona Maria         │
   │ Para: Iza                                │
   │ Prazo: sexta-feira, 27/03               │
   │ Notificar Iza via WhatsApp: sim          │
   │                                          │
   │ [Confirmar]  [Editar]  [Cancelar]        │
   └──────────────────────────────────────────┘

4. Usuário confirma → tarefa criada no Task Flow + WA enviado para Iza
```

---

## Exemplos de comandos suportados

| Input | Ação gerada |
|-------|------------|
| "Lembra de ligar pro Dr. Silva amanhã às 14h" | Lembrete pessoal com notificação WA |
| "Iza precisa enviar receita para João até hoje" | Tarefa para Iza com prazo hoje |
| "Me avisa sobre a Dona Maria na semana que vem" | Follow-up agendado na conversa dela |
| "Mariana, confirmar consulta do Dr. Roberto na quinta" | Tarefa para Mariana |
| "Cancelar minha cirurgia de amanhã" | Cria tarefa de aviso, não cancela diretamente |

---

## Arquitetura técnica

### Nova edge function: `interpretar-comando`

```typescript
interface ComandoInput {
  texto: string
  user_id: string
  contexto?: {
    conversa_id?: string   // se abriu o comando dentro de uma conversa
    contato_id?: string
  }
}

interface ComandoOutput {
  tipo: 'tarefa' | 'lembrete' | 'follow_up' | 'nao_entendeu'
  dados: {
    titulo?: string
    descricao?: string
    responsavel?: string     // user_id resolvido
    responsavel_nome?: string
    prazo?: string           // ISO date
    conversa_id?: string
    contato_nome?: string
    notificar_wa?: boolean
  }
  confianca: 'alta' | 'media' | 'baixa'
  confirmacao_texto: string  // frase legível do que vai fazer
}
```

**Prompt para OpenAI:**
```
Você é um assistente do Dr. Maikon Madeira. Interprete o comando abaixo e
retorne JSON com a ação a ser tomada.

Usuários do sistema:
- "Iza" ou "Isadora" = user_id: [ID_DA_IZA]
- "Mariana" = user_id: [ID_DA_MARIANA]
- "eu" ou "Maikon" = user_id: [ID_DO_MAIKON]

Data atual: {data_atual}
Contexto: {contexto_da_conversa_se_houver}

Comando: "{texto_do_usuario}"

Responda apenas com JSON válido seguindo o schema fornecido.
```

### Novo componente: `ComandoRapidoModal.tsx`

```typescript
// Acessível via Context global (OverlayAppsContext já existe — usar)
// Estados:
// - idle: campo vazio
// - loading: chamando edge function
// - confirmando: mostrando o que entendeu, aguardando confirmação
// - executando: criando tarefa/lembrete
// - sucesso: ação realizada

// Após confirmação, executa:
// tipo === 'tarefa' → INSERT em task_flow_tasks
// tipo === 'lembrete' → INSERT em notificacoes + scheduled_messages
// tipo === 'follow_up' → UPDATE em conversas (campo follow_up_em)
```

### Notificação via WhatsApp

Quando uma tarefa é criada com responsável = Iza ou Mariana:
- Chamar `enviar-mensagem-evolution` para o número delas
- Mensagem: "📋 Nova tarefa atribuída a você:\n{titulo}\nPrazo: {prazo}\nVer no CRM: {link}"

---

## Notas de UX críticas

**Regra de ouro: nunca executar sem confirmação visual.**
O usuário vê o que o sistema entendeu ANTES de qualquer ação. Isso evita
que uma interpretação errada da IA cause problema.

**Confiança baixa = edição obrigatória.**
Se `confianca === 'baixa'`, o modal abre já no modo de edição (não no de
confirmação), forçando o usuário a revisar antes de confirmar.

**Fallback gracioso.**
Se a IA não entender (`tipo === 'nao_entendeu'`), mostrar:
"Não entendi esse comando. Tente: 'Tarefa para Iza: [descrição] até [data]'"

---

## Fase 4b — Follow-up por conversa (lembrete simples)

Antes do agente completo, implementar a versão simples dentro do SDR Zap:

No menu de ações da conversa (já existe), adicionar:
"⏰ Definir follow-up"
→ Abre popover com seletor de data/hora
→ Salva campo `follow_up_em` na tabela `conversas`
→ Cron verifica a cada 15min e dispara notificação WA para o responsável

```sql
ALTER TABLE conversas
  ADD COLUMN IF NOT EXISTS follow_up_em timestamptz,
  ADD COLUMN IF NOT EXISTS follow_up_nota text;

CREATE INDEX IF NOT EXISTS idx_conversas_follow_up
  ON conversas(follow_up_em)
  WHERE follow_up_em IS NOT NULL;
```

---

## Fase 4c — Horário visível no "Lembrar Dr. Maikon" (pedido da Iza, 26/03/2026)

A Iza pediu que as tarefas na coluna "Lembrar Dr. Maikon" mostrem o horário do prazo.

### Mudança necessária
No componente do card de tarefa (`TaskFlowCard.tsx` ou similar), quando a tarefa
está na coluna "Lembrar Dr. Maikon":
- Exibir hora do prazo no card: `format(prazo, "HH:mm")` além da data
- Destaque visual para tarefas com prazo nas próximas 2 horas

**Esforço:** Baixo — mudança em 1 componente. Verificar se o campo `prazo` armazena hora
(é `timestamptz`, então sim).

---

## Fase 4d — Criar tarefa a partir de conversa no SDR Zap (documentado como pendente)

Atualmente, criar tarefa a partir de uma conversa **só existe via webhook externo** (n8n).
O Dr. Maikon pediu integração mais fluida (Sprint item 5 no CLAUDE.md).

### Fluxo proposto
1. Usuário abre menu de ações da conversa no SDR Zap
2. Clica em "Criar Tarefa"
3. Modal abre pré-preenchido:
   - Título: nome do contato
   - Descrição: última mensagem da conversa
   - Link para a conversa (campo `origem_conversa_id`)
4. Usuário ajusta título, seleciona responsável, define prazo
5. Confirma → tarefa criada no Task Flow
6. Badge ou indicador na conversa mostra que há tarefa vinculada

### Migration necessária
```sql
ALTER TABLE task_flow_tasks
  ADD COLUMN IF NOT EXISTS origem_conversa_id uuid REFERENCES conversas(id);

CREATE INDEX IF NOT EXISTS idx_tasks_origem_conversa
  ON task_flow_tasks(origem_conversa_id)
  WHERE origem_conversa_id IS NOT NULL;
```

---

## Checklist de execução — Fase 4

**4b — Follow-up (prioridade alta):**
- [ ] Migration: campo follow_up_em na tabela conversas
- [ ] UI: botão "Follow-up" no menu de ações da conversa (SDR Zap)
- [ ] Cron: verificar follow_ups pendentes a cada 15 minutos
- [ ] Notificação WA quando follow-up dispara

**4c — Horário no "Lembrar Dr. Maikon" (quick win):**
- [ ] Exibir hora do prazo no card de tarefa nessa coluna
- [ ] Destaque visual para tarefas com prazo em < 2 horas

**4d — Criar tarefa do SDR Zap (prioridade média):**
- [ ] Migration: campo `origem_conversa_id` em task_flow_tasks
- [ ] Botão "Criar Tarefa" no menu de ações da conversa
- [ ] Modal pré-preenchido com dados da conversa
- [ ] Indicador na conversa de que há tarefa vinculada

**Agente de comando rápido (prioridade baixa — após 4b/4c/4d):**
- [ ] ComandoRapidoModal.tsx com atalho Cmd+K
- [ ] Edge function `interpretar-comando`
- [ ] Integração com Task Flow (INSERT ao confirmar tarefa)
- [ ] Notificação WA para secretária ao receber tarefa
- [ ] Adicionar botão flutuante no layout geral (AppLayout)
