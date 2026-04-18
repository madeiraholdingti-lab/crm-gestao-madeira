# Fase 1 — Auditoria e Correção de Performance

**Contexto:** Em 22/03/2026, o balance Supabase do projeto esgotou $25 em poucos dias
com apenas 3 usuários ativos. Isso é anormal e precisa ser investigado e corrigido
ANTES de qualquer nova feature ser desenvolvida.

---

## Suspeitos principais (investigar nessa ordem)

### 1. Volume de invocações de edge functions — PROVÁVEL CULPADO #1

O Evolution API dispara um webhook para o Supabase a cada evento de WhatsApp
(mensagem recebida, enviada, status, conexão, desconexão). Com 6+ instâncias
conectadas, isso pode gerar centenas a milhares de invocações por dia.

**Como investigar:**
```
Supabase Dashboard → Edge Functions → ver "Invocations" de cada função
Focar em: evolution-webhook, evolution-messages-webhook, n8n-inbound-webhook
```

**Como corrigir:**
- No painel do Evolution API, configurar para enviar apenas os eventos necessários
- Eventos úteis: `MESSAGES_UPSERT`, `MESSAGES_UPDATE`
- Eventos para desativar: `QRCODE_UPDATED`, `CONNECTION_UPDATE` (só quando necessário),
  `SEND_MESSAGE` (confirmação — não precisa), `CONTACTS_UPDATE` (em massa = caro)
- Na edge function `evolution-messages-webhook`, adicionar early return para tipos
  de mensagem irrelevantes (status updates, mensagens do próprio bot, etc.)

**Código de filtro a adicionar no início das webhook functions:**
```typescript
const body = await req.json()

// Ignorar eventos que não precisamos processar
const IGNORED_EVENTS = ['QRCODE_UPDATED', 'LOGOUT_INSTANCE', 'CONTACTS_UPSERT']
if (IGNORED_EVENTS.includes(body.event)) {
  return new Response('ignored', { headers: corsHeaders })
}

// Ignorar mensagens enviadas pelo próprio sistema
if (body.data?.key?.fromMe === true && body.event !== 'MESSAGES_UPDATE') {
  return new Response('ignored', { headers: corsHeaders })
}
```

---

### 2. Funções de sincronização sem controle de frequência — PROVÁVEL CULPADO #2

As funções `sincronizar-fotos-contatos`, `sincronizar-nomes-contatos` e
`sincronizar-historico-mensagens` fazem requisições pesadas para a Evolution API
e escrevem muitos registros no banco.

**Como investigar:**
```sql
-- No SQL Editor do Supabase:
SELECT * FROM cron.job ORDER BY jobname;
-- Ver intervalo de cada job programado
```

**Como corrigir:**
- Nenhuma sincronização de fundo precisa rodar mais de 1x a cada 30 minutos
- `sincronizar-fotos-contatos`: máximo 1x por dia (fotos raramente mudam)
- `sincronizar-historico-mensagens`: apenas sob demanda ou 1x por hora
- Adicionar verificação de "ultima_sincronizacao" antes de rodar de novo

---

### 3. Realtime subscriptions acumulando sem cleanup

Se os componentes React não cancelam a subscription ao desmontar, cada vez que
o usuário navega entre páginas cria uma nova conexão sem fechar a anterior.

**Como investigar:**
```
Abrir o SDR Zap → navegar para outra página → voltar para o SDR Zap
Repetir 5x → ver no Network tab se há múltiplas conexões WebSocket abertas
```

**Como corrigir — padrão obrigatório para todos os componentes com Realtime:**
```typescript
useEffect(() => {
  const channel = supabase
    .channel('nome-unico-do-canal')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversas' },
      (payload) => { /* handler */ }
    )
    .subscribe()

  // OBRIGATÓRIO: cleanup ao desmontar
  return () => {
    supabase.removeChannel(channel)
  }
}, [])
```

**Arquivos para revisar:** `SDRZap.tsx`, `DetalheConversa.tsx`, qualquer componente
com `supabase.channel()`.

---

### 4. Queries sem índices nas tabelas de mensagens

Com volume crescente de mensagens no WhatsApp, queries sem índice fazem full
table scan — consome compute e é lento.

**Como investigar:**
```sql
-- Ver se os campos de filtro mais usados têm índice
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('mensagens', 'messages', 'conversas')
ORDER BY tablename, indexname;

-- Ver queries mais lentas (se pg_stat_statements estiver ativo)
SELECT query, calls, mean_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;
```

**Índices a criar se não existirem:**
```sql
-- mensagens / messages
CREATE INDEX IF NOT EXISTS idx_mensagens_conversa_created
  ON mensagens(conversa_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_instance_created
  ON messages(instance_id, created_at DESC);

-- conversas
CREATE INDEX IF NOT EXISTS idx_conversas_instancia_status
  ON conversas(instancia_id, status);

CREATE INDEX IF NOT EXISTS idx_conversas_responsavel
  ON conversas(responsavel_atual, ultima_interacao DESC);
```

---

### 5. Cron jobs com intervalo muito curto

Funções como `processar-disparos-agendados` e `verificar-disparos-enviados` rodando
a cada 1 minuto = 1.440 invocações por dia, mesmo sem nada para processar.

**Como corrigir:**
```sql
-- Verificar jobs existentes
SELECT jobname, schedule, command FROM cron.job;

-- Ajustar para intervalos razoáveis:
-- processar-disparos-agendados: a cada 15 minutos
-- verificar-disparos-enviados: a cada 30 minutos
-- processar-lote-diario: 1x por dia (ex: 08:00)
```

---

## Checklist de execução — Fase 1

- [ ] Auditar invocações no dashboard Supabase (últimas 24h por função)
- [ ] Identificar as 3 funções com mais invocações
- [ ] Adicionar filtro de eventos no `evolution-messages-webhook`
- [ ] Desativar eventos desnecessários no painel do Evolution API
- [ ] Verificar e corrigir cleanup de Realtime em SDRZap.tsx e DetalheConversa.tsx
- [ ] Criar índices faltantes nas tabelas de mensagens e conversas
- [ ] Revisar e aumentar intervalos dos cron jobs
- [ ] Monitorar por 24h após correções — custo deve cair 70%+

---

## Meta

Antes das correções: ~$8/dia com 3 usuários
Meta após correções: < $1/dia com 3 usuários
Um projeto nesse porte deve custar $15-30/mês, não $25 em poucos dias.
