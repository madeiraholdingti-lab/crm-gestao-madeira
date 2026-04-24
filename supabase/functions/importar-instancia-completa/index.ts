// importar-instancia-completa — importa contatos + conversas de UMA instância Evolution
// pro banco local. Usado após o Maikon/Iza reconectar o WhatsApp pra não perder
// contatos/conversas já cadastrados no Evolution.
//
// Input: { instanceName: string, batch?: "contatos"|"mensagens"|"ambos", offset?: number, limit?: number }
// Default: batch="ambos", offset=0, limit=200 (pra não estourar recurso Deno)
// Retorna: { ok, contatos_importados, mensagens_importadas, tem_mais }
//
// Pra instâncias grandes (5k+ contatos): chamar várias vezes com offset incremental
// até tem_mais=false.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EvoContact {
  remoteJid?: string;
  pushName?: string | null;
  profilePicUrl?: string | null;
  isGroup?: boolean;
}

interface EvoChat {
  remoteJid?: string;
  pushName?: string | null;
  profilePicUrl?: string | null;
  lastMessage?: { messageTimestamp?: number | { low: number } };
}

function jidToPhone(jid: string): string {
  return jid.replace('@s.whatsapp.net', '').replace('@g.us', '').replace('@lid', '');
}

function isValidBRPhone(phone: string): boolean {
  const d = phone.replace(/\D/g, '');
  // Só importa contatos com phone BR válido (10-13 dígitos, começando com 55 ou com DDD)
  return d.length >= 10 && d.length <= 13;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as {
      instanceName?: string;
      batch?: 'contatos' | 'mensagens' | 'ambos';
      offset?: number;
      limit?: number;
    };

    const instanceName = body.instanceName;
    if (!instanceName) {
      return new Response(JSON.stringify({ ok: false, error: 'instanceName obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const batch = body.batch || 'ambos';
    const offset = body.offset ?? 0;
    const limit = Math.min(body.limit ?? 200, 500);

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

    let contatosImportados = 0;
    let mensagensImportadas = 0;
    let temMais = false;

    // === Contatos ===
    if (batch === 'contatos' || batch === 'ambos') {
      const r = await fetch(
        `${evoUrl}/chat/findContacts/${encodeURIComponent(instanceName)}`,
        { method: 'POST', headers: { apikey: evoKey, 'Content-Type': 'application/json' }, body: JSON.stringify({}) }
      );
      if (r.ok) {
        const contacts: EvoContact[] = await r.json();
        // Filtra ANTES de paginar — Evolution retorna muitos @lid (linked devices)
        // e grupos que não usamos. Pagina só os válidos pra não desperdiçar batches.
        const validContacts = contacts.filter(c => {
          const jid = c.remoteJid;
          if (!jid || jid.includes('@g.us') || jid.includes('@lid') || c.isGroup) return false;
          const phone = jidToPhone(jid);
          return isValidBRPhone(phone);
        });

        const slice = validContacts.slice(offset, offset + limit);
        temMais = offset + limit < validContacts.length;

        const rowsToUpsert: Array<Record<string, unknown>> = [];
        for (const c of slice) {
          const jid = c.remoteJid!;
          const phone = jidToPhone(jid);
          rowsToUpsert.push({
            jid,
            phone,
            name: c.pushName || null,
            profile_picture_url: c.profilePicUrl || null,
            tipo_contato: 'importado',
          });
        }

        // Upsert em lotes de 100 pra não travar
        const chunkSize = 100;
        for (let i = 0; i < rowsToUpsert.length; i += chunkSize) {
          const chunk = rowsToUpsert.slice(i, i + chunkSize);
          const { error } = await supa
            .from('contacts')
            .upsert(chunk, { onConflict: 'jid', ignoreDuplicates: false });
          if (error) {
            console.error('[import] erro upsert contatos chunk:', error);
          } else {
            contatosImportados += chunk.length;
          }
        }
      }
    }

    // === Mensagens (últimos chats com msgs recentes) ===
    if (batch === 'mensagens' || batch === 'ambos') {
      const r = await fetch(
        `${evoUrl}/chat/findChats/${encodeURIComponent(instanceName)}`,
        { method: 'POST', headers: { apikey: evoKey, 'Content-Type': 'application/json' }, body: JSON.stringify({}) }
      );
      if (r.ok) {
        const chats: EvoChat[] = await r.json();
        // Só processa chats individuais (não grupos), top N por timestamp
        const chatsIndividuais = chats.filter(c => c.remoteJid && c.remoteJid.includes('@s.whatsapp.net')).slice(0, 100);

        // Busca contato pra cada chat — garante que existe antes de importar msgs
        for (const chat of chatsIndividuais) {
          const jid = chat.remoteJid!;
          const phone = jidToPhone(jid);
          if (!isValidBRPhone(phone)) continue;

          // Garante que o contato existe
          await supa.from('contacts').upsert({
            jid, phone,
            name: chat.pushName || null,
            profile_picture_url: chat.profilePicUrl || null,
            tipo_contato: 'importado',
          }, { onConflict: 'jid' });

          mensagensImportadas++;
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        instanceName,
        batch,
        offset,
        limit,
        contatos_importados: contatosImportados,
        chats_sincronizados: mensagensImportadas,
        tem_mais: temMais,
        next_offset: temMais ? offset + limit : null,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[importar-instancia-completa] erro:', msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
