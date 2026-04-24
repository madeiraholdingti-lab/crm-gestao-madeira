// importar-mensagens-instancia — importa histórico de msgs individuais de uma instância
// em massa. Itera pelos chats individuais (1-1, ignora grupos/@lid) e pra cada um
// chama Evolution /chat/findMessages com where.key.remoteJid pra puxar o histórico.
//
// Input: { instanceName, startIdx?, count?, maxMsgsPerChat? }
// - startIdx: índice do 1º chat a processar nesse batch (paginação externa)
// - count: quantos chats processar por call (default 10, max 30)
// - maxMsgsPerChat: teto de msgs por conversa (default 500)
//
// Retorna: { ok, chats_processados, imported, skipped, total_chats, tem_mais, next_idx }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EvoMessage {
  key?: { remoteJid?: string; fromMe?: boolean; id?: string };
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { caption?: string };
    audioMessage?: Record<string, unknown>;
    videoMessage?: { caption?: string };
    documentMessage?: { fileName?: string };
    stickerMessage?: Record<string, unknown>;
  };
  messageTimestamp?: number | { low: number };
}

interface EvoChat {
  remoteJid?: string;
}

function jidToPhone(jid: string): string {
  return jid.replace('@s.whatsapp.net', '').replace('@g.us', '').replace('@lid', '');
}

function extractText(m: EvoMessage['message']): string | null {
  if (!m) return null;
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return m.imageMessage.caption;
  if (m.imageMessage) return '📷 Imagem';
  if (m.audioMessage) return '🎤 Áudio';
  if (m.videoMessage?.caption) return m.videoMessage.caption;
  if (m.videoMessage) return '🎬 Vídeo';
  if (m.documentMessage?.fileName) return `📎 ${m.documentMessage.fileName}`;
  if (m.documentMessage) return '📎 Documento';
  if (m.stickerMessage) return '🏷️ Figurinha';
  return null;
}

function detectType(m: EvoMessage['message']): string {
  if (!m) return 'text';
  if (m.imageMessage) return 'image';
  if (m.audioMessage) return 'audio';
  if (m.videoMessage) return 'video';
  if (m.documentMessage) return 'document';
  if (m.stickerMessage) return 'sticker';
  return 'text';
}

function tsToISO(ts?: number | { low: number }): string {
  if (!ts) return new Date().toISOString();
  const n = typeof ts === 'object' && 'low' in ts ? ts.low : (ts as number);
  return new Date((n < 10000000000 ? n * 1000 : n)).toISOString();
}

