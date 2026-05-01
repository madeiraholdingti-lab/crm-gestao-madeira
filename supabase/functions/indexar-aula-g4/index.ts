// indexar-aula-g4 — pipeline RAG das aulas G4 do Maikon.
//
// Recebe áudio (base64 do WhatsApp) ou file_id do Google Drive (vídeo/áudio
// puxado via OAuth da conta dele). Transcreve com Whisper, faz chunking,
// gera embeddings em batch (text-embedding-3-small) e popula
// assistente_g4_aulas + assistente_g4_chunks.
//
// Invocação direta (do agente ou tool):
//   POST /functions/v1/indexar-aula-g4
//   Body:
//     { user_id, fonte: "audio_whatsapp", audio_base64, mime?, titulo?, wa_message_id? }
//   ou
//     { user_id, fonte: "drive_video", drive_file_id, titulo? }
//
// Retorno:
//   { ok: true, aula_id, total_chunks, duracao_seg, custo_estimado_brl }
//   ou
//   { ok: false, error, aula_id? } — se chegou a criar registro mesmo no erro
//
// Whisper aceita até 25MB por request. Pra vídeos maiores no Drive, retorna
// erro pedindo pro Maikon mandar só o áudio (Fase 6.5: ffmpeg em VPS pra
// extrair áudio automático).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const WHISPER_MODEL = 'whisper-1';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;

// Chunking: ~800 tokens com overlap ~150 tokens.
// Aproximação pt-BR: 1 token ≈ 4 chars → 3200 chars / 600 chars overlap.
const CHUNK_CHARS = 3200;
const CHUNK_OVERLAP_CHARS = 600;

// Whisper limit: 25MB (deixa margem de 1MB pra metadata)
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

// Batch de embeddings: API OpenAI aceita até 2048 inputs por request,
// mas vamos em lotes de 100 pra controle de erro.
const EMBED_BATCH = 100;

// Custos aproximados (cotação BRL/USD ~5)
const WHISPER_USD_POR_MIN = 0.006;
const EMBEDDING_USD_POR_MTOKEN = 0.02;
const USD_BRL = 5.0;

type SupabaseClient = ReturnType<typeof createClient>;

interface IndexarRequest {
  user_id: string;
  fonte: 'audio_whatsapp' | 'drive_video' | 'vimeo_captions';
  audio_base64?: string;
  mime?: string;
  drive_file_id?: string;
  titulo?: string;
  wa_message_id?: string;
  // Para fonte=vimeo_captions: transcrição já pronta (extraída do player Vimeo)
  transcricao_completa?: string;
  vimeo_id?: string;
  duracao_seg?: number;
  // Em batch (várias aulas indexadas em sequência) suprime notificação WhatsApp
  silent?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let aulaId: string | null = null;
  let bodySilent = false;
  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const body = (await req.json()) as IndexarRequest;
    bodySilent = !!body.silent;
    if (!body.user_id) throw new Error('user_id obrigatório');
    if (!body.fonte) throw new Error('fonte obrigatória');

    // 1. Cria registro com status pendente (idempotente via UNIQUE)
    // Pra vimeo_captions: usamos vimeo_id como identificador único (via drive_file_id pra reusar UNIQUE)
    const externalId = body.fonte === 'vimeo_captions'
      ? `vimeo:${body.vimeo_id}`
      : body.drive_file_id || null;
    const waMsgId = body.fonte === 'vimeo_captions' ? null : (body.wa_message_id || null);

    const aulaRow = {
      user_id: body.user_id,
      titulo: body.titulo || `Aula ${new Date().toISOString().slice(0, 10)}`,
      fonte: body.fonte,
      drive_file_id: externalId,
      wa_message_id: waMsgId,
      status: 'pendente',
    };

    let existQ = supa
      .from('assistente_g4_aulas')
      .select('id, status')
      .eq('user_id', body.user_id);
    if (externalId) existQ = existQ.eq('drive_file_id', externalId);
    else if (waMsgId) existQ = existQ.eq('wa_message_id', waMsgId);
    else existQ = existQ.eq('titulo', aulaRow.titulo);
    const { data: existente } = await existQ.maybeSingle();

    if (existente && (existente as { status: string }).status === 'concluida') {
      return jsonRes(200, {
        ok: true,
        aula_id: (existente as { id: string }).id,
        skipped: true,
        reason: 'já indexada',
      });
    }

