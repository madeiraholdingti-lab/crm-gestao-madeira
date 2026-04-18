import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function sniffAudioFormat(bytes: Uint8Array, hintedMime?: string | null) {
  // Heurísticas simples por assinatura (magic bytes) para evitar salvar .ogg quando na prática é .webm/.mp3/etc.
  // Isso melhora a chance do navegador conseguir tocar o arquivo.
  const headerStr = new TextDecoder().decode(bytes.slice(0, 16));

  // WebM/Matroska: 1A 45 DF A3
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return { mime: 'audio/webm', ext: 'webm' };
  }

  // OGG container: "OggS"
  if (headerStr.startsWith('OggS')) {
    // WhatsApp PTT costuma ser OGG/Opus, que o navegador trata como audio/ogg
    return { mime: 'audio/ogg', ext: 'ogg' };
  }

  // MP3: "ID3" ou frame sync (0xFFEx)
  if (
    headerStr.startsWith('ID3') ||
    (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  ) {
    return { mime: 'audio/mpeg', ext: 'mp3' };
  }

  // WAV: "RIFF....WAVE"
  if (bytes.length >= 12 && headerStr.startsWith('RIFF') && headerStr.slice(8, 12) === 'WAVE') {
    return { mime: 'audio/wav', ext: 'wav' };
  }

  // MP4/M4A: bytes[4..8] == "ftyp"
  if (bytes.length >= 8) {
    const ftyp = new TextDecoder().decode(bytes.slice(4, 8));
    if (ftyp === 'ftyp') {
      return { mime: 'audio/mp4', ext: 'm4a' };
    }
  }

  // AAC (ADTS): 0xFFF1 / 0xFFF9
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] === 0xf1 || bytes[1] === 0xf9)) {
    return { mime: 'audio/aac', ext: 'aac' };
  }

  const fallbackMime = (hintedMime && hintedMime.trim()) ? hintedMime.split(';')[0].trim() : 'audio/ogg';
  const extMap: Record<string, string> = {
    'audio/ogg': 'ogg',
    'audio/opus': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/webm': 'webm',
    'audio/wav': 'wav',
  };

  return { mime: fallbackMime, ext: extMap[fallbackMime] || 'ogg' };
}

