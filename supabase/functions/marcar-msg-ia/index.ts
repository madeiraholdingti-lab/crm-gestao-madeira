// marcar-msg-ia — chamada pelo n8n após cada turno da IA respondendo um lead.
// Marca a msg como gerada pela IA, faz append no historico_conversa do envio,
// e atualiza maturidade. Permite distinguir IA de humano e dar contexto rico
// pro próximo turno sem JOIN.
//
// Input: {
//   campanha_envio_id: uuid (obrigatório),
//   wa_message_id?: string             (id da última msg IA via Evolution — pra source),
//   wa_message_ids?: string[]          (array de ids quando IA mandou várias msgs),
//   ia_text?: string                   (texto único da IA — append uma entrada),
//   ia_messages?: string[]             (array de mensagens da IA — append uma entrada cada),
//   user_text?: string                 (msg do lead que disparou — append antes da IA),
//   maturidade?: 'frio'|'morno'|'quente',
//   conversa_encerrada?: boolean,
//   alerta_lead?: boolean              (se true e maturidade='quente', flaga handoff_disparado)
// }
//
// Output: { ok, envio_id, novo_historico_size, handoff_disparado, source_atualizadas }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface HistoryTurn {
  role: 'lead' | 'ia';
  text: string;
  ts: string;
  wa_message_id?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as {
      campanha_envio_id?: string;
      wa_message_id?: string;
      wa_message_ids?: string[];
      ia_text?: string;
      ia_messages?: string[];
      user_text?: string;
      maturidade?: 'frio' | 'morno' | 'quente';
      conversa_encerrada?: boolean;
      alerta_lead?: boolean;
    };

    const envioId = body.campanha_envio_id;
    if (!envioId) {
      return json(400, { ok: false, error: 'campanha_envio_id obrigatório' });
    }

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: envio, error: envErr } = await supa
      .from('campanha_envios')
      .select('id, historico_conversa, maturidade, handoff_disparado, status')
      .eq('id', envioId)
      .maybeSingle();

    if (envErr || !envio) {
      return json(404, { ok: false, error: 'envio não encontrado', envio_id: envioId });
    }

    const now = new Date().toISOString();
    const historico: HistoryTurn[] = Array.isArray(envio.historico_conversa)
      ? (envio.historico_conversa as HistoryTurn[])
      : [];

    if (body.user_text) {
      historico.push({ role: 'lead', text: body.user_text, ts: now });
    }

    const iaTexts: string[] = Array.isArray(body.ia_messages) && body.ia_messages.length > 0
      ? body.ia_messages.filter((t): t is string => typeof t === 'string' && t.length > 0)
      : (body.ia_text ? [body.ia_text] : []);

    const waIds: string[] = Array.isArray(body.wa_message_ids) && body.wa_message_ids.length > 0
      ? body.wa_message_ids.filter((s): s is string => typeof s === 'string' && s.length > 0)
      : (body.wa_message_id ? [body.wa_message_id] : []);

    iaTexts.forEach((text, idx) => {
      historico.push({
        role: 'ia',
        text,
        ts: now,
        wa_message_id: waIds[idx],
      });
    });

    const updates: Record<string, unknown> = {
      historico_conversa: historico,
    };

    if (body.maturidade) {
      updates.maturidade = body.maturidade;
    }

    let handoffMarcado = false;
    if (body.alerta_lead && body.maturidade === 'quente' && !envio.handoff_disparado) {
      updates.handoff_disparado = true;
      updates.handoff_disparado_em = now;
      handoffMarcado = true;
    }

    if (body.conversa_encerrada && envio.status !== 'qualificado') {
      updates.status = 'qualificado';
    }

    const { error: updateErr, data: updated, count } = await supa
      .from('campanha_envios')
      .update(updates, { count: 'exact' })
      .eq('id', envioId)
      .select('id, historico_conversa, maturidade');
    if (updateErr) {
      console.error('[marcar-msg-ia] UPDATE falhou:', updateErr);
      return json(500, { ok: false, error: 'update_falhou', detail: updateErr.message });
    }
    console.log('[marcar-msg-ia] UPDATE ok:', { rows: count, sample: updated?.[0] });

    let sourceAtualizadas = 0;
    if (waIds.length > 0) {
      // Marca as msgs na tabela messages com source='ia_campanha'.
      // Webhook da Evolution pode chegar antes ou depois — o UPDATE é idempotente.
      const { error: msgErr, count } = await supa
        .from('messages')
        .update({ source: 'ia_campanha' }, { count: 'exact' })
        .in('wa_message_id', waIds);

      if (msgErr) {
        console.warn('[marcar-msg-ia] update messages.source falhou:', msgErr.message);
      } else {
        sourceAtualizadas = count ?? 0;
      }
    }

    return json(200, {
      ok: true,
      envio_id: envioId,
      novo_historico_size: historico.length,
      handoff_disparado: handoffMarcado,
      maturidade: updates.maturidade ?? envio.maturidade,
      source_atualizadas: sourceAtualizadas,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[marcar-msg-ia] erro:', msg);
    return json(500, { ok: false, error: msg });
  }
});

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
