// sync-unread-evolution — reconcilia conversas.unread_count com o estado real
// do WhatsApp via Evolution. Roda via pg_cron a cada 1h pra evitar inflação
// acumulada (handler messages.update READ pode falhar em races).
//
// Algoritmo:
//   1. Para cada instância 'ativa', GET /chat/findChats — vem unreadMessages real
//   2. Pra cada chat individual (@s.whatsapp.net), faz UPDATE em conversas
//      casando numero_contato (com variantes BR) e current_instance_id
//
// Este é o mesmo procedimento manual que rodamos em 25/04 — agora automatizado.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EvoChat {
  remoteJid?: string;
  unreadMessages?: number;
  unread?: number;
}

function gerarVariantesTelefoneBR(raw: string): string[] {
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) return [];
  const set = new Set<string>([digits]);
  const sem55 = digits.startsWith('55') ? digits.slice(2) : digits;
  if (sem55) {
    set.add(sem55);
    set.add('55' + sem55);
  }
  if (sem55.length === 11 && sem55[2] === '9') {
    const sem9 = sem55.slice(0, 2) + sem55.slice(3);
    set.add(sem9);
    set.add('55' + sem9);
  }
  if (sem55.length === 10) {
    const com9 = sem55.slice(0, 2) + '9' + sem55.slice(2);
    set.add(com9);
    set.add('55' + com9);
  }
  return [...set].filter(v => v.length >= 10);
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
      .select('evolution_base_url, evolution_api_key')
      .single();
    const evoUrl = cfg?.evolution_base_url || Deno.env.get('EVOLUTION_API_URL');
    const evoKey = cfg?.evolution_api_key || Deno.env.get('EVOLUTION_API_KEY');
    if (!evoUrl || !evoKey) {
      return json(500, { ok: false, error: 'Config Evolution ausente' });
    }

    const { data: ativas } = await supa
      .from('instancias_whatsapp')
      .select('id, nome_instancia')
      .eq('status', 'ativa');

    const resumo: Array<{ instancia: string; chats_com_unread: number; conversas_atualizadas: number }> = [];

    for (const inst of (ativas || [])) {
      const r = await fetch(
        `${evoUrl}/chat/findChats/${encodeURIComponent(inst.nome_instancia)}`,
        {
          method: 'POST',
          headers: { apikey: evoKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );

      if (!r.ok) {
        resumo.push({ instancia: inst.nome_instancia, chats_com_unread: 0, conversas_atualizadas: 0 });
        continue;
      }

      const chats: EvoChat[] = await r.json();
      const individuais = chats.filter(c =>
        c.remoteJid && c.remoteJid.endsWith('@s.whatsapp.net')
      );

      // Mapa: phone (sem @) → unreadMessages
      const mapa = new Map<string, number>();
      for (const c of individuais) {
        const phone = c.remoteJid!.split('@')[0].replace(/\D/g, '');
        const unread = (c.unreadMessages ?? c.unread ?? 0) | 0;
        if (phone) mapa.set(phone, unread);
      }

      // Aplica direto: pra cada conversa com unread > 0 ou pra cada
      // entrada no mapa com unread > 0, executa UPDATE com matching de variantes.
      let atualizadas = 0;
      let comUnread = 0;
      for (const [phone, unread] of mapa) {
        if (unread > 0) comUnread++;
        const variantes = gerarVariantesTelefoneBR(phone);
        if (variantes.length === 0) continue;
        const { error, count } = await supa
          .from('conversas')
          .update({ unread_count: unread, updated_at: new Date().toISOString() }, { count: 'exact' })
          .in('numero_contato', variantes)
          .eq('current_instance_id', inst.id)
          .neq('unread_count', unread);
        if (!error && count) atualizadas += count;
      }

      // Zera conversas que NÃO aparecem na lista do Evolution mas têm unread > 0
      // (chats que ficaram quietos e o servidor zerou)
      const phonesEvo = [...mapa.keys()];
      const todasVariantes = phonesEvo.flatMap(p => gerarVariantesTelefoneBR(p));
      if (todasVariantes.length > 0) {
        const { error, count } = await supa
          .from('conversas')
          .update({ unread_count: 0, updated_at: new Date().toISOString() }, { count: 'exact' })
          .eq('current_instance_id', inst.id)
          .gt('unread_count', 0)
          .not('numero_contato', 'in', `(${todasVariantes.map(v => `"${v}"`).join(',')})`);
        if (!error && count) atualizadas += count;
      }

      resumo.push({
        instancia: inst.nome_instancia,
        chats_com_unread: comUnread,
        conversas_atualizadas: atualizadas,
      });
    }

    return json(200, { ok: true, resumo });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[sync-unread-evolution] erro:', msg);
    return json(500, { ok: false, error: msg });
  }
});

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
