// marcar-mensagens-lidas — chamada quando o usuário abre uma conversa no SDR Zap.
// Faz 3 coisas:
//  1. Zera unread_count da conversa
//  2. Atualiza messages.status='READ' das msgs recebidas dessa conversa
//  3. Chama Evolution /chat/markChatAsRead pra propagar pro WhatsApp do contato
//     (sem isso, o Evolution Chat.unreadMessages continua com valor antigo e
//     re-sync futuro restaura unread inflado)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { conversaId } = await req.json();
    if (!conversaId) {
      return json(400, { error: 'conversaId é obrigatório' });
    }

    // 1. Carrega conversa pra pegar contact_id, instance_id e numero
    const { data: conversa, error: convErr } = await supabase
      .from('conversas')
      .select(`
        id, contact_id, current_instance_id, numero_contato,
        contacts:contacts!conversas_contact_id_fkey(jid),
        instancias_whatsapp:instancias_whatsapp!conversas_current_instance_id_fkey(nome_instancia)
      `)
      .eq('id', conversaId)
      .maybeSingle();

    if (convErr || !conversa) {
      return json(404, { error: 'conversa não encontrada' });
    }

    // 2. Zera unread_count
    await supabase
      .from('conversas')
      .update({ unread_count: 0, updated_at: new Date().toISOString() })
      .eq('id', conversaId);

    // 3. Marca msgs recebidas (from_me=false) como READ no banco
    if (conversa.contact_id && conversa.current_instance_id) {
      await supabase
        .from('messages')
        .update({ status: 'READ' })
        .eq('contact_id', conversa.contact_id)
        .eq('instance_uuid', conversa.current_instance_id)
        .eq('from_me', false)
        .neq('status', 'READ');
    }

    // 4. Chama Evolution /chat/markChatAsRead — propaga pro WhatsApp e
    //    sincroniza Chat.unreadMessages = 0 do lado do Evolution
    let evoOk = false;
    let evoErr: string | undefined;
    try {
      const { data: cfg } = await supabase
        .from('config_global')
        .select('evolution_base_url, evolution_api_key')
        .single();
      const evoUrl = cfg?.evolution_base_url || Deno.env.get('EVOLUTION_API_URL');
      const evoKey = cfg?.evolution_api_key || Deno.env.get('EVOLUTION_API_KEY');
      const inst = (conversa as { instancias_whatsapp?: { nome_instancia?: string } }).instancias_whatsapp;
      const instanceName = inst?.nome_instancia;
      const jid = (conversa as { contacts?: { jid?: string } }).contacts?.jid
        || `${conversa.numero_contato}@s.whatsapp.net`;

      if (evoUrl && evoKey && instanceName && jid) {
        const r = await fetch(
          `${evoUrl}/chat/markChatAsRead/${encodeURIComponent(instanceName)}`,
          {
            method: 'POST',
            headers: { apikey: evoKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ remoteJid: jid }),
          },
        );
        evoOk = r.ok;
        if (!r.ok) {
          evoErr = `${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`;
        }
      }
    } catch (e) {
      evoErr = e instanceof Error ? e.message : String(e);
    }

    return json(200, {
      success: true,
      conversa_id: conversaId,
      evolution_marked: evoOk,
      evolution_error: evoErr,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[marcar-mensagens-lidas] erro:', msg);
    return json(500, { error: msg });
  }
});

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