async function fetchAudioBase64FromEvolution(serverUrl: string, instanceName: string, waMessageId: string) {
  const evolutionApiKey = Deno.env.get('EVOLUTION_API_KEY');
  if (!evolutionApiKey) {
    console.warn('[taskflow-webhook] EVOLUTION_API_KEY não configurada; não é possível buscar mídia descriptografada');
    return { base64: null as string | null, mimeType: null as string | null };
  }

  try {
    const endpoint = `${serverUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`;
    console.log('[taskflow-webhook] Buscando base64 do áudio na Evolution:', { endpoint, waMessageId });

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: evolutionApiKey,
      },
      body: JSON.stringify({
        message: {
          key: { id: waMessageId },
          convertToMp4: false,
        },
      }),
    });

    if (!resp.ok) {
      console.error('[taskflow-webhook] Evolution não retornou mídia:', resp.status, await resp.text());
      return { base64: null, mimeType: null };
    }

    const data = await resp.json();
    const base64 = data?.base64 || null;
    const mimeType = (data?.mimetype ? String(data.mimetype) : null)?.split(';')[0].trim() || null;

    console.log('[taskflow-webhook] Evolution retornou base64?', { hasBase64: !!base64, mimeType, base64Length: base64?.length });
    return { base64, mimeType };
  } catch (e) {
    console.error('[taskflow-webhook] Falha ao buscar base64 na Evolution:', e);
    return { base64: null, mimeType: null };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // POST - Criar nova tarefa
    if (req.method === 'POST') {
      const contentType = req.headers.get('content-type') || '';
      const url = new URL(req.url);
      let taskData: any = {};
      let audioFile: File | null = null;
      let audioBase64: string | null = null;
      let audioUrlFromPayload: string | null = null;
      let audioMimeType: string | null = null;

      // Verificar se os dados vêm via query params (n8n envia assim quando body é binário)
      const queryParams = Object.fromEntries(url.searchParams.entries());
      const hasQueryData = queryParams.titulo || queryParams.column_id || queryParams.responsavel_id;

      console.log('[taskflow-webhook] Content-Type:', contentType);
      console.log('[taskflow-webhook] Query params:', queryParams);

      // Suporta FormData
      if (contentType.includes('multipart/form-data')) {
        const formData = await req.formData();
        
        // Mesclar dados do FormData com query params (query params tem prioridade se existirem)
        taskData = {
          titulo: queryParams.titulo || formData.get('titulo') as string,
          descricao: queryParams.descricao || formData.get('descricao') as string,
          column_id: queryParams.column_id || formData.get('column_id') as string,
          responsavel_id: queryParams.responsavel_id || formData.get('responsavel_id') as string,
          origem: queryParams.origem || formData.get('origem') as string,
          prazo: queryParams.prazo || formData.get('prazo') as string,
          automation: queryParams.automation || formData.get('automation') as string,
        };
        audioFile = formData.get('audio') as File | null;

        if (audioFile?.type) {
          audioMimeType = audioFile.type;
        }

        // Converter áudio para base64 se existir
        if (audioFile) {
          const arrayBuffer = await audioFile.arrayBuffer();
          audioBase64 = base64Encode(arrayBuffer);
          console.log('[taskflow-webhook] Áudio recebido via FormData, tamanho base64:', audioBase64.length);
        }
        
        console.log('[taskflow-webhook] taskData após mesclar:', { titulo: taskData.titulo, column_id: taskData.column_id, responsavel_id: taskData.responsavel_id });
      }
      // Se tem dados no query params e o body é binário (áudio direto)
      else if (hasQueryData && (contentType.includes('audio/') || contentType.includes('application/octet-stream') || contentType.includes('video/'))) {
        console.log('[taskflow-webhook] Recebendo áudio binário direto com dados via query params');
        
        taskData = {
          titulo: queryParams.titulo,
          descricao: queryParams.descricao,
          column_id: queryParams.column_id,
          responsavel_id: queryParams.responsavel_id,
          origem: queryParams.origem,
          prazo: queryParams.prazo,
          automation: queryParams.automation,
        };
        
        audioMimeType = contentType.split(';')[0].trim();
        
        // Ler o body como binário
        const arrayBuffer = await req.arrayBuffer();
        audioBase64 = base64Encode(arrayBuffer);
        console.log('[taskflow-webhook] Áudio binário recebido, tamanho base64:', audioBase64.length, 'mime:', audioMimeType);
      }
      // Fallback: tentar como JSON
      else {
        let body: any;
        try {
          body = await req.json();
        } catch (jsonError) {
          // Se não é JSON, pode ser áudio binário sem query params - tentar ler como binário
          console.log('[taskflow-webhook] Body não é JSON, tentando como binário com query params');
          if (hasQueryData) {
            taskData = {
              titulo: queryParams.titulo,
              descricao: queryParams.descricao,
              column_id: queryParams.column_id,
              responsavel_id: queryParams.responsavel_id,
              origem: queryParams.origem,
              prazo: queryParams.prazo,
              automation: queryParams.automation,
            };
            // Body já foi consumido, então não podemos ler novamente
            console.log('[taskflow-webhook] Usando dados do query params, body já consumido');
          } else {
            throw new Error('Body não é JSON válido e não há dados no query params');
          }
          body = {};
        }
        
        // Se conseguiu parsear JSON
        if (Object.keys(body).length > 0) {
          taskData = body;
          audioBase64 = body.audio_base64 || null;
          audioUrlFromPayload = body.audio_url || null;
          audioMimeType = body.audio_mime_type || body.audio_mimetype || null;

          console.log('[taskflow-webhook] Body JSON recebido - keys:', Object.keys(body));
          console.log('[taskflow-webhook] raw_payload type:', typeof body.raw_payload);

          // Se veio raw_payload, verificar se é URL, JSON string ou objeto
          if (body.raw_payload) {
            let rawPayload = body.raw_payload;
            let parsedPayload: any = null;

            // Se raw_payload é uma string
            if (typeof rawPayload === 'string') {
              // Se parece com URL (começa com http), usar como audio_url
              if (rawPayload.startsWith('http')) {
                audioUrlFromPayload = audioUrlFromPayload || rawPayload;
                console.log('[taskflow-webhook] raw_payload é URL de áudio');
              } else if (rawPayload === '[object Object]') {
                // n8n às vezes converte objeto para "[object Object]" - não é útil
                console.log('[taskflow-webhook] raw_payload é [object Object] - ignorando (use JSON.stringify no n8n)');
              } else {
                // Tentar parsear como JSON
                try {
                  parsedPayload = JSON.parse(rawPayload);
                  console.log('[taskflow-webhook] raw_payload parseado como JSON');
                } catch (_e) {
                  console.log('[taskflow-webhook] raw_payload não é JSON válido:', rawPayload.substring(0, 100));
                }
              }
            } else if (typeof rawPayload === 'object' && rawPayload !== null) {
              // raw_payload já é um objeto
              parsedPayload = rawPayload;
              console.log('[taskflow-webhook] raw_payload já é objeto');
            }

            // Extrair áudio do payload parseado
            if (parsedPayload) {
              // Tentar múltiplos caminhos para encontrar o audioMessage
              const audioMessage =
                parsedPayload?.data?.message?.audioMessage ||
                parsedPayload?.data?.message?.pttMessage ||
                parsedPayload?.message?.audioMessage ||
                parsedPayload?.message?.pttMessage ||
                parsedPayload?.audioMessage ||
                parsedPayload?.pttMessage;

              if (audioMessage) {
                audioUrlFromPayload = audioUrlFromPayload || audioMessage.url;
                audioBase64 = audioBase64 || audioMessage.base64;
                audioMimeType = audioMimeType || audioMessage.mimetype || audioMessage.mimeType || null;
                console.log(
                  '[taskflow-webhook] Extraído audioMessage - URL:',
                  !!audioUrlFromPayload,
                  'Base64:',
                  !!audioBase64,
                  'Base64 length:',
                  audioBase64?.length || 0,
                  'Mime:',
                  audioMimeType
                );
              } else {
                console.log('[taskflow-webhook] audioMessage não encontrado no payload. Keys disponíveis:', 
                  Object.keys(parsedPayload),
                  'data.message keys:', parsedPayload?.data?.message ? Object.keys(parsedPayload.data.message) : 'N/A'
                );
              }
            }
          }
        }
      }

      // Se não veio base64, tentar buscar via Evolution (mesmo tratamento usado para mídia no SDRZap)
      if (!audioBase64) {
        const serverUrl: string | null = taskData.server_url || taskData.serverUrl || null;
        const instanceName: string | null = taskData.instance_name || taskData.instanceName || taskData.instance || null;

        let waMessageId: string | null =
          taskData.wa_message_id ||
          taskData.waMessageId ||
          taskData.message_id ||
          taskData.messageId ||
          null;

        // Tenta extrair o ID de dentro do raw_payload
        if (!waMessageId && taskData.raw_payload) {
          try {
            const parsed = typeof taskData.raw_payload === 'string' ? JSON.parse(taskData.raw_payload) : taskData.raw_payload;
            const d = parsed?.data || parsed;
            waMessageId = d?.key?.id || d?.id || d?.message?.key?.id || d?.data?.key?.id || null;
          } catch (_e) {
            // ignore
          }
        }

        if (serverUrl && instanceName && waMessageId) {
          const evo = await fetchAudioBase64FromEvolution(serverUrl, instanceName, waMessageId);
          if (evo.base64) {
            audioBase64 = evo.base64;
            audioMimeType = evo.mimeType || audioMimeType || 'audio/ogg';
          }
        }
      }

      // Fallback: baixar direto da URL (atenção: URL do WhatsApp CDN pode vir criptografada)
      if (audioUrlFromPayload && !audioBase64) {
        console.log('[taskflow-webhook] Baixando áudio da URL:', audioUrlFromPayload.substring(0, 50) + '...');
        try {
          const audioResponse = await fetch(audioUrlFromPayload);
          if (audioResponse.ok) {
            const ct = audioResponse.headers.get('content-type');
            audioMimeType = (ct ? ct.split(';')[0].trim() : audioMimeType);
            console.log('[taskflow-webhook] Content-Type detectado:', audioMimeType);

            const audioArrayBuffer = await audioResponse.arrayBuffer();
            audioBase64 = base64Encode(audioArrayBuffer);
            console.log('[taskflow-webhook] Áudio baixado com sucesso, tamanho base64:', audioBase64.length);
          } else {
            console.error('[taskflow-webhook] Erro ao baixar áudio:', audioResponse.status);
          }
        } catch (downloadError) {
          console.error('[taskflow-webhook] Erro ao baixar áudio:', downloadError);
        }
      }

      console.log('[taskflow-webhook] POST - Criando tarefa:', taskData.titulo);

      // Validar campos obrigatórios
      if (!taskData.titulo) {
        return new Response(
          JSON.stringify({ error: 'Campo titulo é obrigatório' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }

      // Se não informou column_id, buscar a coluna "Caixa de Entrada" ou primeira coluna tipo 'compartilhado'
      let columnId = taskData.column_id;
      if (!columnId) {
        const { data: columns } = await supabase
          .from('task_flow_columns')
          .select('id, nome, tipo')
          .order('ordem', { ascending: true });

        const caixaEntrada = columns?.find(c => c.nome.toLowerCase().includes('caixa de entrada'));
        const compartilhada = columns?.find(c => c.tipo === 'compartilhado');
        const primeira = columns?.[0];

        columnId = caixaEntrada?.id || compartilhada?.id || primeira?.id;
      }

      if (!columnId) {
        return new Response(
          JSON.stringify({ error: 'Nenhuma coluna disponível para criar a tarefa' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }

      // Upload do áudio para storage se existir
      let audioUrl: string | null = null;
      if (audioBase64) {
        const audioBytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
        const detected = sniffAudioFormat(audioBytes, audioMimeType);
        const fileName = `taskflow-audio-${Date.now()}.${detected.ext}`;

        console.log('[taskflow-webhook] Salvando áudio como:', fileName, 'mime:', detected.mime);

        const { error: uploadError } = await supabase.storage
          .from('task-attachments')
          .upload(fileName, audioBytes, {
            contentType: detected.mime,
            upsert: false,
          });

        if (uploadError) {
          console.error('[taskflow-webhook] Erro ao fazer upload do áudio:', uploadError);
        } else {
          const { data: urlData } = supabase.storage
            .from('task-attachments')
            .getPublicUrl(fileName);
          audioUrl = urlData.publicUrl;
          console.log('[taskflow-webhook] Áudio salvo:', audioUrl);
        }
      }

      // Buscar próxima ordem
      const { data: maxOrdem } = await supabase
        .from('task_flow_tasks')
        .select('ordem')
        .eq('column_id', columnId)
        .order('ordem', { ascending: false })
        .limit(1)
        .maybeSingle();

      const novaOrdem = (maxOrdem?.ordem || 0) + 1;

      // Determinar origem baseado no campo automation
      const origem = taskData.automation === 'true' || taskData.automation === true ? 'api' : (taskData.origem || 'webhook');

      // Resolver responsavel_id - pode vir como UUID ou como nome
      let responsavelId: string | null = null;
      if (taskData.responsavel_id) {
        // Verificar se é um UUID válido (formato: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        
        if (uuidRegex.test(taskData.responsavel_id)) {
          // Já é um UUID, usar diretamente
          responsavelId = taskData.responsavel_id;
          console.log('[taskflow-webhook] responsavel_id já é UUID:', responsavelId);
        } else {
          // É um nome, buscar o UUID na tabela task_flow_profiles
          console.log('[taskflow-webhook] Buscando responsável pelo nome:', taskData.responsavel_id);
          
          const { data: profile, error: profileError } = await supabase
            .from('task_flow_profiles')
            .select('id, nome')
            .ilike('nome', taskData.responsavel_id)
            .eq('ativo', true)
            .limit(1)
            .maybeSingle();
          
          if (profileError) {
            console.error('[taskflow-webhook] Erro ao buscar perfil:', profileError);
          } else if (profile) {
            responsavelId = profile.id;
            console.log('[taskflow-webhook] Responsável encontrado:', profile.nome, '-> ID:', responsavelId);
          } else {
            console.warn('[taskflow-webhook] Responsável não encontrado pelo nome:', taskData.responsavel_id);
          }
        }
      }

      // Criar a tarefa
      const { data: novaTarefa, error: insertError } = await supabase
        .from('task_flow_tasks')
        .insert({
          titulo: taskData.titulo,
          descricao: taskData.descricao || null,
          column_id: columnId,
          responsavel_id: responsavelId,
          origem: origem,
          prazo: taskData.prazo || null,
          audio_url: audioUrl,
          ordem: novaOrdem,
        })
        .select()
        .single();

      if (insertError) {
        console.error('[taskflow-webhook] Erro ao criar tarefa:', insertError);
        return new Response(
          JSON.stringify({ error: insertError.message }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }

      console.log('[taskflow-webhook] Tarefa criada:', novaTarefa.id);

      // Registrar no histórico
      await supabase.from('task_flow_history').insert({
        task_id: novaTarefa.id,
        tipo: 'criacao',
        descricao: 'Tarefa criada via webhook',
      });

      // Buscar webhook de IA para enviar o áudio para transcrição
      const { data: config } = await supabase
        .from('config_global')
        .select('webhook_ia_disparos')
        .limit(1)
        .maybeSingle();

      const webhookUrl = config?.webhook_ia_disparos;

      // Se tem áudio e webhook configurado, enviar para transcrição
      if (audioBase64 && webhookUrl) {
        console.log('[taskflow-webhook] Enviando áudio para transcrição:', webhookUrl);

        try {
          const webhookPayload = {
            task_id: novaTarefa.id,
            titulo: novaTarefa.titulo,
            audio_base64: audioBase64,
            audio_url: audioUrl,
            callback_url: `${supabaseUrl}/functions/v1/taskflow-webhook`,
          };

          // Enviar de forma assíncrona (não esperar resposta)
          fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(webhookPayload),
          }).catch(err => console.error('[taskflow-webhook] Erro ao chamar webhook IA:', err));

        } catch (webhookError) {
          console.error('[taskflow-webhook] Erro ao enviar para webhook IA:', webhookError);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          task: novaTarefa,
          message: audioBase64 && webhookUrl ? 'Tarefa criada e áudio enviado para transcrição' : 'Tarefa criada com sucesso'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 201 }
      );
    }

    // PATCH - Atualizar tarefa (ex: com transcrição do áudio)
    if (req.method === 'PATCH') {
      const body = await req.json();
      const { task_id, audio_base64, audio_url: audioUrlParam, raw_payload, ...updateData } = body;

      console.log('[taskflow-webhook] PATCH - Atualizando tarefa:', task_id);

      if (!task_id) {
        return new Response(
          JSON.stringify({ error: 'Campo task_id é obrigatório' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }

      // Processar áudio se fornecido
      let processedAudioBase64: string | null = audio_base64 || null;
      let audioUrlFromPayload: string | null = audioUrlParam || null;
      let patchAudioMimeType: string | null = body.audio_mime_type || body.audio_mimetype || null;

      // Se veio raw_payload, verificar se é URL ou JSON
      if (raw_payload && typeof raw_payload === 'string') {
        // Se parece com URL (começa com http), usar como audio_url
        if (raw_payload.startsWith('http')) {
          audioUrlFromPayload = audioUrlFromPayload || raw_payload;
          console.log('[taskflow-webhook] PATCH - raw_payload é URL de áudio');
        } else {
          // Tentar parsear como JSON para extrair áudio
          try {
            const parsedPayload = JSON.parse(raw_payload);
            const audioMessage =
              parsedPayload?.data?.message?.audioMessage ||
              parsedPayload?.data?.message?.pttMessage;
            if (audioMessage) {
              audioUrlFromPayload = audioUrlFromPayload || audioMessage.url;
              processedAudioBase64 = processedAudioBase64 || audioMessage.base64;
              patchAudioMimeType = patchAudioMimeType || audioMessage.mimetype || audioMessage.mimeType || null;
              console.log(
                '[taskflow-webhook] PATCH - Extraído do raw_payload JSON - URL:',
                !!audioUrlFromPayload,
                'Base64:',
                !!processedAudioBase64,
                'Mime:',
                patchAudioMimeType
              );
            }
          } catch (_e) {
            console.log('[taskflow-webhook] PATCH - raw_payload não é JSON válido nem URL');
          }
        }
      }

      // Se não veio base64, tentar buscar via Evolution (mesmo tratamento usado para mídia no SDRZap)
      if (!processedAudioBase64) {
        const serverUrl: string | null = body.server_url || body.serverUrl || null;
        const instanceName: string | null = body.instance_name || body.instanceName || body.instance || null;

        let waMessageId: string | null =
          body.wa_message_id ||
          body.waMessageId ||
          body.message_id ||
          body.messageId ||
          null;

        if (!waMessageId && raw_payload) {
          try {
            const parsed = typeof raw_payload === 'string' ? JSON.parse(raw_payload) : raw_payload;
            const d = parsed?.data || parsed;
            waMessageId = d?.key?.id || d?.id || d?.message?.key?.id || d?.data?.key?.id || null;
          } catch (_e) {
            // ignore
          }
        }

        if (serverUrl && instanceName && waMessageId) {
          const evo = await fetchAudioBase64FromEvolution(serverUrl, instanceName, waMessageId);
          if (evo.base64) {
            processedAudioBase64 = evo.base64;
            patchAudioMimeType = evo.mimeType || patchAudioMimeType || 'audio/ogg';
          }
        }
      }

      // Fallback: baixar direto da URL (atenção: URL do WhatsApp CDN pode vir criptografada)
      if (audioUrlFromPayload && !processedAudioBase64) {
        console.log('[taskflow-webhook] PATCH - Baixando áudio da URL:', audioUrlFromPayload.substring(0, 50) + '...');
        try {
          const audioResponse = await fetch(audioUrlFromPayload);
          if (audioResponse.ok) {
            const ct = audioResponse.headers.get('content-type');
            patchAudioMimeType = (ct ? ct.split(';')[0].trim() : patchAudioMimeType);
            console.log('[taskflow-webhook] PATCH - Content-Type detectado:', patchAudioMimeType);

            const audioArrayBuffer = await audioResponse.arrayBuffer();
            processedAudioBase64 = btoa(String.fromCharCode(...new Uint8Array(audioArrayBuffer)));
            console.log('[taskflow-webhook] PATCH - Áudio baixado com sucesso, tamanho base64:', processedAudioBase64.length);
          } else {
            console.error('[taskflow-webhook] PATCH - Erro ao baixar áudio:', audioResponse.status);
          }
        } catch (downloadError) {
          console.error('[taskflow-webhook] PATCH - Erro ao baixar áudio:', downloadError);
        }
      }

      // Upload do áudio para storage se existir
      let newAudioUrl: string | null = null;
      if (processedAudioBase64) {
        const audioBytes = Uint8Array.from(atob(processedAudioBase64), c => c.charCodeAt(0));
        const detected = sniffAudioFormat(audioBytes, patchAudioMimeType);
        const fileName = `taskflow-audio-${task_id}-${Date.now()}.${detected.ext}`;

        console.log('[taskflow-webhook] PATCH - Salvando áudio como:', fileName, 'mime:', detected.mime);

        const { error: uploadError } = await supabase.storage
          .from('task-attachments')
          .upload(fileName, audioBytes, {
            contentType: detected.mime,
            upsert: false,
          });

        if (uploadError) {
          console.error('[taskflow-webhook] PATCH - Erro ao fazer upload do áudio:', uploadError);
        } else {
          const { data: urlData } = supabase.storage
            .from('task-attachments')
            .getPublicUrl(fileName);
          newAudioUrl = urlData.publicUrl;
          console.log('[taskflow-webhook] PATCH - Áudio salvo:', newAudioUrl);
        }
      }

      // Campos permitidos para atualização
      const allowedFields = ['titulo', 'descricao', 'resumo', 'prazo', 'responsavel_id', 'column_id', 'data_retorno'];
      const filteredUpdate: Record<string, any> = {};
      
      for (const field of allowedFields) {
        if (updateData[field] !== undefined) {
          filteredUpdate[field] = updateData[field];
        }
      }

      // Adicionar audio_url se foi processado
      if (newAudioUrl) {
        filteredUpdate.audio_url = newAudioUrl;
      }

      if (Object.keys(filteredUpdate).length === 0) {
        return new Response(
          JSON.stringify({ error: 'Nenhum campo válido para atualizar' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }

      filteredUpdate.updated_at = new Date().toISOString();

      const { data: tarefaAtualizada, error: updateError } = await supabase
        .from('task_flow_tasks')
        .update(filteredUpdate)
        .eq('id', task_id)
        .select()
        .single();

      if (updateError) {
        console.error('[taskflow-webhook] Erro ao atualizar tarefa:', updateError);
        return new Response(
          JSON.stringify({ error: updateError.message }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }

      // Registrar no histórico
      const camposAtualizados = Object.keys(filteredUpdate).filter(k => k !== 'updated_at').join(', ');
      await supabase.from('task_flow_history').insert({
        task_id: task_id,
        tipo: 'atualizacao',
        descricao: `Tarefa atualizada via webhook: ${camposAtualizados}`,
      });

      // Se tem áudio, enviar para transcrição
      if (processedAudioBase64) {
        const { data: config } = await supabase
          .from('config_global')
          .select('webhook_ia_disparos')
          .limit(1)
          .maybeSingle();

        const webhookUrl = config?.webhook_ia_disparos;

        if (webhookUrl) {
          console.log('[taskflow-webhook] PATCH - Enviando áudio para transcrição:', webhookUrl);
          
          try {
            const webhookPayload = {
              task_id: task_id,
              titulo: tarefaAtualizada.titulo,
              audio_base64: processedAudioBase64,
              audio_url: newAudioUrl,
              callback_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/taskflow-webhook`,
            };

            fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(webhookPayload),
            }).catch(err => console.error('[taskflow-webhook] PATCH - Erro ao chamar webhook IA:', err));
            
          } catch (webhookError) {
            console.error('[taskflow-webhook] PATCH - Erro ao enviar para webhook IA:', webhookError);
          }
        }
      }

      console.log('[taskflow-webhook] Tarefa atualizada:', task_id);

      return new Response(
        JSON.stringify({ success: true, task: tarefaAtualizada }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Método não suportado. Use POST ou PATCH.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 405 }
    );

  } catch (error) {
    console.error('[taskflow-webhook] Erro:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
