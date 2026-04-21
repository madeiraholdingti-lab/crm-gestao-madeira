// campanha-ia-responder — DISPATCHER FINO pro workflow n8n "Maikonect IA Responder v2"
//
// Antes (Stage 4) essa função era o cérebro da IA (Gemini direto). Agora o user
// preferiu centralizar no n8n (visual, editável, fácil de expandir com Whisper/
// Vision no futuro). Essa fn só encaminha a chamada pro webhook do n8n.
//
// Disparado por pg_cron a cada 2min em modo varredura, ou por chamada direta
// com { campanha_envio_id: uuid } pra processar um específico.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const N8N_WEBHOOK_URL = 'https://sdsd-n8n.r65ocn.easypanel.host/webhook/maikonect-ia-responder-v2';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));

    const resp = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await resp.json().catch(() => ({ raw: 'não-json' }));

    return new Response(JSON.stringify({
      ok: resp.ok,
      status: resp.status,
      n8n_response: data,
    }), {
      status: resp.ok ? 200 : 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[campanha-ia-responder] erro:', msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
