// maikon-gss-router — webhook router pro chip pessoal do Maikon (Maikon GSS).
//
// Razão: o webhook do Maikon GSS aponta hoje pro n8n e o n8n não persiste
// mensagens de grupo no banco do CRM. Esta edge faz fan-out:
//   1. SEMPRE encaminha o payload INTACTO pro n8n (preserva pipeline existente
//      — Maikonect IA Responder, conect-what, IAmaiconnect etc continuam funcionando)
//   2. Se for messages.upsert/update/delete/send.message COM remoteJid @g.us,
//      também encaminha pro evolution-messages-webhook do Supabase (persiste
//      mensagens de grupo em messages — habilita tool buscar_grupo da Madeira)
//
// Fire-and-forget pros 2 destinos. Sempre retorna 200 ao Evolution.
// Timeout interno: 20s pros forwards (Evolution dropa em 25s).
//
// Configurar webhook do Maikon GSS pra apontar aqui:
//   URL: https://yycpctrcefxemgahhxgx.supabase.co/functions/v1/maikon-gss-router
//
// Rollback (se precisar): repor webhook pra n8n direto:
//   https://sdsd-n8n.r65ocn.easypanel.host/webhook/daabf698-5f45-4f40-befd-ed9178ad7d14

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const N8N_DOWNSTREAM_URL = 'https://sdsd-n8n.r65ocn.easypanel.host/webhook/daabf698-5f45-4f40-befd-ed9178ad7d14';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SVC_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_MESSAGES_URL = `${SUPABASE_URL}/functions/v1/evolution-messages-webhook`;

const FORWARD_TIMEOUT_MS = 20_000;
const GROUP_EVENTS = new Set([
  'messages.upsert',
  'MESSAGES_UPSERT',
  'messages.update',
  'MESSAGES_UPDATE',
  'messages.delete',
  'MESSAGES_DELETE',
  'send.message',
  'SEND_MESSAGE',
]);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const raw = await req.text();
    const payload = safeJson(raw);

    const event = payload?.event || payload?.body?.event || '';
    const data = payload?.data || payload?.body?.data;
    const remoteJid: string = data?.key?.remoteJid || '';
    const isGroup = remoteJid.endsWith('@g.us');
    const isGroupMessageEvent = isGroup && GROUP_EVENTS.has(event);

    // Forwards em paralelo (fire-and-forget — não bloqueamos a resposta ao Evolution)
    const targets: Array<{ name: string; url: string }> = [
      { name: 'n8n', url: N8N_DOWNSTREAM_URL },
    ];
    if (isGroupMessageEvent) {
      targets.push({ name: 'supabase-messages', url: SUPABASE_MESSAGES_URL });
    }

    const results = await Promise.all(targets.map(async (t) => {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), FORWARD_TIMEOUT_MS);
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        // Pra invocar edge function precisa de auth. n8n webhook é público, não envia auth.
        if (t.name === 'supabase-messages') {
          headers['Authorization'] = `Bearer ${SVC_KEY}`;
          headers['apikey'] = SVC_KEY;
        }
        const r = await fetch(t.url, {
          method: 'POST',
          headers,
          body: raw,
          signal: ctrl.signal,
        });
        return { target: t.name, status: r.status };
      } catch (e) {
        return { target: t.name, error: e instanceof Error ? e.message : String(e) };
      } finally {
        clearTimeout(timeout);
      }
    }));

    return new Response(JSON.stringify({
      ok: true,
      event,
      isGroup,
      forwarded: results,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    // Mesmo em erro, retornar 200 pra Evolution não fazer retry
    console.error('[maikon-gss-router] erro:', err);
    return new Response(JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function safeJson(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s); } catch { return null; }
}
