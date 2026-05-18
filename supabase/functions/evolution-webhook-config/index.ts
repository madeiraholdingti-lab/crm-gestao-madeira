// evolution-webhook-config — utilitária pra inspecionar e configurar webhook
// de uma instância Evolution sem expor a apikey.
//
// GET  ?instance=Nome   → retorna config webhook atual
// POST { instance, url, events?, webhook_by_events? } → seta config
//
// events default: messages.upsert + connection.update

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_EVENTS = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: cfg } = await supa
      .from('config_global')
      .select('evolution_base_url, evolution_api_key')
      .single();
    const evoUrl = (cfg as { evolution_base_url?: string } | null)?.evolution_base_url
      || Deno.env.get('EVOLUTION_API_URL');
    const evoKey = (cfg as { evolution_api_key?: string } | null)?.evolution_api_key
      || Deno.env.get('EVOLUTION_API_KEY');
    if (!evoUrl || !evoKey) return jsonRes(500, { ok: false, error: 'config Evolution incompleta' });

    if (req.method === 'GET') {
      const instance = new URL(req.url).searchParams.get('instance');
      if (!instance) return jsonRes(400, { ok: false, error: 'instance obrigatório' });
      const r = await fetch(`${evoUrl}/webhook/find/${encodeURIComponent(instance)}`, {
        headers: { apikey: evoKey },
      });
      const body = await r.text();
      return jsonRes(r.ok ? 200 : r.status, { ok: r.ok, status: r.status, body: tryJson(body) });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({})) as {
        instance?: string; url?: string; events?: string[]; webhook_by_events?: boolean;
      };
      if (!body.instance || !body.url) return jsonRes(400, { ok: false, error: 'instance + url obrigatórios' });
      const events = body.events && body.events.length ? body.events : DEFAULT_EVENTS;
      const webhookByEvents = body.webhook_by_events ?? false;

      // Evolution v2 espera body { webhook: { enabled, url, events, webhookByEvents, ... } }
      // Algumas versões antigas aceitam payload plano. Tentamos o padrão moderno primeiro.
      const payload = {
        webhook: {
          enabled: true,
          url: body.url,
          events,
          webhookByEvents,
          webhookBase64: false,
        },
      };
      const r = await fetch(`${evoUrl}/webhook/set/${encodeURIComponent(body.instance)}`, {
        method: 'POST',
        headers: { apikey: evoKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const respText = await r.text();
      return jsonRes(r.ok ? 200 : r.status, {
        ok: r.ok,
        status: r.status,
        body: tryJson(respText),
        sent: payload,
      });
    }

    return jsonRes(405, { ok: false, error: 'método não suportado' });
  } catch (err) {
    return jsonRes(500, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

function tryJson(s: string) { try { return JSON.parse(s); } catch { return s; } }

function jsonRes(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
