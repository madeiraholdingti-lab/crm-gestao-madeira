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

    // Fan-out paralelo, fire-and-forget. Espera no máximo 25s (Evolution timeout).
    const fanoutPromises = targets.map(path =>
      fetch(`${SUPABASE_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SVC_KEY}`,
          'apikey': SVC_KEY,
        },
        body: raw,
      }).then(
        async r => ({ target: path, status: r.status, body: (await r.text()).slice(0, 200) }),
        err => ({ target: path, error: err instanceof Error ? err.message : String(err) }),
      )
    );

    const results = await Promise.all(fanoutPromises);

    return new Response(JSON.stringify({ ok: true, event, fanout: results }), {
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
