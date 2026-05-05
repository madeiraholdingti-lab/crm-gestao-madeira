// sync-fotos-perfil — popula contacts.profile_picture_url e conversas.foto_contato
// via Evolution /chat/fetchProfilePictureUrl/{instance}.
//
// Estratégia: pra cada instância de atendimento ATIVA, pegar até N contatos
// SEM foto que TEM conversa nessa instância e fazer fetch.
//
// Roda via pg_cron a cada 1h. Pode ser chamado manualmente:
//   POST {instance?, limit=50, force=false}
//
// Custo: zero (Evolution interno). Tempo: ~1-2s por contato (rate limit Evolution).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as {
      instance?: string;
      limit?: number;
      force?: boolean;
    };
    const limit = Math.min(body.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const force = body.force === true;

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

    // Quais instâncias usar
    let instancesQuery = supa
      .from('instancias_whatsapp')
      .select('id, nome_instancia')
      .eq('ativo', true)
      .eq('finalidade', 'atendimento');
    if (body.instance) instancesQuery = instancesQuery.eq('nome_instancia', body.instance);
    const { data: instances } = await instancesQuery;
    if (!instances || instances.length === 0) {
      return jsonRes(200, { ok: true, total: 0, message: 'sem instâncias ativas' });
    }

    const stats: Array<Record<string, unknown>> = [];

    for (const inst of instances) {
      const i = inst as { id: string; nome_instancia: string };

      // Pega contatos com conversa nessa instância e (sem foto) ou (force)
      const { data: candidatos, error: candErr } = await supa
        .from('conversas')
        .select(`
          id,
          numero_contato,
          contact_id,
          contacts!inner(id, jid, profile_picture_url)
        `)
        .eq('current_instance_id', i.id)
        .limit(limit);

      if (candErr) {
        stats.push({ instancia: i.nome_instancia, erro: candErr.message });
        continue;
      }

      type CandRow = { id: string; numero_contato: string; contact_id: string; contacts: { id: string; jid: string | null; profile_picture_url: string | null } };
      const elegiveis = (candidatos as unknown as CandRow[] || []).filter(c =>
        force || !c.contacts.profile_picture_url
      );

      let atualizados = 0;
      let semFoto = 0;
      let erros = 0;

      for (const c of elegiveis) {
        try {
          // Evolution v2: /chat/fetchProfilePictureUrl/{instance}
          const targetNumber = c.contacts.jid?.split('@')[0] || c.numero_contato;
          const r = await fetch(
            `${evoUrl}/chat/fetchProfilePictureUrl/${encodeURIComponent(i.nome_instancia)}`,
            {
              method: 'POST',
              headers: { apikey: evoKey, 'Content-Type': 'application/json' },
              body: JSON.stringify({ number: targetNumber }),
            },
          );
          if (!r.ok) {
            erros++;
            continue;
          }
          const j = await r.json();
          const url = j.profilePictureUrl || j.url || null;

          if (!url) {
            // Evolution responde { profilePictureUrl: null } — marca como "verificado, sem foto"
            // pra não tentar de novo todas vezes (sentinela 'NO_PICTURE')
            await supa
              .from('contacts')
              .update({ profile_picture_url: 'NO_PICTURE' })
              .eq('id', c.contact_id);
            await supa
              .from('conversas')
              .update({ foto_contato: 'NO_PICTURE' })
              .eq('id', c.id);
            semFoto++;
            continue;
          }

          // Atualiza ambas as tabelas em paralelo
          await Promise.all([
            supa.from('contacts').update({ profile_picture_url: url }).eq('id', c.contact_id),
            supa.from('conversas').update({ foto_contato: url }).eq('id', c.id),
          ]);
          atualizados++;

          // Pequeno throttle pra não martelar Evolution
          await new Promise(r => setTimeout(r, 100));
        } catch (e) {
          erros++;
          console.warn(`[sync-fotos] erro contato ${c.numero_contato}:`, e);
        }
      }

      stats.push({
        instancia: i.nome_instancia,
        candidatos: elegiveis.length,
        atualizados,
        sem_foto: semFoto,
        erros,
      });
    }

    return jsonRes(200, { ok: true, stats });
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