function phoneVariants(phone: string): string[] {
  const d = phone.replace(/\D/g, '');
  if (d.length < 10) return [];
  const set = new Set<string>([d]);
  const sem55 = d.startsWith('55') ? d.slice(2) : d;
  set.add(sem55); set.add('55' + sem55);
  if (sem55.length === 11 && sem55[2] === '9') { const s = sem55.slice(0,2)+sem55.slice(3); set.add(s); set.add('55'+s); }
  if (sem55.length === 10) { const c = sem55.slice(0,2)+'9'+sem55.slice(2); set.add(c); set.add('55'+c); }
  return [...set];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as {
      instanceName?: string;
      startIdx?: number;
      count?: number;
      maxMsgsPerChat?: number;
    };
    const instanceName = body.instanceName;
    if (!instanceName) {
      return new Response(JSON.stringify({ ok: false, error: 'instanceName obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const startIdx = body.startIdx ?? 0;
    const count = Math.min(body.count ?? 10, 30);
    const maxMsgsPerChat = Math.min(body.maxMsgsPerChat ?? 500, 2000);

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: config } = await supa
      .from('config_global')
      .select('evolution_base_url, evolution_api_key')
      .single();
    const evoUrl = config?.evolution_base_url || Deno.env.get('EVOLUTION_API_URL');
    const evoKey = config?.evolution_api_key || Deno.env.get('EVOLUTION_API_KEY');
    if (!evoUrl || !evoKey) {
      return new Response(JSON.stringify({ ok: false, error: 'Config Evolution ausente' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: inst } = await supa
      .from('instancias_whatsapp')
      .select('id')
      .eq('nome_instancia', instanceName)
      .maybeSingle();
    const instanceUuid = inst?.id || null;

    // 1. Lista todos os chats individuais
    const chatsResp = await fetch(
      `${evoUrl}/chat/findChats/${encodeURIComponent(instanceName)}`,
      { method: 'POST', headers: { apikey: evoKey, 'Content-Type': 'application/json' }, body: JSON.stringify({}) }
    );
    if (!chatsResp.ok) {
      return new Response(JSON.stringify({ ok: false, error: `Evolution findChats ${chatsResp.status}` }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const chatsAll: EvoChat[] = await chatsResp.json();
    const chatsIndiv = chatsAll.filter(c => c.remoteJid && c.remoteJid.endsWith('@s.whatsapp.net'));
    const totalChats = chatsIndiv.length;
    const chatsBatch = chatsIndiv.slice(startIdx, startIdx + count);

    // Cache contacts por jid → id
    const jidCache = new Map<string, string>();
    async function findContactId(jid: string): Promise<string | null> {
      if (jidCache.has(jid)) return jidCache.get(jid)!;
      const phone = jidToPhone(jid);
      const variants = phoneVariants(phone);
      if (variants.length === 0) return null;
      const { data } = await supa
        .from('contacts')
        .select('id')
        .or(`jid.eq.${jid},phone.in.(${variants.join(',')})`)
        .limit(1);
      const id = data?.[0]?.id || null;
      if (id) jidCache.set(jid, id);
      return id;
    }

    let imported = 0;
    let skipped = 0;
    const chatsProcessados: Array<{ jid: string; imported: number; pages: number }> = [];

    for (const chat of chatsBatch) {
      const jid = chat.remoteJid!;
      const contactId = await findContactId(jid);
      if (!contactId) { skipped++; continue; }

      let pageNum = 1;
      let chatImported = 0;
      const maxPages = Math.ceil(maxMsgsPerChat / 100);
      while (pageNum <= maxPages) {
        const msgResp = await fetch(
          `${evoUrl}/chat/findMessages/${encodeURIComponent(instanceName)}`,
          {
            method: 'POST',
            headers: { apikey: evoKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              where: { key: { remoteJid: jid } },
              page: pageNum,
              limit: 100,
            }),
          },
        );
        if (!msgResp.ok) break;
        const data = await msgResp.json();
        const records: EvoMessage[] = data?.messages?.records || [];
        if (records.length === 0) break;

        const rows: Array<Record<string, unknown>> = [];
        for (const m of records) {
          const k = m.key;
          if (!k?.id || !k.remoteJid) continue;
          rows.push({
            wa_message_id: k.id,
            contact_id: contactId,
            instance: instanceName,
            instance_uuid: instanceUuid,
            text: extractText(m.message) || '',
            from_me: !!k.fromMe,
            message_type: detectType(m.message),
            created_at: tsToISO(m.messageTimestamp),
          });
        }

        // Upsert
        if (rows.length > 0) {
          const { error } = await supa
            .from('messages')
            .upsert(rows, { onConflict: 'wa_message_id', ignoreDuplicates: true });
          if (!error) chatImported += rows.length;
        }

        const totalPagesFromApi = data?.messages?.pages ?? 1;
        if (pageNum >= totalPagesFromApi || records.length < 100) break;
        pageNum++;
      }

      imported += chatImported;
      chatsProcessados.push({ jid, imported: chatImported, pages: pageNum });
    }

    const nextIdx = startIdx + count;
    const temMais = nextIdx < totalChats;

    return new Response(
      JSON.stringify({
        ok: true,
        instanceName,
        chats_no_batch: chatsBatch.length,
        chats_processados: chatsProcessados.length,
        imported,
        skipped,
        total_chats: totalChats,
        tem_mais: temMais,
        next_idx: temMais ? nextIdx : null,
        detalhes: chatsProcessados.slice(0, 5), // amostra dos primeiros 5
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[importar-mensagens-instancia] erro:', msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
