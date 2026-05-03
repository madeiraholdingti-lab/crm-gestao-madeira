// madeira-broadcast — envia mensagem proativa pelo chip Madeira pro número
// configurado em ASSISTENTE_USER_PHONE.
//
// Input: { text: string }
// Output: { ok, sent_to }
//
// Usa secret EVOLUTION_API_KEY (Supabase secrets) ou config_global.evolution_api_key.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as { text?: string };
    if (!body.text?.trim()) {
      return json(400, { ok: false, error: 'text obrigatório' });
    }

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
    const inst = Deno.env.get('ASSISTENTE_INSTANCE_NAME');
    const toPhone = Deno.env.get('ASSISTENTE_USER_PHONE');

    if (!evoUrl || !evoKey || !inst || !toPhone) {
      return json(500, {
        ok: false,
        error: 'config Evolution incompleta',
        missing: {
          evoUrl: !evoUrl, evoKey: !evoKey, inst: !inst, toPhone: !toPhone,
        },
      });
    }

    const r = await fetch(
      `${evoUrl}/message/sendText/${encodeURIComponent(inst)}`,
      {
        method: 'POST',
        headers: { apikey: evoKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: toPhone, text: body.text }),
      },
    );

    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      return json(502, { ok: false, error: `Evolution ${r.status}: ${errText.slice(0, 200)}` });
    }

    return json(200, { ok: true, sent_to: toPhone, instance: inst });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[madeira-broadcast] erro:', msg);
    return json(500, { ok: false, error: msg });
  }
});

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
