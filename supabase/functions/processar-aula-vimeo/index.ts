// processar-aula-vimeo — extrai captions auto-PT do Vimeo via Referer-bypass.
//
// Recebe { video_id, titulo?, user_id?, silent? } e:
//   1. fetch player.vimeo.com/video/{id}/config?texttrack=pt-x-autogen
//      com Referer: https://platform.g4educacao.com/ (spoof legítimo)
//   2. Parse text_tracks[lang=pt*].url
//   3. fetch do VTT
//   4. Parse VTT → texto contínuo (limpa timestamps)
//   5. POST pra indexar-aula-g4 com fonte=vimeo_captions
//
// Vantagens vs Whisper:
//   - R$ 0 por aula (Vimeo já transcreveu)
//   - ~1 segundo de processamento (vs 1-3min de Whisper)
//   - Qualidade Vimeo auto-captions é boa em PT pra áudio claro
//
// Uso em batch (loop server-side):
//   POST /functions/v1/processar-aula-vimeo
//   { "video_id": "1098576427", "titulo": "G4 - Formação IA - Aula 3", "silent": true }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Domínio whitelistado pelo G4 no Vimeo. Não muda.
const G4_REFERER = 'https://platform.g4educacao.com/';
// User-Agent realista pra evitar bot detection.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

interface ProcessarRequest {
  video_id: string;
  titulo?: string;
  user_id?: string;
  silent?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = (await req.json()) as ProcessarRequest;
    if (!body.video_id) throw new Error('video_id obrigatório');

    const userId = body.user_id || Deno.env.get('ASSISTENTE_USER_ID');
    if (!userId) throw new Error('user_id ausente (passe no body ou setar ASSISTENTE_USER_ID)');

    // 1. Pega config do Vimeo
    const configUrl = `https://player.vimeo.com/video/${body.video_id}/config?texttrack=pt-x-autogen`;
    const cfgR = await fetch(configUrl, {
      headers: { Referer: G4_REFERER, 'User-Agent': USER_AGENT },
    });
    if (!cfgR.ok) {
      const txt = await cfgR.text();
      throw new Error(`Vimeo config ${cfgR.status}: ${txt.slice(0, 200)}`);
    }
    const config = await cfgR.json() as {
      video?: { title?: string; duration?: number };
      request?: { text_tracks?: Array<{ lang?: string; kind?: string; url?: string }> };
    };

    const tracks = config.request?.text_tracks || [];
    const ptTrack = tracks.find(t => t.lang && t.lang.startsWith('pt'));
    if (!ptTrack || !ptTrack.url) {
      return jsonRes(200, {
        ok: false,
        error: 'sem track PT auto-generated',
        video_id: body.video_id,
        tracks_disponiveis: tracks.map(t => t.lang),
      });
    }

    // 2. Baixa VTT (URL pode ser relativa - prefixa com origin se for)
    const vttUrl = ptTrack.url.startsWith('http')
      ? ptTrack.url
      : `https://player.vimeo.com${ptTrack.url}`;
    const vttR = await fetch(vttUrl, {
      headers: { Referer: G4_REFERER, 'User-Agent': USER_AGENT },
    });
    if (!vttR.ok) throw new Error(`VTT fetch ${vttR.status}`);
    const vtt = await vttR.text();

    // 3. Parse VTT → texto contínuo
    const texto = parseVTT(vtt);
    if (texto.length < 50) {
      return jsonRes(200, {
        ok: false,
        error: 'transcrição vazia ou muito curta',
        chars: texto.length,
      });
    }

    // 4. POST pra indexar-aula-g4
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const tituloFinal = body.titulo || config.video?.title || `Vimeo ${body.video_id}`;
    const indexarR = await fetch(`${supabaseUrl}/functions/v1/indexar-aula-g4`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        fonte: 'vimeo_captions',
        vimeo_id: body.video_id,
        titulo: tituloFinal,
        duracao_seg: config.video?.duration || null,
        transcricao_completa: texto,
        silent: body.silent !== false, // default silent em batch
      }),
    });
    const indexarJ = await indexarR.json();

    return jsonRes(200, {
      ok: indexarR.ok && indexarJ.ok,
      video_id: body.video_id,
      titulo: tituloFinal,
      duracao_seg: config.video?.duration,
      chars_extraidos: texto.length,
      indexar_result: indexarJ,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[processar-aula-vimeo] erro:', msg);
    return jsonRes(500, { ok: false, error: msg });
  }
});

// Converte WebVTT em texto contínuo limpando timestamps e índices.
function parseVTT(vtt: string): string {
  const linhas = vtt.split(/\r?\n/);
  const texto: string[] = [];
  let dentroDoCue = false;
  for (const l of linhas) {
    const trim = l.trim();
    if (!trim) { dentroDoCue = false; continue; }
    if (trim === 'WEBVTT' || trim.startsWith('NOTE') || trim.startsWith('STYLE') || trim.startsWith('REGION')) continue;
    if (/^\d+$/.test(trim)) continue; // índice
    if (trim.includes('-->')) { dentroDoCue = true; continue; } // timestamp line
    if (dentroDoCue) {
      // remove tags VTT inline (<v>, <c>, etc)
      const limpo = trim.replace(/<[^>]+>/g, '').trim();
      if (limpo) texto.push(limpo);
    }
  }
  return texto.join(' ').replace(/\s+/g, ' ').trim();
}

function jsonRes(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
