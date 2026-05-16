// madeira-router — recebe webhook do Evolution pra instância Agent-Madeira
// e faz fan-out paralelo pra:
//   1. evolution-messages-webhook → popula messages/conversas (visível no SDR Zap pra admin_geral)
//   2. assistente-maikon-pessoal   → processa e responde
//
// Vantagem vs apontar webhook direto pro assistente:
//   - Mensagens trocadas Madeira↔Maikon aparecem no SDR Zap (RLS já restringe a admin_geral)
//   - Side effects do evolution-messages-webhook (contatos, conversas) acontecem
//   - Audit dupla: assistente_audit_log + messages
//
// Configurar webhook Evolution Agent-Madeira pra:
//   URL:    https://yycpctrcefxemgahhxgx.supabase.co/functions/v1/madeira-router
//   Events: MESSAGES_UPSERT, SEND_MESSAGE, CONNECTION_UPDATE

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SVC_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const TARGETS_INBOUND = [
  // Persiste no banco (messages/conversas/contacts)
  '/functions/v1/evolution-messages-webhook',
  // Processa e responde
  '/functions/v1/assistente-maikon-pessoal',
];

const TARGETS_OUTBOUND = [
  // Só persistir mensagens enviadas — não re-processar pra evitar loop
  '/functions/v1/evolution-messages-webhook',
];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const raw = await req.text();
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(raw); } catch { /* keep empty */ }

    const event = (payload as { event?: string; body?: { event?: string } }).event
      || (payload as { body?: { event?: string } }).body?.event;

    // SEND_MESSAGE é evento outbound (Evolution emite quando o chip envia algo)
    const isOutbound = event === 'send.message' || event === 'SEND_MESSAGE';
    const targets = isOutbound ? TARGETS_OUTBOUND : TARGETS_INBOUND;

    // Fire-and-forget DE VERDADE: dispara fan-out e responde 200 IMEDIATAMENTE.
    // Antes: Promise.all bloqueava o response até todos targets terminarem —
    // assistente-maikon-pessoal às vezes demora 30s+ (Gemini + tools), e o
    // Evolution timeout-ava em 25s e RETRANSMITIA o webhook. Caso real:
    // print 16/05 09:12-09:14 — 2 mensagens do Maikon viraram 6 respostas
    // duplicadas em 2min, todas processadas em paralelo. EdgeRuntime.waitUntil
    // mantém o fan-out vivo após o return.
    const fanoutPromise = Promise.all(targets.map(path =>
      fetch(`${SUPABASE_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SVC_KEY}`,
          'apikey': SVC_KEY,
        },
        body: raw,
      }).then(
        async r => console.log(`[router] ${path} -> ${r.status}: ${(await r.text()).slice(0, 200)}`),
        err => console.warn(`[router] ${path} -> err: ${err instanceof Error ? err.message : String(err)}`),
      )
    ));
    // Deno Deploy / Supabase Edge Functions: EdgeRuntime.waitUntil mantém a
    // task viva após o response. Sem isso, o handler termina e o fan-out morre.
    // deno-lint-ignore no-explicit-any
    const er = (globalThis as any).EdgeRuntime;
    if (er?.waitUntil) er.waitUntil(fanoutPromise);

    return new Response(JSON.stringify({ ok: true, event, dispatched: targets.length }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