    if (existente) {
      aulaId = (existente as { id: string }).id;
    } else {
      const { data: nova, error: errNova } = await supa
        .from('assistente_g4_aulas')
        .insert(aulaRow)
        .select('id')
        .single();
      if (errNova) throw new Error(`insert aula: ${errNova.message}`);
      aulaId = (nova as { id: string }).id;
    }

    // 2-4. Obter texto da transcrição: ou via Whisper (audio_whatsapp/drive_video)
    //      ou direto do body (vimeo_captions — Vimeo já gerou captions auto).
    let transcricaoTexto: string;
    let duracaoSeg: number | null;

    if (body.fonte === 'vimeo_captions') {
      if (!body.transcricao_completa || body.transcricao_completa.length < 50) {
        throw new Error('transcricao_completa obrigatória e ≥50 chars pra fonte=vimeo_captions');
      }
      transcricaoTexto = body.transcricao_completa;
      duracaoSeg = body.duracao_seg ?? null;
      await supa.from('assistente_g4_aulas').update({ status: 'indexando' }).eq('id', aulaId);
    } else {
      await supa.from('assistente_g4_aulas').update({ status: 'transcrevendo' }).eq('id', aulaId);
      let audioBytes: Uint8Array;
      let audioMime: string;
      if (body.fonte === 'audio_whatsapp') {
        if (!body.audio_base64) throw new Error('audio_base64 obrigatório pra fonte=audio_whatsapp');
        audioBytes = Uint8Array.from(atob(body.audio_base64), c => c.charCodeAt(0));
        audioMime = body.mime || 'audio/ogg';
      } else if (body.fonte === 'drive_video') {
        if (!body.drive_file_id) throw new Error('drive_file_id obrigatório pra fonte=drive_video');
        const drive = await downloadDoDrive(supa, body.user_id, body.drive_file_id);
        audioBytes = drive.bytes;
        audioMime = drive.mime;
      } else {
        throw new Error(`fonte inválida: ${body.fonte}`);
      }

      if (audioBytes.length > MAX_AUDIO_BYTES) {
        throw new Error(
          `arquivo ${(audioBytes.length / 1024 / 1024).toFixed(1)}MB excede limite de 25MB do Whisper.`,
        );
      }

      const transcricao = await transcreverWhisper(audioBytes, audioMime);
      duracaoSeg = transcricao.duration ? Math.round(transcricao.duration) : null;
      if (!transcricao.text || transcricao.text.length < 50) {
        throw new Error('Whisper retornou transcrição vazia ou muito curta');
      }
      transcricaoTexto = transcricao.text;

      await supa.from('assistente_g4_aulas').update({
        status: 'indexando',
        transcricao_completa: transcricaoTexto,
        duracao_seg: duracaoSeg,
      }).eq('id', aulaId);
    }

    // Pra vimeo_captions, salva transcrição agora (não foi salva acima)
    if (body.fonte === 'vimeo_captions') {
      await supa.from('assistente_g4_aulas').update({
        transcricao_completa: transcricaoTexto,
        duracao_seg: duracaoSeg,
      }).eq('id', aulaId);
    }

    // 6. Chunking
    const chunks = chunkText(transcricaoTexto, CHUNK_CHARS, CHUNK_OVERLAP_CHARS);
    if (chunks.length === 0) throw new Error('chunking produziu 0 chunks');

