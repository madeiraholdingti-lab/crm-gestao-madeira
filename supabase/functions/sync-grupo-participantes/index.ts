// sync-grupo-participantes — busca lista de participantes de um grupo via
// Evolution API e popula whatsapp_group_participants.
//
// Input: { instance, group_jid }
// Output: { ok, total, novos, atualizados }
//
// Chamado sob demanda quando o usuário abre conversa de grupo OU quando
// o autocomplete @ é acionado e os participantes estão desatualizados (>24h).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as { instance?: string; group_jid?: string };
    if (!body.instance || !body.group_jid) {
      return jsonRes(400, { ok: false, error: 'instance e group_jid obrigatórios' });
    }
    if (!body.group_jid.endsWith('@g.us')) {
      return jsonRes(400, { ok: false, error: 'group_jid deve terminar em @g.us' });
    }

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: cfg } = await supa
      .from('config_global')
      .select('evolution_base_url, evolution_api_key')
      .single();
    const evoUrl = (cfg as { evolution_base_url?: string } | null)?.evolution_base_url;
    const evoKey = (cfg as { evolution_api_key?: string } | null)?.evolution_api_key;
    if (!evoUrl || !evoKey) return jsonRes(500, { ok: false, error: 'config Evolution incompleta' });

    // Evolution v2: GET /group/findGroupInfos/{instance}?groupJid=X
    const r = await fetch(
      `${evoUrl}/group/findGroupInfos/${encodeURIComponent(body.instance)}?groupJid=${encodeURIComponent(body.group_jid)}`,
      { headers: { apikey: evoKey } },
    );
    if (!r.ok) {
      return jsonRes(r.status, { ok: false, error: `Evolution ${r.status}: ${(await r.text()).slice(0, 200)}` });
    }
    const j = await r.json();
    type Participant = { id: string; admin?: string | null };
    const participants: Participant[] = (j.participants || []) as Participant[];

    if (participants.length === 0) {
      return jsonRes(200, { ok: true, total: 0, info: 'grupo sem participantes ou Evolution não retornou' });
    }

    // Upsert em batch. Pra nome do participante, Evolution v2 às vezes retorna
    // só o JID. Fallback: usa pushName das mensagens recentes.
    const rows = participants.map(p => ({
      instance: body.instance!,
      group_jid: body.group_jid!,
      participant_jid: p.id,
      participant_name: null as string | null, // enriquecido abaixo
      is_admin: !!p.admin,
    }));

    // Tenta enriquecer participant_name via mensagens recentes nesse grupo
    // (last sender pra cada JID que mandou msg nas últimas 30 dias)
    const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: msgsRecent } = await supa
      .from('messages')
      .select('sender_jid, raw_payload')
      .filter('raw_payload->key->>remoteJid', 'eq', body.group_jid)
      .gte('created_at', desde)
      .limit(2000);

    const nameByJid = new Map<string, string>();
    for (const m of (msgsRecent || []) as Array<Record<string, unknown>>) {
      const senderJid = (m.sender_jid as string) || '';
      const raw = m.raw_payload as { pushName?: string; key?: { participant?: string } } | null;
      const pushName = raw?.pushName;
      const partFromKey = raw?.key?.participant;
      const jid = senderJid || partFromKey;
      if (jid && pushName && !nameByJid.has(jid)) {
        nameByJid.set(jid, pushName);
      }
    }
    for (const row of rows) {
      const name = nameByJid.get(row.participant_jid);
      if (name) row.participant_name = name;
    }

    const { error } = await supa
      .from('whatsapp_group_participants')
      .upsert(rows.map(r => ({ ...r, sync_em: new Date().toISOString() })),
        { onConflict: 'instance,group_jid,participant_jid' });
    if (error) return jsonRes(500, { ok: false, error: error.message });

    return jsonRes(200, {
      ok: true,
      total: rows.length,
      com_nome: rows.filter(r => r.participant_name).length,
    });
  } catch (err) {
    return jsonRes(500, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

function jsonRes(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
