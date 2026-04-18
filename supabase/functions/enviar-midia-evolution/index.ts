import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    const conversa_id = formData.get('conversa_id') as string;
    const instancia_whatsapp_id = formData.get('instancia_whatsapp_id') as string | null;
    const user_id = formData.get('user_id') as string;
    const media_type = formData.get('media_type') as string; // 'image' | 'video' | 'document' | 'audio'
    const file = formData.get('file') as File;
    const caption = formData.get('caption') as string | null;

    if (!conversa_id || !user_id || !file || !media_type) {
      return new Response(
        JSON.stringify({ success: false, code: "MISSING_FIELDS", message: "Campos obrigatórios faltando" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[ENVIO_MIDIA] Tipo: ${media_type}, Arquivo: ${file.name}, Tamanho: ${file.size}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Buscar conversa com contact_id
    const { data: conversa, error: conversaError } = await supabase
      .from('conversas')
      .select('id, numero_contato, current_instance_id, contact_id')
      .eq('id', conversa_id)
      .single();
    
    if (conversaError || !conversa) {
      return new Response(
        JSON.stringify({ success: false, code: "CONVERSA_NAO_ENCONTRADA", message: "Conversa não encontrada" }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let numero_contato = conversa.numero_contato;
    if (numero_contato.includes('@')) {
      numero_contato = numero_contato.split('@')[0];
    }

    const instance_fk = instancia_whatsapp_id || conversa.current_instance_id;
    if (!instance_fk) {
      return new Response(
        JSON.stringify({ success: false, code: "SEM_INSTANCIA", message: "Nenhuma instância especificada" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Buscar instância
    const { data: instancia, error: instanciaError } = await supabase
      .from('instancias_whatsapp')
      .select('id, instancia_id, nome_instancia, ativo, status')
      .eq('id', instance_fk)
      .single();
    
    if (instanciaError || !instancia) {
      return new Response(
        JSON.stringify({ success: false, code: "INSTANCIA_NAO_ENCONTRADA", message: "Instância não encontrada" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (instancia.status === 'deletada') {
      return new Response(
        JSON.stringify({ success: false, code: "INSTANCIA_DELETADA", message: "Instância deletada" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Buscar config
    const { data: config } = await supabase
      .from('config_global')
      .select('evolution_base_url, evolution_api_key')
      .single();
    
    if (!config) {
      return new Response(
        JSON.stringify({ success: false, code: "CONFIG_ERROR", message: "Configuração não encontrada" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const evolutionApiKey = config.evolution_api_key || Deno.env.get('EVOLUTION_API_KEY');
    const evolutionBaseUrl = config.evolution_base_url;

    // 4. Converter arquivo para base64 (usando chunks para evitar stack overflow)
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const chunkSize = 8192;
    let binaryString = '';
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
      binaryString += String.fromCharCode.apply(null, Array.from(chunk));
    }
    const base64 = btoa(binaryString);
    const mimeType = file.type || 'application/octet-stream';

    // 5. Determinar endpoint e payload baseado no tipo
    let sendUrl: string;
    let payload: any;

    switch (media_type) {
      case 'image':
        sendUrl = `${evolutionBaseUrl}/message/sendMedia/${encodeURIComponent(instancia.nome_instancia)}`;
        payload = {
          number: numero_contato,
          mediatype: 'image',
          mimetype: mimeType,
          caption: caption || '',
          media: base64,
          fileName: file.name
        };
        break;

      case 'video':
        sendUrl = `${evolutionBaseUrl}/message/sendMedia/${encodeURIComponent(instancia.nome_instancia)}`;
        payload = {
          number: numero_contato,
          mediatype: 'video',
          mimetype: mimeType,
          caption: caption || '',
          media: base64,
          fileName: file.name
        };
        break;

      case 'audio':
        sendUrl = `${evolutionBaseUrl}/message/sendWhatsAppAudio/${encodeURIComponent(instancia.nome_instancia)}`;
        payload = {
          number: numero_contato,
          audio: base64
        };
        break;

      case 'document':
      default:
        sendUrl = `${evolutionBaseUrl}/message/sendMedia/${encodeURIComponent(instancia.nome_instancia)}`;
        payload = {
          number: numero_contato,
          mediatype: 'document',
          mimetype: mimeType,
          caption: caption || '',
          media: base64,
          fileName: file.name
        };
        break;
    }

    console.log(`[ENVIO_MIDIA] Enviando para: ${sendUrl}`);

    // 6. Enviar para Evolution API
    const response = await fetch(sendUrl, {
      method: 'POST',
      headers: {
        'apikey': evolutionApiKey!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    const responseBody = await response.text();
    console.log(`[ENVIO_MIDIA] Response Status: ${response.status}`);
    console.log(`[ENVIO_MIDIA] Response: ${responseBody.substring(0, 500)}`);

    let responseData;
    try {
      responseData = JSON.parse(responseBody);
    } catch (e) {
      console.warn('[ENVIO_MIDIA] Resposta não é JSON');
    }

    if (!response.ok) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          code: "EVOLUTION_SEND_ERROR",
          message: `Erro ao enviar mídia: ${response.statusText}`,
          details: responseBody
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 7. Upload do arquivo para o storage para ter URL de reprodução
    const timestamp = Date.now();
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `sent/${conversa.contact_id}/${timestamp}_${sanitizedFileName}`;
    
    const { data: uploadData, error: uploadError } = await supabase
      .storage
      .from('message-media')
      .upload(storagePath, file, {
        contentType: mimeType,
        upsert: false
      });

    let mediaUrl: string | null = null;
    if (!uploadError && uploadData) {
      const { data: publicUrlData } = supabase
        .storage
        .from('message-media')
        .getPublicUrl(storagePath);
      mediaUrl = publicUrlData?.publicUrl || null;
      console.log('[ENVIO_MIDIA] Arquivo salvo no storage:', mediaUrl);
    } else {
      console.warn('[ENVIO_MIDIA] Erro ao salvar no storage:', uploadError);
    }

    // 8. NÃO registrar na tabela messages aqui
    // O webhook da Evolution API (send.message) já irá inserir a mensagem quando o envio for confirmado
    // Isso evita duplicação de mensagens na UI
    const waMessageId = responseData?.key?.id || responseData?.message?.key?.id;
    const mediaDescription = media_type === 'audio' ? '🎤 Áudio' : 
                             media_type === 'image' ? `📷 ${file.name}` :
                             media_type === 'video' ? `🎬 ${file.name}` :
                             `📎 ${file.name}`;
    console.log('[ENVIO_MIDIA] wa_message_id recebido:', waMessageId);

    // 9. Também registrar na tabela mensagens (para compatibilidade)
    await supabase
      .from('mensagens')
      .insert({
        conversa_id: conversa_id,
        conteudo: caption || mediaDescription,
        remetente: 'enviada',
        tipo_mensagem: media_type,
        enviado_por: user_id,
        wa_message_id: waMessageId,
        status: 'PENDING'
      });

    // 10. Atualizar conversa
    await supabase
      .from('conversas')
      .update({
        ultima_mensagem: mediaDescription,
        ultima_interacao: new Date().toISOString(),
        ...(instancia_whatsapp_id && { current_instance_id: instancia_whatsapp_id })
      })
      .eq('id', conversa_id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Mídia enviada com sucesso", 
        mediaUrl,
        waMessageId
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[ENVIO_MIDIA] Erro:', error);
    return new Response(
      JSON.stringify({ success: false, code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
