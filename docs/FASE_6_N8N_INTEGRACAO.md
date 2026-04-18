# Fase 6 — Integração n8n (Agente Pós-Op) ↔ CRM

**Contexto do agente existente:**
- Versão atual: v15, rodando em VPS Hostinger
- Stack: n8n + Z-API (WhatsApp) + Google Sheets + OpenAI
- Finalidade: monitoramento pós-operatório de pacientes do Dr. Maikon
- Planilha de dúvidas: Google Sheets ID `1BJjEce415otRs0ZGuXW8z_5VUUWLQlnS1g3vpOTCOPY`
  - Aba `duvidas_maikon`: timestamp, phone_paciente, duvida, resposta_maikon, status, ref_id, nome_paciente

**Estratégia:** NÃO reescrever o n8n. Fazer o CRM absorver os dados do agente
progressivamente via webhooks. O n8n continua sendo a "camada de atendimento"
dos pacientes, mas o CRM se torna a fonte de verdade dos dados.

---

## Ponto de integração 1 — Escalonamentos PRECISA_MAIKON → SDR Zap

**Hoje:** quando o agente detecta `PRECISA_MAIKON`, envia mensagem WA direto
para o celular do Dr. Maikon e da Iza. A dúvida fica só no Sheets, sem rastreio.

**Com integração:**
1. n8n detecta PRECISA_MAIKON
2. n8n faz POST para edge function `n8n-inbound-webhook` (já existe!) com payload:
```json
{
  "tipo": "escalonamento_posop",
  "nome_paciente": "João Silva",
  "telefone_paciente": "5547999123456",
  "duvida": "Estou sentindo dor no peito desde ontem",
  "ref_id": "uuid-da-linha-no-sheets",
  "urgencia": "alta"
}
```
3. Edge function cria (ou atualiza) conversa no SDR Zap com:
   - Tag: `pos-operatorio`, `urgente`
   - Responsável: Iza
   - Nota no histórico: "[Agente pós-op] Dúvida escalada"
4. Notificação in-app para Iza e Dr. Maikon
5. Continua enviando WA para o celular (manter como backup)

**Mudança necessária no n8n:** adicionar nó HTTP Request após o nó que
detecta PRECISA_MAIKON, apontando para a edge function.

**Mudança necessária no CRM:** adaptar `n8n-inbound-webhook` para tratar
o novo tipo `escalonamento_posop`.

---

## Ponto de integração 2 — Pacientes pós-op → Contatos CRM

**Hoje:** pacientes que interagem com o agente ficam apenas no Sheets.
Não aparecem como contatos no CRM.

**Com integração:**
Quando um paciente novo inicia conversa com o agente n8n:
```json
{
  "tipo": "novo_paciente_posop",
  "nome_paciente": "Maria Santos",
  "telefone": "5547988887777",
  "data_cirurgia": "2026-03-20"
}
```
→ Edge function faz upsert em `contacts` com:
- `perfil_profissional = 'paciente_pos_op'`
- tag `pos-operatorio`
- Associa à instância do consultório

---

## Ponto de integração 3 — Dúvidas do Sheets → Task Flow

**Hoje:** quando uma dúvida entra na fila aguardando resposta do Dr. Maikon
(status = `aguardando` no Sheets), só o Dr. recebe WA. Iza não sabe.

**Com integração:**
Adicionar nó no n8n: quando nova linha entra com status `aguardando`:
```json
{
  "tipo": "nova_duvida_fila",
  "ref_id": "uuid",
  "nome_paciente": "João Silva",
  "duvida": "Posso tomar esse remédio?",
  "prazo_resposta": "4 horas"
}
```
→ Edge function cria tarefa no Task Flow:
- Título: "Responder dúvida: João Silva"
- Responsável: Iza (ou Dr. Maikon dependendo da urgência)
- Prazo: 4 horas a partir de agora
- Link para a conversa no SDR Zap

---

## Ponto de integração 4 — Resposta do CRM volta para o paciente

**Objetivo de longo prazo (mês 2+):**
Dr. Maikon responde a dúvida pelo SDR Zap do CRM em vez do celular pessoal.
Essa resposta vai automaticamente para o paciente via agente n8n.

**Fluxo:**
1. Conversa do paciente aberta no SDR Zap (criada pela integração 1)
2. Dr. Maikon digita a resposta no chat do CRM
3. Webhook do CRM envia POST para o n8n com a resposta
4. n8n envia para o paciente via Z-API
5. Atualiza status no Sheets: `respondido`
6. Fecha a task no Task Flow

**Isso elimina completamente o celular pessoal do fluxo clínico.**

---

## Schema do novo campo em conversas

```sql
ALTER TABLE conversas
  ADD COLUMN IF NOT EXISTS origem text DEFAULT 'direto',
  -- 'direto' | 'n8n_posop' | 'importado'
  ADD COLUMN IF NOT EXISTS n8n_ref_id text,
  -- referência para o ref_id no Google Sheets (para callback)
  ADD COLUMN IF NOT EXISTS n8n_paciente_telefone text;
```

---

## Checklist de execução — Fase 6

**Semana 3 (pode ser paralelo às outras fases):**
- [ ] Adaptar `n8n-inbound-webhook` para tratar tipo `escalonamento_posop`
- [ ] Adicionar nó HTTP no fluxo n8n após detecção PRECISA_MAIKON
- [ ] Testar: escalonamento aparece no SDR Zap com tags corretas
- [ ] Adaptar para tipo `novo_paciente_posop` → upsert em contacts

**Semana 4:**
- [ ] Integração dúvidas Sheets → Task Flow
- [ ] Testar fluxo completo: paciente → dúvida → tarefa → Iza responde

**Mês 2:**
- [ ] Resposta do CRM volta para paciente via n8n
- [ ] Validar com Dr. Maikon que fluxo está correto antes de ativar
- [ ] Manter WhatsApp pessoal como fallback por 2 semanas de transição
