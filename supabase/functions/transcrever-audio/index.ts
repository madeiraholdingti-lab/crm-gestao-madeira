// transcrever-audio — usa OpenAI Whisper pra transcrever áudios do WhatsApp.
//
// Input: { message_id: uuid } OU { wa_message_id: string }
// Output: { ok, text, cached }
//
// Source do áudio (em ordem de preferência):
//   1. raw_payload.message.audioMessage.base64 (vem do webhook se Evolution enviou)
//   2. raw_payload.message.pttMessage.base64
//   3. media_url (busca direto da CDN)
//   4. Evolution /chat/getBase64FromMediaMessage/{instance} (último recurso)
//
// Após transcrever, atualiza messages.text = '[Áudio]: <transcrição>'.
// Convenção compatível com o que já existe no webhook (campanha auto-transcribe).
// Idempotente: se text já começa com '[Áudio]:', retorna direto sem chamar OpenAI.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MsgRow {
  id: string;
  wa_message_id: string;
  message_type: string;
  text: string | null;
  instance: string | null;
  raw_payload: Record<string, unknown> | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as {
      message_id?: string;
      wa_message_id?: string;
      force?: boolean;
    };
    if (!body.message_id && !body.wa_message_id) {
      return json(400, { ok: false, error: 'message_id ou wa_message_id obrigatório' });
    }

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let q = supa
      .from('messages')
      .select('id, wa_message_id, message_type, text, instance, raw_payload');
    q = body.message_id
      ? q.eq('id', body.message_id)
      : q.eq('wa_message_id', body.wa_message_id!);
    const { data: msg } = await q.maybeSingle();

    if (!msg) return json(404, { ok: false, error: 'mensagem não encontrada' });
    const m = msg as MsgRow;

    if (m.message_type !== 'audio') {
      return json(400, { ok: false, error: 'mensagem não é áudio', message_type: m.message_type });
    }

    // Idempotência: já transcrita?
    if (!body.force && m.text && m.text.startsWith('[Áudio]:')) {
      return json(200, { ok: true, text: m.text, cached: true });
    }

    // Pega base64 do raw_payload
    const raw = m.raw_payload as
      | { message?: { audioMessage?: { base64?: string; mimetype?: string }; pttMessage?: { base64?: string; mimetype?: string } } }
      | null;
    let base64 = raw?.message?.audioMessage?.base64 || raw?.message?.pttMessage?.base64 || null;
    let mimeType = raw?.message?.audioMessage?.mimetype || raw?.message?.pttMessage?.mimetype || 'audio/ogg';

    // Fallback: pega do Evolution via /chat/getBase64FromMediaMessage
    if (!base64) {
      const { data: cfg } = await supa
        .from('config_global')
        .select('evolution_base_url, evolution_api_key')
        .single();
      const evoUrl = cfg?.evolution_base_url || Deno.env.get('EVOLUTION_API_URL');
      const evoKey = cfg?.evolution_api_key || Deno.env.get('EVOLUTION_API_KEY');

      if (evoUrl && evoKey && m.instance && m.wa_message_id) {
        try {
          const r = await fetch(
            `${evoUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(m.instance)}`,
            {
              method: 'POST',
              headers: { apikey: evoKey, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: { key: { id: m.wa_message_id } },
                convertToMp4: false,
              }),
            },
          );
          if (r.ok) {
            const j = await r.json();
            base64 = j.base64 || j.media || null;
            mimeType = j.mimetype || mimeType;
          }
        } catch (e) {
          console.warn('[transcrever-audio] fallback Evolution falhou:', e);
        }
      }
    }

    if (!base64) {
      return json(404, { ok: false, error: 'áudio não disponível (base64 não encontrado)' });
    }

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) return json(500, { ok: false, error: 'OPENAI_API_KEY não configurada' });

    // Whisper
    const bin = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const blob = new Blob([bin], { type: mimeType });
    const form = new FormData();
    form.append('file', blob, 'audio.ogg');
    form.append('model', 'whisper-1');
    form.append('language', 'pt');

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      return json(502, { ok: false, error: `Whisper ${r.status}: ${errText.slice(0, 200)}` });
    }

    const j = await r.json();
    const transcricao = (j.text || '').trim();
    if (!transcricao) {
      return json(200, { ok: false, error: 'Whisper retornou vazio', text: m.text });
    }

    const novoText = `[Áudio]: ${transcricao}`;
    await supa
      .from('messages')
      .update({ text: novoText })
      .eq('id', m.id);

    return json(200, { ok: true, text: novoText, cached: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[transcrever-audio] erro:', msg);
    return json(500, { ok: false, error: msg });
  }
});

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
