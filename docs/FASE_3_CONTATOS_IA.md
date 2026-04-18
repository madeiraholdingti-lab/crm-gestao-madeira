# Fase 3 — Banco de Contatos Inteligente

**Objetivo:** Transformar os ~15.000 contatos do número pessoal do Dr. Maikon
em um ativo de negócio filtrável e segmentável. Hoje são nomes em WhatsApp sem
nenhuma classificação. Com IA, em 1-2 semanas ele consegue filtrar
"todos os cirurgiões cardíacos" e disparar mensagem para o evento de novembro.

---

## Parte 1 — Campo de perfil profissional nos contatos

### Migration necessária

```sql
-- Adicionar perfil_profissional na tabela contacts
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS perfil_profissional text,
  ADD COLUMN IF NOT EXISTS especialidade text,
  ADD COLUMN IF NOT EXISTS instituicao text,
  ADD COLUMN IF NOT EXISTS perfil_sugerido_ia text,
  ADD COLUMN IF NOT EXISTS perfil_confirmado boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS classificado_em timestamptz;

-- Índice para filtros de disparo
CREATE INDEX IF NOT EXISTS idx_contacts_perfil
  ON contacts(perfil_profissional);
```

### Valores de perfil_profissional (enum sugerido)
```
medico
cirurgiao_cardiaco
anestesista
enfermeiro
tecnico_enfermagem
diretor_hospital
gestor_saude
administrativo_saude
patrocinador
paciente
paciente_pos_op
fornecedor
outro
```

### UI — Edição inline no SDR Zap

No painel de detalhes da conversa (já existe no SDR Zap), adicionar seção:
```
Perfil profissional
[Select: Médico ▼]  [Especialidade: ___________]
[Instituição: _________________]
[Confirmado por IA: ✓ Sugestão: cirurgião cardíaco]
```

### UI — Edição em massa na página de Contatos

Na página `/contatos`, adicionar coluna "Perfil" com select inline.
Filtro no header: "Mostrar apenas: [Todos ▼] [Sem classificação]"

---

## Parte 2 — Classificação automática por IA

### Nova edge function: `classificar-contato-ia`

Recebe um contato (id) e:
1. Busca as últimas 20 mensagens da conversa desse contato
2. Busca o nome do contato
3. Envia para OpenAI com prompt de classificação
4. Salva `perfil_sugerido_ia` na tabela contacts (NÃO confirma automaticamente)
5. Cria notificação para o usuário confirmar a sugestão

```typescript
const prompt = `
Analise o nome e o histórico de conversa abaixo e classifique o contato.

Nome: ${contact.name}
Histórico recente:
${messages.map(m => `${m.from_me ? 'Maikon' : contact.name}: ${m.content}`).join('\n')}

Responda em JSON:
{
  "perfil": "um dos valores: medico|cirurgiao_cardiaco|anestesista|...",
  "especialidade": "especialidade médica se aplicável, ou null",
  "instituicao": "hospital/clínica mencionada, ou null",
  "confianca": "alta|media|baixa",
  "motivo": "explicação curta de por que classificou assim"
}
`
```

### Processamento em lote

Edge function `classificar-contatos-lote`:
- Processa 50 contatos por vez (sem perfil definido)
- Roda 1x por dia via cron (não sobrecarregar OpenAI)
- Prioriza contatos com mais mensagens (mais contexto = melhor classificação)

```sql
-- Query para buscar contatos sem classificação com mais mensagens
SELECT c.id, c.name, COUNT(m.id) as total_mensagens
FROM contacts c
LEFT JOIN mensagens m ON m.contact_id = c.id  -- ajustar campo conforme schema real
WHERE c.perfil_profissional IS NULL
GROUP BY c.id
ORDER BY total_mensagens DESC
LIMIT 50;
```

---

## Parte 3 — Importação do WhatsApp pessoal

### Fluxo de importação

1. Dr. Maikon exporta contatos do WhatsApp pessoal (arquivo .vcf)
2. Na página `/contatos`, novo botão "Importar do WhatsApp (VCF)"
3. Sistema processa o arquivo: cria contatos com nome e número
4. Associa automaticamente à instância do número pessoal
5. Agenda classificação por IA em lote

O parser VCF já existe em `src/utils/vcfParser.ts` — reutilizar.

### Deduplicação

```typescript
// Antes de inserir, verificar se número já existe
// Normalizar número: remover +, espaços, traços
// Preferir o contato que já tem mais dados (nome, foto, etc.)
```

---

## Parte 4 — Filtro por perfil nos Disparos em Massa

### Mudança na criação de campanha

Na tela de criação de campanha (`/disparos-em-massa/campanhas`), adicionar filtro:

```
Filtrar leads por:
☑ Tipo de lead existente (campo já existe)
☑ Perfil profissional: [Cirurgião cardíaco ▼] [+ Adicionar]
☑ Especialidade: [Cardiologia ▼]
```

### Migration em campanhas_disparo

```sql
ALTER TABLE campanhas_disparo
  ADD COLUMN IF NOT EXISTS filtro_perfil_profissional text[],
  ADD COLUMN IF NOT EXISTS filtro_especialidade text[];
```

### Query de leads filtrados (para `processar-envios-massa`)

```typescript
let query = supabase
  .from('leads')
  .select('*, contacts(*)')

if (campanha.filtro_perfil_profissional?.length > 0) {
  query = query.in('contacts.perfil_profissional', campanha.filtro_perfil_profissional)
}

if (campanha.filtro_especialidade?.length > 0) {
  query = query.in('contacts.especialidade', campanha.filtro_especialidade)
}
```

---

## Caso de uso concreto — Evento de novembro

Dr. Maikon quer convidar cirurgiões cardíacos para evento em novembro/2026:

1. **Semana 3:** importar contatos do número pessoal (15k)
2. **Semana 3-4:** IA classifica em lote, Maikon confirma sugestões
3. **Semana 4:** criar campanha com filtro `perfil = cirurgiao_cardiaco`
4. Sistema mostra: "X contatos encontrados com esse perfil"
5. Disparar convite personalizado para esse grupo

---

## Checklist de execução — Fase 3

- [ ] Migration: adicionar campos de perfil em `contacts`
- [ ] UI: campo de perfil no painel de detalhes da conversa (SDR Zap)
- [ ] UI: coluna de perfil e filtro na página `/contatos`
- [ ] Edge function `classificar-contato-ia` (individual)
- [ ] Edge function `classificar-contatos-lote` (batch diário)
- [ ] Cron job para lote (1x/dia, fora do horário de pico)
- [ ] UI: confirmação de sugestão de IA na conversa
- [ ] Botão "Importar VCF" na página de contatos
- [ ] Migration: filtros de perfil em `campanhas_disparo`
- [ ] UI: filtro de perfil na criação de campanha
- [ ] Atualizar query de processamento de envios para respeitar filtro