    // 7. Embeddings em batches
    const embeddings: number[][] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const embs = await gerarEmbeddings(batch);
      embeddings.push(...embs);
    }

    if (embeddings.length !== chunks.length) {
      throw new Error(`embedding count mismatch: ${embeddings.length} vs ${chunks.length} chunks`);
    }

    // 8. Limpa chunks anteriores se reindexando
    await supa.from('assistente_g4_chunks').delete().eq('aula_id', aulaId);

    // 9. INSERT chunks (em batches pra não estourar payload)
    const aulaTitulo = body.titulo || aulaRow.titulo;
    const totalChunks = chunks.length;
    const segPorChunk = duracaoSeg ? Math.floor(duracaoSeg / totalChunks) : null;

    const INSERT_BATCH = 50;
    for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
      const slice = chunks.slice(i, i + INSERT_BATCH).map((texto, j) => {
        const idx = i + j;
        return {
          aula_id: aulaId,
          aula_titulo: aulaTitulo,
          chunk_idx: idx,
          texto,
          // pgvector aceita array literal: '[0.1, 0.2, ...]'
          embedding: `[${embeddings[idx].join(',')}]`,
          timestamp_inicio_seg: segPorChunk !== null ? idx * segPorChunk : null,
        };
      });
      const { error: errIns } = await supa.from('assistente_g4_chunks').insert(slice);
      if (errIns) throw new Error(`insert chunks (batch ${i}): ${errIns.message}`);
    }

    // 10. Custo estimado (vimeo_captions = só embedding, sem Whisper)
    const totalTokensEmbed = chunks.reduce((acc, c) => acc + Math.ceil(c.length / 4), 0);
    const usaWhisper = body.fonte !== 'vimeo_captions';
    const custoUsd =
      (usaWhisper && duracaoSeg ? (duracaoSeg / 60) * WHISPER_USD_POR_MIN : 0) +
      (totalTokensEmbed / 1_000_000) * EMBEDDING_USD_POR_MTOKEN;
    const custoBrl = +(custoUsd * USD_BRL).toFixed(4);

    // 11. Concluir
    await supa.from('assistente_g4_aulas').update({
      status: 'concluida',
      total_chunks: totalChunks,
      indexada_em: new Date().toISOString(),
      custo_estimado_brl: custoBrl,
    }).eq('id', aulaId);

    // 12. Notifica Maikon via WhatsApp (suprime em batch via silent=true)
    if (!body.silent) {
      await notificarMaikon(
        supa,
        `Madeira aqui — aula "${aulaTitulo}" indexada. ${totalChunks} trechos${duracaoSeg ? `, ${Math.round(duracaoSeg / 60)}min` : ''}. Pode me perguntar sobre.`,
      );
    }

    return jsonRes(200, {
      ok: true,
      aula_id: aulaId,
      titulo: aulaTitulo,
      total_chunks: totalChunks,
      duracao_seg: duracaoSeg,
      custo_estimado_brl: custoBrl,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[indexar-aula-g4] erro:', msg);
    if (aulaId) {
      await supa
        .from('assistente_g4_aulas')
        .update({ status: 'erro', erro: msg.slice(0, 500) })
        .eq('id', aulaId);
    }
    // Avisa só se não for batch
    if (!bodySilent) {
      await notificarMaikon(supa, `Madeira aqui — falhei ao indexar aula: ${msg.slice(0, 200)}`).catch(() => {});
    }
    return jsonRes(500, { ok: false, error: msg, aula_id: aulaId });
  }
});

async function notificarMaikon(supa: SupabaseClient, texto: string): Promise<void> {
  try {
    const phone = Deno.env.get('ASSISTENTE_USER_PHONE');
    const inst = Deno.env.get('ASSISTENTE_INSTANCE_NAME');
    if (!phone || !inst) return;
    const { data: cfg } = await supa
      .from('config_global')
      .select('evolution_base_url, evolution_api_key')
      .single();
    const url = (cfg as { evolution_base_url?: string } | null)?.evolution_base_url;
    const key = (cfg as { evolution_api_key?: string } | null)?.evolution_api_key;
    if (!url || !key) return;
    await fetch(`${url}/message/sendText/${encodeURIComponent(inst)}`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: phone, text: texto }),
    });
  } catch (e) {
    console.warn('[notificarMaikon] falhou:', e);
  }
}

// =============================================================================
// Whisper
// =============================================================================

interface WhisperResult {
  text: string;
  duration?: number;
}

async function transcreverWhisper(bytes: Uint8Array, mime: string): Promise<WhisperResult> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY ausente');

  const blob = new Blob([bytes], { type: mime });
  const ext = mime.includes('mp4') ? 'mp4' : mime.includes('mp3') ? 'mp3' : mime.includes('m4a') ? 'm4a' : 'ogg';
  const form = new FormData();
  form.append('file', blob, `aula.${ext}`);
  form.append('model', WHISPER_MODEL);
  form.append('language', 'pt');
  // verbose_json traz duration; útil pra timestamp aproximado dos chunks
  form.append('response_format', 'verbose_json');

  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Whisper ${r.status}: ${txt.slice(0, 300)}`);
  }
  const j = await r.json();
  return { text: (j.text || '').trim(), duration: j.duration };
}

// =============================================================================
// Embeddings (text-embedding-3-small)
// =============================================================================

async function gerarEmbeddings(textos: string[]): Promise<number[][]> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY ausente');

  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: textos,
    }),
  });

  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Embedding ${r.status}: ${txt.slice(0, 300)}`);
  }
  const j = await r.json();
  const data = (j.data || []) as Array<{ embedding: number[]; index: number }>;
  if (data.length !== textos.length) {
    throw new Error(`embedding response count ${data.length} ≠ ${textos.length} inputs`);
  }
  // Garante ordem por index (a API retorna na mesma ordem mas é boa prática)
  data.sort((a, b) => a.index - b.index);
  for (const e of data) {
    if (!Array.isArray(e.embedding) || e.embedding.length !== EMBEDDING_DIM) {
      throw new Error(`embedding dim inválida: ${e.embedding?.length}`);
    }
  }
  return data.map(d => d.embedding);
}

