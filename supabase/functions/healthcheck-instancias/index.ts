// healthcheck-instancias — valida socket Baileys real de cada instância ativa.
//
// Camada 1: /chat/sendPresence — falha hard (4xx, "Connection Closed") quando
// socket morreu de vez. Detecta o caso vivido com Maikon GSS 24/04.
//
// LIMITAÇÃO conhecida: socket HALF-DEAD (sendPresence ok mas sendText fica PENDING
// eterno) NÃO é detectado aqui. /chat/findMessages do Evolution retorna `status:
// null` na resposta, então não dá pra inspecionar status PENDING via API. Pra
// detectar half-dead seria preciso ou: consulta SQL direta no Postgres da Evolution
// (não accesível da edge function), ou mandar msg-canário pra número conhecido e
// medir tempo até DELIVERY_ACK. Isso fica como gap conhecido — workaround é
// monitorar `campanha_envios` SLA + alertar se sent muito antigo sem callback.
//
// Roda via pg_cron a cada 5min. Pra cada instância 'ativa':
//  1. POST /chat/sendPresence — se falha hard: marca 'inativa' + notifica
//
// Se já está 'inativa' não faz nada (não vira 'ativa' via healthcheck — só via QR).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InstancePing {
  id: string;
  nome: string;
  numero: string | null;
  ok: boolean;
  http_status?: number;
  error?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: cfg } = await supa
      .from('config_global')
      .select('evolution_base_url, evolution_api_key, bot_admin_phones')
      .single();
    const evoUrl = cfg?.evolution_base_url || Deno.env.get('EVOLUTION_API_URL');
    const evoKey = cfg?.evolution_api_key || Deno.env.get('EVOLUTION_API_KEY');
    if (!evoUrl || !evoKey) {
      return json(500, { ok: false, error: 'Config Evolution ausente' });
    }

    const { data: ativas } = await supa
      .from('instancias_whatsapp')
      .select('id, nome_instancia, numero_chip')
      .eq('status', 'ativa');

    const results: InstancePing[] = [];
    let derrubadas = 0;

    for (const inst of (ativas || [])) {
      const numero = inst.numero_chip || '';
      // Se não temos numero_chip, ping em si mesmo via número da instância
      // não funciona — usa um número arbitrário só pra ver se socket aceita.
      // Evolution aceita qualquer número válido pra sendPresence; ele só falha
      // quando o socket Baileys não responde.
      const pingNumber = numero.replace(/\D/g, '') || '5511999999999';

      try {
        const r = await fetch(
          `${evoUrl}/chat/sendPresence/${encodeURIComponent(inst.nome_instancia)}`,
          {
            method: 'POST',
            headers: { apikey: evoKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              number: pingNumber,
              presence: 'available',
              delay: 100,
            }),
          },
        );

        if (r.ok) {
          results.push({
            id: inst.id, nome: inst.nome_instancia, numero,
            ok: true, http_status: r.status,
          });
          continue;
        }

        const txt = await r.text().catch(() => '');
        const isSocketDead =
          r.status === 400 || r.status === 500 ||
          txt.includes('Connection Closed') ||
          txt.includes('no session') ||
          txt.includes('Connection Failure');

        results.push({
          id: inst.id, nome: inst.nome_instancia, numero,
          ok: false, http_status: r.status, error: txt.slice(0, 200),
        });

        if (isSocketDead) {
          await supa
            .from('instancias_whatsapp')
            .update({ status: 'inativa', updated_at: new Date().toISOString() })
            .eq('id', inst.id);
          derrubadas++;

          await supa.from('notificacoes').insert({
            tipo: 'sistema',
            titulo: `Chip caído: ${inst.nome_instancia}`,
            descricao: `Healthcheck detectou socket Baileys morto (${r.status}). Status virou 'inativa'.`,
            urgencia: 'alta',
          }).select();
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        results.push({
          id: inst.id, nome: inst.nome_instancia, numero,
          ok: false, error: errMsg.slice(0, 200),
        });
      }
    }

    return json(200, {
      ok: true,
      total_ativas: (ativas || []).length,
      derrubadas,
      results,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[healthcheck-instancias] erro:', msg);
    return json(500, { ok: false, error: msg });
  }
});

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Pega a ÚLTIMA msg from_me=true da instância. Se status='PENDING' e ela foi
// enviada há > 3min, socket está half-dead (aceita API mas não entrega).
// Retorna segundos parado, ou null se OK.
