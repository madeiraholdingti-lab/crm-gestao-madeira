# Fase 5 — Hub Unificado de WhatsApps

**Objetivo:** Todos os números do Dr. Maikon num só lugar.
Hoje cada WhatsApp é uma ilha. O CRM já tem a infra (Evolution API multi-instância)
— o trabalho é conectar tudo e criar uma UX que não vire bagunça com 6+ instâncias.

---

## Instâncias a conectar

| Instância | Número | Responsável | Prioridade |
|-----------|--------|-------------|------------|
| Consultório (IA) | a definir | Iza + Mariana | semana 2 |
| Secretária Iza | número dela | Iza | semana 2 |
| Secretária Mariana | número dela | Mariana | semana 2 |
| Empresa | número empresa | Dr. Maikon | semana 3 |
| Disparos | número disparos | automático | já conectado? |
| Pessoal Maikon | ~15k contatos | Dr. Maikon | mês 2 (com cuidado) |

**Prioridade:** conectar as secretárias primeiro. O número pessoal com 15k
contatos tem um volume que pode estourar o custo — conectar só após as
otimizações de performance (Fase 1) estarem aplicadas.

---

## Mudanças no SDR Zap

### Filtro por instância melhorado

O SDR Zap já tem suporte a múltiplas instâncias. O que falta:

1. **Seletor de instância mais visível** — hoje fica escondido
2. **Modo "Todas as instâncias"** — ver todas as conversas numa inbox só
3. **Tag visual da instância** em cada conversa (qual número recebeu)
4. **Filtro rápido** no topo: [Todas] [Consultório] [Empresa] [Iza] [Mariana]

### Inbox unificada — nova view

```typescript
// Toggle no topo do SDR Zap:
// [Por instância ▼]  vs  [Unificada]

// Na view unificada:
// - Buscar conversas de TODAS as instâncias que o usuário tem acesso
// - Agrupar por instância com cabeçalho separador
// - Ou lista flat com badge da instância em cada conversa
```

**Regra de acesso:**
- `admin_geral` / `medico`: vê todas as instâncias
- `secretaria_medica`: vê apenas instâncias atribuídas a ela
- `disparador`: apenas instâncias de disparo

```sql
-- Nova tabela ou campo em instancias_whatsapp para controle de acesso
ALTER TABLE instancias_whatsapp
  ADD COLUMN IF NOT EXISTS responsavel_user_id uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS visivel_para text[] DEFAULT ARRAY['admin_geral', 'medico'];
```

---

## Tags automáticas nas conversas

IA classifica cada conversa recebida com tags baseadas no conteúdo:

**Tags pré-definidas:**
```
paciente         — conversa com paciente da clínica
pos-operatorio   — menção a cirurgia, alta, pós-op
receita          — pedido de receita ou medicamento
consulta         — agendamento ou dúvida de consulta
urgente          — linguagem de urgência, dor, emergência
medico           — interlocutor parece médico
evento           — convite ou interesse em evento
fornecedor       — contato comercial/fornecedor
pendente-resposta — Maikon precisa pessoalmente responder
```

**Edge function: `classificar-conversa-ia`**
- Chamada quando uma nova mensagem chega (dentro do webhook handler)
- Analisa as últimas 5 mensagens
- Aplica/atualiza tags na conversa (campo `tags` já existe em `conversas`)
- Custo baixo: prompt curto, modelo mais barato (gpt-4o-mini ou similar)

```typescript
// Dentro de evolution-messages-webhook, após salvar mensagem:
if (isNewConversation || turnsCount % 10 === 0) {
  // Chamar classificação a cada 10 mensagens (não a cada mensagem)
  await supabase.functions.invoke('classificar-conversa-ia', {
    body: { conversa_id, ultimas_mensagens }
  })
}
```

---

## Roteamento automático de conversas por perfil

**Pedido do Dr. Maikon:** "Preciso que a Iza responda diretores de hospital e a Mariana os pacientes."

### Lógica de roteamento

Quando uma nova conversa chega (qualquer instância), o sistema verifica o perfil
do contato e atribui automaticamente o responsável:

```typescript
const REGRAS_ROTEAMENTO = [
  {
    perfis: ['diretor_hospital', 'gestor_saude', 'medico', 'cirurgiao_cardiaco'],
    responsavel: 'IZA_USER_ID',
    motivo: 'Contatos profissionais/médicos → Iza'
  },
  {
    perfis: ['paciente', 'paciente_pos_op'],
    responsavel: 'MARIANA_USER_ID',
    motivo: 'Pacientes → Mariana'
  },
  {
    perfis: ['patrocinador', 'fornecedor'],
    responsavel: 'IZA_USER_ID',
    motivo: 'Contatos comerciais → Iza'
  }
  // Sem perfil definido → sem atribuição automática (cai para admin)
]
```

### Onde implementar

**Dentro da edge function `evolution-messages-webhook`**, após identificar
que é uma conversa nova:

```typescript
// 1. Buscar perfil do contato pelo telefone
const { data: contact } = await supabase
  .from('contacts')
  .select('perfil_profissional')
  .eq('phone', normalizedPhone)
  .single()

// 2. Aplicar regra de roteamento
const regra = REGRAS_ROTEAMENTO.find(r =>
  r.perfis.includes(contact?.perfil_profissional)
)

// 3. Atribuir responsável se encontrou regra
if (regra) {
  await supabase
    .from('conversas')
    .update({ responsavel_atual: regra.responsavel })
    .eq('id', conversa_id)

  // 4. Notificar a secretária via WA
  await supabase.functions.invoke('enviar-mensagem-evolution', {
    body: {
      numero: NUMEROS_SECRETARIAS[regra.responsavel],
      mensagem: `📩 Nova conversa atribuída a você:\n${nome_contato} (${contact.perfil_profissional})`
    }
  })
}
```

### Configuração das regras (nova tabela)

Em vez de hardcoded, as regras ficam configuráveis pelo admin:

```sql
CREATE TABLE regras_roteamento (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  perfis_profissionais text[] NOT NULL,
  responsavel_user_id uuid REFERENCES profiles(id),
  ativo boolean DEFAULT true,
  prioridade int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Índice para lookup rápido
CREATE INDEX idx_regras_roteamento_ativo ON regras_roteamento(ativo, prioridade);
```

### UI de configuração

Na página `/usuarios` ou em `/zaps`, adicionar aba "Roteamento":
```
Regras de atribuição automática

Perfil do contato          Responsável
────────────────────────────────────────
Diretor de hospital    →   Iza          [Editar]
Gestor de saúde        →   Iza          [Editar]
Médico                 →   Iza          [Editar]
Paciente               →   Mariana      [Editar]
Paciente pós-op        →   Mariana      [Editar]
Sem perfil definido    →   (nenhum)     [Editar]

[+ Adicionar regra]
```

### Casos especiais

- Contato sem perfil definido → não atribui (responsável_atual = null)
- Perfil definido mas responsável ausente/de folga → cai para Dr. Maikon
- Dr. Maikon pode sobrescrever qualquer atribuição manualmente
- Conversa já atribuída → não re-roteia automaticamente (evitar loop)

---

## Revisão UX do SDR Zap (pedido da Iza, 26/03/2026)

A Iza relatou que o layout do SDR Zap é "incômodo". Ainda não especificou
exatamente o quê. Possíveis problemas a investigar:

### Hipóteses
1. **3 colunas apertadas** — em tela de notebook (1366px), as 3 colunas podem ficar
   muito comprimidas, especialmente a Coluna 3 (chat)
2. **Coluna 1 vs Coluna 2 confusas** — "Todas" vs "Minhas conversas" pode não ser
   intuitivo para quem não é técnico
3. **Informação visual demais** — muitos badges, cores, ícones no card da conversa
4. **Responsividade** — não funciona bem em telas menores ou tablets

### Ações
- [ ] **Perguntar à Iza** o que exatamente incomoda (agendar 15min com ela)
- [ ] Testar o SDR Zap em diferentes resoluções de tela
- [ ] Considerar layout alternativo: 2 colunas (lista + chat) com sidebar colapsável
- [ ] Melhorar labels: "Todas" → "Inbox Geral", "Minhas" → "Meu Atendimento"
- [ ] Avaliar skill `usability-psychologist` para revisão formal

---

## Checklist de execução — Fase 5

**Já implementado:**
- [x] Roteamento automático de conversas por perfil
- [x] Classificação de contatos por IA (individual + lote)
- [x] Padronização OpenAI
- [x] Hub WhatsApp funcional (página `/hub-whatsapp`)

**Infra (validar com Dr. Maikon):**
- [ ] Conectar instâncias de Iza e Mariana na Evolution API
- [ ] Configurar responsavel_user_id em cada instância
- [ ] Testar: mensagem chegando na instância da Iza aparece para ela no SDR Zap

**Features pendentes:**
- [ ] Filtro rápido por instância no topo do SDR Zap
- [ ] Badge visual de instância em cada conversa
- [ ] Toggle de view unificada vs por instância
- [ ] Edge function `classificar-conversa-ia`
- [ ] Tags automáticas aplicadas nas conversas

**UX (novo — pedido da Iza):**
- [ ] Investigar dor do SDR Zap com a Iza (perguntar o que incomoda)
- [ ] Revisão visual do Hub WhatsApp (primeira impressão foi negativa)
- [ ] Aplicar melhorias de layout baseadas no feedback

**Mês 2 (com cuidado):**
- [ ] Planejar conexão do número pessoal (15k contatos)
- [ ] Verificar impacto no custo ANTES de conectar
- [ ] Configurar filtros de webhook específicos para não processar tudo
- [ ] Importar contatos e iniciar classificação em lote

**Roteamento (complementar):**
- [ ] Migration: tabela `regras_roteamento` (config dinâmica)
- [ ] UI de configuração de regras em `/usuarios`
- [ ] Notificação WA para secretária ao receber conversa atribuída
- [ ] Testar: mensagem de paciente → Mariana; diretor de hospital → Iza