// =============================================================================
// Google Drive download (usa google_accounts existente)
// =============================================================================

async function downloadDoDrive(
  supa: SupabaseClient,
  userId: string,
  fileId: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const encKey = Deno.env.get('GOOGLE_TOKEN_ENCRYPTION_KEY');
  if (!encKey) throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY ausente');

  const { data: contas, error } = await supa.rpc('get_active_google_accounts_decrypted', {
    key: encKey,
  });
  if (error) throw new Error(`RPC google_accounts: ${error.message}`);

  const conta = (contas || []).find((c: { user_id: string }) => c.user_id === userId) as
    | { id: string; refresh_token: string; access_token: string; expires_at: string | null }
    | undefined;
  if (!conta) throw new Error('Maikon não tem conta Google ativa — conecta em /perfil');

  // Refresh access_token se expirado (margem 5min)
  const accessToken = await garantirAccessToken(supa, conta, encKey);

  // Verifica metadata do arquivo (mime + size)
  const metaR = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType,size`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!metaR.ok) {
    const txt = await metaR.text();
    throw new Error(`Drive metadata ${metaR.status}: ${txt.slice(0, 200)}`);
  }
  const meta = await metaR.json() as { name: string; mimeType: string; size?: string };
  const sizeBytes = meta.size ? parseInt(meta.size, 10) : 0;
  if (sizeBytes && sizeBytes > MAX_AUDIO_BYTES) {
    throw new Error(
      `arquivo "${meta.name}" tem ${(sizeBytes / 1024 / 1024).toFixed(1)}MB. Whisper aceita máx 25MB. Extrai só o áudio antes (ffmpeg, etc) ou divide em partes.`,
    );
  }

  // Download conteúdo
  const dlR = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!dlR.ok) {
    const txt = await dlR.text();
    throw new Error(`Drive download ${dlR.status}: ${txt.slice(0, 200)}`);
  }
  const ab = await dlR.arrayBuffer();
  return { bytes: new Uint8Array(ab), mime: meta.mimeType || 'video/mp4' };
}

async function garantirAccessToken(
  supa: SupabaseClient,
  conta: { id: string; refresh_token: string; access_token: string; expires_at: string | null },
  encKey: string,
): Promise<string> {
  const expiresAt = conta.expires_at ? new Date(conta.expires_at).getTime() : 0;
  const margemMs = 5 * 60 * 1000;
  if (conta.access_token && expiresAt - Date.now() > margemMs) {
    return conta.access_token;
  }

  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID/SECRET ausentes');

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: conta.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Refresh token ${r.status}: ${txt.slice(0, 200)}`);
  }
  const j = await r.json() as { access_token: string; expires_in: number };
  const novoExp = new Date(Date.now() + j.expires_in * 1000).toISOString();
  await supa.rpc('update_google_account_tokens', {
    p_account_id: conta.id,
    p_access_token: j.access_token,
    p_expires_at: novoExp,
    p_encryption_key: encKey,
  });
  return j.access_token;
}

// =============================================================================
// Chunking simples por chars com overlap
// =============================================================================

function chunkText(texto: string, tamanho: number, overlap: number): string[] {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  if (limpo.length <= tamanho) return [limpo];

  const chunks: string[] = [];
  let pos = 0;
  while (pos < limpo.length) {
    let fim = Math.min(pos + tamanho, limpo.length);
    // Tenta cortar em fim de sentença pra não quebrar no meio
    if (fim < limpo.length) {
      const ultimoPonto = limpo.lastIndexOf('. ', fim);
      if (ultimoPonto > pos + tamanho * 0.7) {
        fim = ultimoPonto + 1;
      }
    }
    chunks.push(limpo.slice(pos, fim).trim());
    if (fim >= limpo.length) break;
    pos = fim - overlap;
  }
  return chunks.filter(c => c.length > 30);
}

function jsonRes(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
