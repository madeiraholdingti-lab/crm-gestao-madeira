import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to determine JID type
function getTipoJid(jid: string): string {
  if (!jid) return 'desconhecido';
  if (jid.includes('@lid')) return 'lid';
  if (jid.includes('@g.us')) return 'grupo';
  if (jid.includes('@s.whatsapp.net')) return 'pessoa';
  if (jid.includes('@c.us')) return 'pessoa';
  return 'outro';
}

// Helper function to get MIME type from message type
function getMimeType(messageType: string, base64Data?: string): string {
  const mimeMap: Record<string, string> = {
    'image': 'image/jpeg',
    'imageMessage': 'image/jpeg',
    'video': 'video/mp4',
    'videoMessage': 'video/mp4',
    'audio': 'audio/ogg',
    'audioMessage': 'audio/ogg',
    'document': 'application/octet-stream',
    'documentMessage': 'application/octet-stream',
    'documentWithCaptionMessage': 'application/octet-stream',
    'sticker': 'image/webp',
    'stickerMessage': 'image/webp',
    'contact': 'text/vcard',
    'contactMessage': 'text/vcard',
    'contactsArrayMessage': 'text/vcard',
  };
  
  // Try to detect from base64 header if available
  if (base64Data) {
    if (base64Data.startsWith('/9j/')) return 'image/jpeg';
    if (base64Data.startsWith('iVBORw')) return 'image/png';
    if (base64Data.startsWith('R0lGOD')) return 'image/gif';
    if (base64Data.startsWith('UklGR')) return 'image/webp';
    if (base64Data.startsWith('AAAA')) return 'video/mp4';
    if (base64Data.startsWith('T2dnUw')) return 'audio/ogg';
  }
  
  return mimeMap[messageType] || 'application/octet-stream';
}

// Helper function to extract contact info from contactMessage
function extractContactInfo(rawPayload: any): { displayName: string; phones: string[] } | null {
  try {
    const parsed = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
    const message = parsed?.data?.message;
    
    // Single contact
    if (message?.contactMessage) {
      const contact = message.contactMessage;
      const displayName = contact.displayName || 'Contato';
      const phones: string[] = [];
      
      // Extract phone from vCard
      if (contact.vcard) {
        const telMatch = contact.vcard.match(/TEL[^:]*:([+\d\s-]+)/gi);
        if (telMatch) {
          telMatch.forEach((match: string) => {
            const phone = match.replace(/TEL[^:]*:/i, '').replace(/\D/g, '');
            if (phone) phones.push(phone);
          });
        }
      }
      
      return { displayName, phones };
    }
    
    // Multiple contacts (contactsArrayMessage)
    if (message?.contactsArrayMessage) {
      const contacts = message.contactsArrayMessage.contacts || [];
      const names: string[] = [];
      const phones: string[] = [];
      
      contacts.forEach((c: any) => {
        if (c.displayName) names.push(c.displayName);
        if (c.vcard) {
          const telMatch = c.vcard.match(/TEL[^:]*:([+\d\s-]+)/gi);
          if (telMatch) {
            telMatch.forEach((match: string) => {
              const phone = match.replace(/TEL[^:]*:/i, '').replace(/\D/g, '');
              if (phone) phones.push(phone);
            });
          }
        }
      });
      
      return { 
        displayName: names.length > 0 ? names.join(', ') : `${contacts.length} contato(s)`,
        phones 
      };
    }
    
    return null;
  } catch (e) {
    console.warn('⚠️ Erro ao extrair info de contato:', e);
    return null;
  }
}

// Helper function to get file extension from MIME type
function getExtension(mimeType: string): string {
  // Remove codec info (e.g., "audio/ogg; codecs=opus" -> "audio/ogg")
  const baseMimeType = mimeType.split(';')[0].trim();
  
  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/opus': 'ogg',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  };
  return extMap[baseMimeType] || 'bin';
}

// Helper function to fetch media from Evolution API and upload to Storage
async function fetchAndUploadMedia(
  supabase: any,
  serverUrl: string,
  instanceName: string, // Evolution API uses instance NAME, not UUID
  waMessageId: string,
  messageType: string
): Promise<{ mediaUrl: string | null; mimeType: string | null }> {
  const evolutionApiKey = Deno.env.get('EVOLUTION_API_KEY');
  
  if (!evolutionApiKey || !serverUrl || !waMessageId || !instanceName) {
    console.warn('⚠️ Dados insuficientes para buscar mídia:', { serverUrl: !!serverUrl, waMessageId: !!waMessageId, hasApiKey: !!evolutionApiKey, instanceName: !!instanceName });
    return { mediaUrl: null, mimeType: null };
  }

  try {
    console.log('🖼️ Buscando mídia da Evolution API...');
    // Evolution API v2 uses instance NAME in the URL, not UUID
    const mediaEndpoint = `${serverUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`;
    console.log('📍 URL:', mediaEndpoint);
    
    const mediaResponse = await fetch(mediaEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': evolutionApiKey,
      },
      body: JSON.stringify({
        message: {
          key: { id: waMessageId },
          convertToMp4: false,
        },
      }),
    });

    if (!mediaResponse.ok) {
      console.error('❌ Erro ao buscar mídia da Evolution:', mediaResponse.status, await mediaResponse.text());
      return { mediaUrl: null, mimeType: null };
    }

    const mediaData = await mediaResponse.json();
    console.log('📦 Resposta da Evolution (base64 truncado):', {
      hasBase64: !!mediaData?.base64,
      mimetype: mediaData?.mimetype,
      base64Length: mediaData?.base64?.length,
    });

    if (!mediaData?.base64) {
      console.warn('⚠️ Nenhum base64 retornado pela Evolution API');
      return { mediaUrl: null, mimeType: null };
    }

    // Detect MIME type
    const mimeType = mediaData.mimetype || getMimeType(messageType, mediaData.base64);
    const extension = getExtension(mimeType);
    
    // Generate unique filename using instance name (sanitized)
    const timestamp = Date.now();
    const sanitizedInstanceName = instanceName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const filePath = `${sanitizedInstanceName}/${timestamp}_${waMessageId}.${extension}`;
    
    // Decode base64 and upload to Storage
    console.log('📤 Fazendo upload para Storage:', filePath);
    const binaryData = base64Decode(mediaData.base64);
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('message-media')
      .upload(filePath, binaryData, {
        contentType: mimeType,
        upsert: true,
      });

    if (uploadError) {
      console.error('❌ Erro ao fazer upload para Storage:', uploadError);
      return { mediaUrl: null, mimeType: null };
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('message-media')
      .getPublicUrl(filePath);

    console.log('✅ Mídia salva com sucesso:', { publicUrl, mimeType });
    
    return { mediaUrl: publicUrl, mimeType };
  } catch (error) {
    console.error('❌ Erro ao processar mídia:', error);
    return { mediaUrl: null, mimeType: null };
  }
}

console.log("🚀 n8n-inbound-webhook function started");

// CORREÇÃO 2: Cache de config_global com TTL de 5 minutos
// Evita SELECT no banco a cada chamada de webhook
const configCache: { data: any; fetchedAt: number } = { data: null, fetchedAt: 0 };
async function getCachedConfig(supabase: any) {
  if (configCache.data && Date.now() - configCache.fetchedAt < 300_000) {
    return configCache.data;
  }
  const { data, error } = await supabase.from('config_global').select('*').single();
  if (error) {
    console.error('⚠️ Erro ao buscar config_global:', error);
    return configCache.data; // retorna cache antigo se falhar
  }
  configCache.data = data;
  configCache.fetchedAt = Date.now();
  return data;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse incoming payload
    const payload = await req.json();
    console.log('📦 Payload recebido do N8N:', JSON.stringify(payload, null, 2));

    // ========================================
    // STEP 0: FILTER EVENT TYPE
    // ========================================
    const { event } = payload;
    
    // Handle message status updates (messages.update)
    if (event === 'messages.update') {
      console.log('🔄 Processando messages.update:', JSON.stringify(payload, null, 2));

      const wa_message_id = payload.wa_message_id;
      const message_status = payload.message_status;

      if (!wa_message_id || !message_status) {
        console.warn('⚠️ messages.update sem wa_message_id ou message_status, ignorando');
        return new Response(
          JSON.stringify({ 
            success: false,
            code: 'IGNORED_EVENT_MISSING_FIELDS',
            message: 'messages.update sem wa_message_id ou message_status',
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Atualizar status e flag de leitura na tabela mensagens
      const { data: msg, error: msgError } = await supabase
        .from('mensagens')
        .update({ 
          status: message_status,
          lida: message_status === 'READ'
        })
        .eq('wa_message_id', wa_message_id)
        .select('id, conversa_id')
        .maybeSingle();

      if (msgError) {
        console.error('❌ Erro ao atualizar mensagem em messages.update:', msgError);
      }

      if (msg && msg.conversa_id) {
        // Recalcular unread_count da conversa: mensagens recebidas não lidas
        const { count, error: countError } = await supabase
          .from('mensagens')
          .select('id', { count: 'exact', head: true })
          .eq('conversa_id', msg.conversa_id)
          .eq('remetente', 'recebida')
          .neq('status', 'READ');

        if (countError) {
          console.error('❌ Erro ao contar mensagens não lidas:', countError);
        } else {
          await supabase
            .from('conversas')
            .update({ unread_count: count ?? 0 })
            .eq('id', msg.conversa_id);
        }
      }

      return new Response(
        JSON.stringify({ success: true, code: 'MESSAGE_STATUS_UPDATED' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle reaction messages
    if (event === 'messages.upsert') {
      // Check if this is a reaction message
      const parsedPayload = typeof payload.raw_payload === 'string' 
        ? JSON.parse(payload.raw_payload) 
        : payload.raw_payload;
      
      const reactionMessage = parsedPayload?.data?.message?.reactionMessage;
      
      if (reactionMessage) {
        console.log('😊 Processando reação:', JSON.stringify(reactionMessage, null, 2));
        
        const targetMessageId = reactionMessage.key?.id;
        const emoji = reactionMessage.text || '';
        const fromMe = payload.from_me || false;
        
        if (!targetMessageId) {
          console.warn('⚠️ Reação sem ID da mensagem alvo');
          return new Response(
            JSON.stringify({ success: false, code: 'REACTION_NO_TARGET' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Find the contact for this reaction
        const contactPhone = payload.contact_phone;
        let contactId = null;
        
        if (contactPhone) {
          const { data: contact } = await supabase
            .from('contacts')
            .select('id')
            .eq('phone', contactPhone)
            .maybeSingle();
          contactId = contact?.id;
        }

        if (emoji === '') {
          // Remove reaction
          const { error: deleteError } = await supabase
            .from('message_reactions')
            .delete()
            .eq('message_wa_id', targetMessageId)
            .eq('from_me', fromMe);
          
          if (deleteError) {
            console.error('❌ Erro ao remover reação:', deleteError);
          } else {
            console.log('✅ Reação removida com sucesso');
          }
        } else {
          // Upsert reaction (update if exists, insert if not)
          const { error: upsertError } = await supabase
            .from('message_reactions')
            .upsert({
              message_wa_id: targetMessageId,
              contact_id: contactId,
              emoji: emoji,
              from_me: fromMe,
              reacted_at: new Date().toISOString()
            }, {
              onConflict: 'message_wa_id,from_me',
              ignoreDuplicates: false
            });
          
          if (upsertError) {
            // If upsert fails due to no unique constraint, try insert directly
            const { error: insertError } = await supabase
              .from('message_reactions')
              .insert({
                message_wa_id: targetMessageId,
                contact_id: contactId,
                emoji: emoji,
                from_me: fromMe,
                reacted_at: new Date().toISOString()
              });
            
            if (insertError) {
              console.error('❌ Erro ao salvar reação:', insertError);
            } else {
              console.log('✅ Reação salva com sucesso (insert)');
            }
          } else {
            console.log('✅ Reação salva com sucesso (upsert)');
          }
        }

        return new Response(
          JSON.stringify({ success: true, code: 'REACTION_PROCESSED', emoji, targetMessageId }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }
    
    // Só processamos abaixo messages.upsert
    if (event !== 'messages.upsert') {
      console.log('⚠️ Evento ignorado (não é messages.upsert):', event);
      return new Response(
        JSON.stringify({ 
          success: false,
          code: 'IGNORED_EVENT',
          message: 'Evento não suportado pela edge function',
          event: event || 'unknown'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========================================
    // STEP 1: EXTRACT AND VALIDATE PAYLOAD
    // ========================================
    const {
      contact_jid,
      contact_phone,
      contact_name,
      instance_name,
      instance_uuid,
      wa_message_id,
      from_me,
      message_text,
      message_type,
      message_status,
      sender_jid,
      sender_lid,
      source,
      server_url,
      raw_payload
    } = payload;

    // Extract correct instanceId from raw_payload (N8N sends wrong instance_uuid)
    let correctInstanceId = instance_uuid;
    if (raw_payload) {
      try {
        const parsedPayload = typeof raw_payload === 'string' ? JSON.parse(raw_payload) : raw_payload;
        if (parsedPayload?.data?.instanceId) {
          correctInstanceId = parsedPayload.data.instanceId;
          console.log('✅ UUID correto da instância extraído do raw_payload:', correctInstanceId);
        }
      } catch (e) {
        console.warn('⚠️ Não foi possível parsear raw_payload, usando instance_uuid padrão');
      }
    }

    // Validate required fields - message_text only required for text messages
    const requiredAlways = ['contact_jid', 'contact_phone', 'instance_uuid', 'wa_message_id'];
    const missingFields: string[] = [];
    
    if (!contact_jid) missingFields.push('contact_jid');
    if (!contact_phone) missingFields.push('contact_phone');
    if (!correctInstanceId) missingFields.push('instance_uuid');
    if (!wa_message_id) missingFields.push('wa_message_id');
    
    // message_text só é obrigatório para mensagens de texto
    const isTextMessage = !message_type || message_type === 'text' || message_type === 'conversation';
    if (isTextMessage && !message_text) {
      missingFields.push('message_text');
    }
    
    if (missingFields.length > 0) {
      console.error('❌ Campos obrigatórios faltando:', {
        missing: missingFields,
        message_type: message_type,
        contact_jid: !!contact_jid,
        contact_phone: !!contact_phone,
        correctInstanceId: !!correctInstanceId,
        message_text: !!message_text,
        wa_message_id: !!wa_message_id
      });
      return new Response(
        JSON.stringify({ 
          error: 'Campos obrigatórios faltando',
          required: requiredAlways,
          missing: missingFields,
          message_type: message_type,
          note: 'message_text só é obrigatório para mensagens de texto'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Para mensagens de mídia/contato, tentar extrair caption do raw_payload
    let effectiveMessageText = message_text;
    
    // Lista de placeholders que indicam que devemos buscar o texto real do raw_payload
    const isPlaceholder = !effectiveMessageText || 
                          effectiveMessageText.startsWith('=') || 
                          effectiveMessageText.startsWith('[mensagem de') ||
                          effectiveMessageText.startsWith('🖼️ [') ||
                          effectiveMessageText.startsWith('🎬 [') ||
                          effectiveMessageText.startsWith('📄 [') ||
                          effectiveMessageText.startsWith('🎵 [');
    
    console.log('🔍 Caption extraction check:', {
      isPlaceholder,
      hasRawPayload: !!raw_payload,
      message_text: message_text?.substring(0, 50),
      message_type
    });
    
    // Tentar extrair texto real de mensagens se não houver texto válido
    if (isPlaceholder && raw_payload) {
      try {
        const parsedPayload = typeof raw_payload === 'string' ? JSON.parse(raw_payload) : raw_payload;
        const message = parsedPayload?.data?.message;
        
        console.log('📦 Parsed message keys:', message ? Object.keys(message) : 'null');
        
        // Extrair texto de diferentes tipos de mensagem (ordem de prioridade)
        // 1. Mensagem de texto simples (conversation)
        // 2. Texto estendido (extendedTextMessage)
        // 3. Captions de mídia
        const extractedText = message?.conversation ||
                              message?.extendedTextMessage?.text ||
                              message?.imageMessage?.caption ||
                              message?.videoMessage?.caption ||
                              message?.documentMessage?.caption ||
                              message?.documentWithCaptionMessage?.message?.documentMessage?.caption;
        
        console.log('🏷️ Extracted text:', extractedText?.substring(0, 100) || 'null');
        
        if (extractedText) {
          effectiveMessageText = extractedText;
          console.log('✅ Texto extraído do raw_payload:', extractedText.substring(0, 100));
        }
      } catch (e) {
        console.warn('⚠️ Erro ao extrair texto do raw_payload:', e);
      }
    }
    
    // Tratamento especial para mensagens de contato
    if ((!effectiveMessageText || effectiveMessageText.startsWith('=') || effectiveMessageText.startsWith('[')) && 
        (message_type === 'contact' || message_type === 'contactMessage' || message_type === 'contactsArrayMessage')) {
      const contactInfo = extractContactInfo(raw_payload);
      if (contactInfo) {
        const phonesStr = contactInfo.phones.length > 0 ? ` (${contactInfo.phones.join(', ')})` : '';
        effectiveMessageText = `📇 Contato: ${contactInfo.displayName}${phonesStr}`;
      } else {
        effectiveMessageText = '📇 [contato compartilhado]';
      }
    } else if (!effectiveMessageText || effectiveMessageText.startsWith('=') || effectiveMessageText.startsWith('[mensagem de')) {
      // Fallback para outros tipos de mensagem (quando não tem caption)
      const typeLabels: Record<string, string> = {
        'audio': '🎵 [mensagem de áudio]',
        'audioMessage': '🎵 [mensagem de áudio]',
        'image': '🖼️ [imagem]',
        'imageMessage': '🖼️ [imagem]',
        'video': '🎬 [vídeo]',
        'videoMessage': '🎬 [vídeo]',
        'document': '📄 [documento]',
        'documentMessage': '📄 [documento]',
        'documentWithCaptionMessage': '📄 [documento]',
        'sticker': '🎨 [figurinha]',
        'stickerMessage': '🎨 [figurinha]',
        'location': '📍 [localização]',
        'locationMessage': '📍 [localização]',
        'liveLocationMessage': '📍 [localização ao vivo]',
        'pollCreationMessage': '📊 [enquete]',
        'pollUpdateMessage': '📊 [atualização de enquete]',
      };
      effectiveMessageText = typeLabels[message_type] || `[mensagem de ${message_type || 'mídia'}]`;
    }

    // ========================================
    // STEP 1.5: CHECK INTERNAL NUMBERS & CONFIGURATION
    // ========================================
    console.log('🔍 Verificando se é número interno...');
    
    // CORREÇÃO 2: Usar cache de config_global (TTL 5min)
    const config = await getCachedConfig(supabase);
    const ignorarMensagensInternas = config?.ignorar_mensagens_internas ?? true;

    // Fetch all active instances with full information for bidirectional logic
    const { data: instanciasAtivas, error: internalError } = await supabase
      .from('instancias_whatsapp')
      .select('id, instancia_id, nome_instancia, numero_chip')
      .eq('ativo', true);

    if (internalError) {
      console.error('⚠️ Erro ao buscar instâncias internas:', internalError);
    }

    console.log('📋 Instâncias ativas:', instanciasAtivas?.map(i => ({ 
      id: i.id, 
      nome: i.nome_instancia, 
      numero: i.numero_chip 
    })));

    // Extract remoteJid and remoteJidAlt from raw_payload for better internal detection
    let remoteJid = null;
    let remoteJidAlt = null;
    let participant = null;
    if (raw_payload) {
      try {
        const parsedPayload = typeof raw_payload === 'string' ? JSON.parse(raw_payload) : raw_payload;
        if (parsedPayload?.data?.key?.remoteJid) {
          remoteJid = parsedPayload.data.key.remoteJid;
          console.log('📞 remoteJid extraído:', remoteJid);
        }
        if (parsedPayload?.data?.key?.remoteJidAlt) {
          remoteJidAlt = parsedPayload.data.key.remoteJidAlt;
          console.log('📞 remoteJidAlt extraído:', remoteJidAlt);
        }
        // Tratamento seguro para participant/participants (pode ser string ou array)
        let participantRaw = parsedPayload?.data?.key?.participant || parsedPayload?.data?.key?.participants;
        if (participantRaw) {
          participant = typeof participantRaw === 'string' 
            ? participantRaw 
            : Array.isArray(participantRaw) 
              ? participantRaw.join(',') 
              : String(participantRaw || '');
          console.log('👥 participant extraído:', participant);
        }
      } catch (e) {
        console.warn('⚠️ Não foi possível extrair remoteJid/remoteJidAlt/participant do raw_payload');
      }
    }

    // Check if this is an internal message by comparing numbers
    let isInternalNumber = false;
    let numeroInstanciaDestino = null;
    let instanciaDestinataria = null;
    
    if (instanciasAtivas && instanciasAtivas.length > 0) {
      const internalNumbers = instanciasAtivas
        .map(inst => inst.numero_chip)
        .filter(num => num != null)
        .map(num => num.replace(/\D/g, '')); // Remove non-digits for comparison

      // Normalize all possible phone identifiers
      const normalizedContactPhone = contact_phone.replace(/\D/g, '');
      const normalizedRemoteJid = remoteJid ? remoteJid.replace(/\D/g, '').replace(/@.*$/, '') : null;
      const normalizedRemoteJidAlt = remoteJidAlt ? remoteJidAlt.replace(/\D/g, '').replace(/@.*$/, '') : null;
      
      console.log('📋 Números internos:', internalNumbers);
      console.log('📞 Números do contato:', {
        contact_phone: normalizedContactPhone,
        remoteJid: normalizedRemoteJid,
        remoteJidAlt: normalizedRemoteJidAlt
      });

      // Check if any of these numbers match an internal number
      const numbersToCheck = [normalizedContactPhone, normalizedRemoteJid, normalizedRemoteJidAlt].filter(n => n);
      
      for (const num of numbersToCheck) {
        if (internalNumbers.includes(num)) {
          isInternalNumber = true;
          numeroInstanciaDestino = num;
          instanciaDestinataria = instanciasAtivas.find(i => i.numero_chip?.replace(/\D/g, '') === num);
          console.log('⚠️ Número interno detectado:', num);
          console.log('📍 Instância destinatária identificada:', {
            id: instanciaDestinataria?.id,
            nome: instanciaDestinataria?.nome_instancia,
            numero: instanciaDestinataria?.numero_chip
          });
          break;
        }
      }
    }

    // Log para rastreamento de mensagens @lid agora processadas
    if (contact_jid.includes('@lid')) {
      console.log('✅ JID com @lid sendo processado normalmente:', {
        contact_jid,
        tipo_jid: getTipoJid(contact_jid),
        message_text: message_text?.substring(0, 50) + '...'
      });
    }

    // 🎯 PRIORIZAR NÚMERO REAL DO remoteJidAlt PARA TODAS AS MENSAGENS
    let phoneToUse = contact_phone;
    
    // Extrair número real do remoteJidAlt (prioridade) ou remoteJid
    const realNumberFromRemoteJidAlt = remoteJidAlt ? remoteJidAlt.replace(/\D/g, '').replace(/@.*$/, '') : null;
    const realNumberFromRemoteJid = remoteJid ? remoteJid.replace(/\D/g, '').replace(/@.*$/, '') : null;
    
    // Priorizar remoteJidAlt pois sempre tem o número real
    const realNumber = realNumberFromRemoteJidAlt || realNumberFromRemoteJid;
    
    if (realNumber && realNumber.length >= 10 && realNumber.length <= 13) {
      phoneToUse = realNumber;
      console.log(`✅ Usando número REAL do raw_payload: ${phoneToUse} (fonte: ${realNumberFromRemoteJidAlt ? 'remoteJidAlt' : 'remoteJid'})`);
    } else {
      console.warn(`⚠️ Número real não encontrado no raw_payload. Usando contact_phone: ${contact_phone}`);
    }
    
    // Validação: alertar se detectar LID sendo usado
    if (phoneToUse.length > 14) {
      console.error(`❌ ERRO: phoneToUse parece ser LID (${phoneToUse.length} dígitos): ${phoneToUse}`);
      console.log('📋 Dados para debug:', {
        contact_phone,
        remoteJid,
        remoteJidAlt,
        realNumberFromRemoteJid,
        realNumberFromRemoteJidAlt,
        phoneToUse
      });
    }

    // ========================================
    // STEP 2: PROCESS CONTACT
    // ========================================
    console.log('👤 Processando contato...');
    
    // Clean phone number - remove @s.whatsapp.net suffix if present
    const cleanPhone = phoneToUse.replace(/@s\.whatsapp\.net$/, '').replace(/@c\.us$/, '').replace(/\D/g, '');
    const tipoJid = isInternalNumber ? 'pessoa' : getTipoJid(contact_jid);
    console.log('📞 Telefone limpo:', { 
      original: contact_phone,
      phoneToUse: phoneToUse,
      clean: cleanPhone,
      tipo_jid: tipoJid,
      isInternal: isInternalNumber
    });
    
    // 🔍 Buscar contato: PRIMEIRO por phone (evita duplicação), depois por JID
    let { data: existingContact, error: contactSearchError } = await supabase
      .from('contacts')
      .select('*')
      .eq('phone', cleanPhone)
      .maybeSingle();

    if (contactSearchError) {
      console.error('❌ Erro ao buscar contato por phone:', contactSearchError);
      throw contactSearchError;
    }

    // Se não encontrou por phone, busca por JID (fallback para casos especiais)
    if (!existingContact) {
      const { data: contactByJid, error: jidSearchError } = await supabase
        .from('contacts')
        .select('*')
        .eq('jid', contact_jid.trim())
        .maybeSingle();
      
      if (jidSearchError) {
        console.error('❌ Erro ao buscar contato por JID:', jidSearchError);
        throw jidSearchError;
      }
      
      existingContact = contactByJid;
    }

    let contact;
    if (!existingContact) {
      // Create new contact
      console.log('➕ Criando novo contato:', { jid: contact_jid, phone: cleanPhone, name: contact_name, tipo_jid: tipoJid, isInternal: isInternalNumber });
      const { data: newContact, error: createContactError } = await supabase
        .from('contacts')
        .insert({
          jid: contact_jid.trim(),
          phone: cleanPhone,
          name: contact_name || cleanPhone,
          tipo_jid: tipoJid
        })
        .select()
        .single();

      if (createContactError) {
        console.error('❌ Erro ao criar contato:', createContactError);
        throw createContactError;
      }
      contact = newContact;
      console.log('✅ Contato criado:', contact.id);
    } else {
      // IMPORTANTE: Só atualizar nome se o contato ainda não tem nome definido
      // O contact_name do webhook é o "pushName" do WhatsApp - que é como o REMETENTE
      // salvou o número na agenda dele, não o nome real do contato
      // Só usar pushName como fallback quando não há nome
      const currentName = existingContact.name;
      const isNameMissing = !currentName || currentName === existingContact.phone || currentName === cleanPhone;
      
      if (contact_name && isNameMissing) {
        console.log('🔄 Definindo nome inicial do contato (não tinha nome):', { from: currentName, to: contact_name });
        const { data: updatedContact, error: updateError } = await supabase
          .from('contacts')
          .update({ 
            name: contact_name,
            tipo_jid: tipoJid
          })
          .eq('id', existingContact.id)
          .select()
          .single();

        if (updateError) {
          console.error('❌ Erro ao atualizar contato:', updateError);
          throw updateError;
        }
        contact = updatedContact;
      } else {
        // Atualizar apenas tipo_jid se necessário, preservando nome existente
        if (tipoJid !== existingContact.tipo_jid) {
          const { data: updatedContact, error: updateError } = await supabase
            .from('contacts')
            .update({ tipo_jid: tipoJid })
            .eq('id', existingContact.id)
            .select()
            .single();
          
          if (updateError) {
            console.error('❌ Erro ao atualizar tipo_jid:', updateError);
          }
          contact = updatedContact || existingContact;
        } else {
          contact = existingContact;
        }
        console.log('ℹ️ Mantendo nome existente do contato:', currentName);
      }
      console.log('✅ Contato encontrado:', contact.id);
    }

    // ========================================
    // STEP 3: PROCESS INSTANCE (Auto-create if not exists)
    // ========================================
    console.log('📱 Processando instância...');

    // CORREÇÃO 3: Reutilizar instanciasAtivas já carregada no STEP 1.5
    // Evita segundo SELECT na tabela instancias_whatsapp
    let instance = instanciasAtivas?.find(
      (i: any) => i.instancia_id === correctInstanceId
    ) || null;

    // AUTO-CREATE INSTANCE IF NOT EXISTS
    if (!instance) {
      console.log('⚠️ Instância não encontrada no sistema. Criando automaticamente...');
      console.log('📝 Correct Instance UUID:', correctInstanceId);
      console.log('📝 Instance Name:', instance_name);
      
      const { data: newInstance, error: createError } = await supabase
        .from('instancias_whatsapp')
        .insert({
          instancia_id: correctInstanceId,
          nome_instancia: instance_name || `Instância ${correctInstanceId.substring(0, 8)}`,
          status: 'ativa',
          ativo: true,
          tipo_canal: 'whatsapp',
          cor_identificacao: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')
        })
        .select()
        .single();
      
      if (createError) {
        console.error('❌ Erro ao criar instância automaticamente:', createError);
        throw createError;
      }
      
      instance = newInstance!;
      console.log('✅ Instância criada automaticamente:', instance!.id, '-', instance!.nome_instancia);
    } else {
      console.log('✅ Instância encontrada:', instance!.id, '-', instance!.nome_instancia);
    }

    if (!instance) {
      throw new Error('Instância não encontrada e não pôde ser criada automaticamente');
    }

    // ========================================
    // STEP 4: PROCESS CONVERSATION - BIDIRECTIONAL LOGIC
    // ========================================
    
    // 🚫 EVITAR CONVERSAS DUPLICADAS: ignorar evento DELIVERY_ACK para mensagens internas
    // IMPORTANTE: Só ignorar se from_me === true (eco da própria mensagem enviada)
    // Mensagens recebidas (from_me === false) NUNCA devem ser ignoradas, mesmo de números internos
    const isFromMeFlag = from_me === true || from_me === 'true';
    if (isInternalNumber && message_status === 'DELIVERY_ACK' && isFromMeFlag) {
      console.log('⏭️ Mensagem interna duplicada (DELIVERY_ACK), ignorando para não criar conversas duplicadas', { 
        wa_message_id, 
        message_status,
        isInternalNumber,
        instanciaDestinataria: instanciaDestinataria?.nome_instancia
      });
      return new Response(
        JSON.stringify({ 
          success: true,
          code: 'INTERNAL_DUPLICATE_IGNORED',
          message: 'Mensagem interna duplicada ignorada (DELIVERY_ACK)',
          wa_message_id: wa_message_id
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    let conversa = null;
    let conversaDestinataria = null;
    let skipConversaCRM = isInternalNumber && ignorarMensagensInternas;

    if (skipConversaCRM) {
      console.log('⏭️ Pulando criação/atualização de conversa CRM (mensagem interna + configuração ativa)');
    } else {
      console.log('💬 Processando conversa...');
      
      // REMETENTE: Search for existing conversation by contact_id + orig_instance_id
      const { data: existingConversa, error: conversaSearchError } = await supabase
        .from('conversas')
        .select('*')
        .eq('contact_id', contact.id)
        .eq('orig_instance_id', instance.id)
        .maybeSingle();

      if (conversaSearchError) {
        console.error('❌ Erro ao buscar conversa:', conversaSearchError);
        throw conversaSearchError;
      }

      if (!existingConversa) {
        // Create new conversation
        console.log('➕ Criando nova conversa');
        const { data: newConversa, error: createConversaError } = await supabase
          .from('conversas')
          .insert({
            contact_id: contact.id,
            numero_contato: contact.phone,
            nome_contato: contact.name || contact.phone,
            orig_instance_id: instance.id,
            current_instance_id: instance.id,
            instancia_id: instance.id, // mantém compatibilidade
            status: 'novo',
            status_qualificacao: 'Pronto para Atendimento',
            ultima_mensagem: effectiveMessageText,
            ultima_interacao: new Date().toISOString()
          })
          .select()
          .single();

        if (createConversaError) {
          console.error('❌ Erro ao criar conversa:', createConversaError);
          throw createConversaError;
        }
        conversa = newConversa;
        console.log('✅ Conversa criada:', conversa.id);
      } else {
        // Update existing conversation
        console.log('🔄 Atualizando conversa existente:', existingConversa.id);
        const { data: updatedConversa, error: updateConversaError } = await supabase
          .from('conversas')
          .update({
            nome_contato: contact.name || contact.phone,
            ultima_mensagem: effectiveMessageText,
            ultima_interacao: new Date().toISOString()
          })
          .eq('id', existingConversa.id)
          .select()
          .single();

        if (updateConversaError) {
          console.error('❌ Erro ao atualizar conversa:', updateConversaError);
          throw updateConversaError;
        }
        conversa = updatedConversa;
        console.log('✅ Conversa atualizada:', conversa.id);
      }

      // DESTINATÁRIO: Para mensagens internas, COMPARTILHAR a mesma conversa
      if (isInternalNumber && instanciaDestinataria && instanciaDestinataria.id !== instance.id) {
        console.log('🔄 Mensagem interna - verificando conversa compartilhada');
        console.log('📍 Instância destinatária:', {
          id: instanciaDestinataria.id,
          nome: instanciaDestinataria.nome_instancia,
          numero: instanciaDestinataria.numero_chip
        });

        // Buscar se já existe uma conversa "reversa" (destinatária falando com remetente)
        const numeroRemetente = instance.numero_chip?.replace(/\D/g, '') || correctInstanceId.split('@')[0].replace(/\D/g, '');
        
        const { data: conversaReversa } = await supabase
          .from('conversas')
          .select('*')
          .eq('numero_contato', numeroRemetente)
          .eq('orig_instance_id', instanciaDestinataria.id)
          .maybeSingle();

        if (conversaReversa) {
          console.log('✅ Conversa reversa encontrada - usando a mesma:', conversaReversa.id);
          // Atualizar a conversa reversa existente ao invés de criar nova
          const { data: conversaAtualizada } = await supabase
            .from('conversas')
            .update({
              ultima_mensagem: effectiveMessageText,
              ultima_interacao: new Date().toISOString(),
            })
            .eq('id', conversaReversa.id)
            .select()
            .single();
          conversaDestinataria = conversaAtualizada;
        } else {
          console.log('ℹ️ Conversa reversa não existe - a conversa remetente será usada por ambas');
          // Não criar conversa separada - ambas usarão a conversa do remetente
          conversaDestinataria = conversa;
        }
      }
    }

    // ========================================
    // STEP 5: SAVE MESSAGE IN `mensagens` (CRM) - BIDIRECTIONAL
    // ========================================
    let mensagem = null;
    let mensagemDestinataria = null;
    
    if (conversa) {
      console.log('💾 Salvando mensagem na conversa remetente...');
      
      // Map remetente: from_me = true → 'enviada', from_me = false → 'recebida'
      const remetente = (from_me === true || from_me === 'true') ? 'enviada' : 'recebida';
      
      // Map tipo_mensagem: 'conversation' → 'texto', and other Evolution API types to DB format
      const tipoMensagemMap: Record<string, string> = {
        'conversation': 'texto',
        'extendedTextMessage': 'texto',
        'imageMessage': 'imagem',
        'audioMessage': 'audio',
        'videoMessage': 'video',
        'documentMessage': 'documento',
        'documentWithCaptionMessage': 'documento',
        'stickerMessage': 'imagem',
      };
      const tipoMensagem = tipoMensagemMap[message_type || 'conversation'] || 'texto';
      
      console.log('📝 Valores para inserir:', { remetente, tipoMensagem, from_me, message_type });
      
      // Try to insert the message, handling duplicate wa_message_id as idempotent success
      const { data: newMensagem, error: mensagemError } = await supabase
        .from('mensagens')
        .insert({
          conversa_id: conversa.id,
          conteudo: effectiveMessageText,
          remetente: remetente,
          tipo_mensagem: tipoMensagem,
          wa_message_id: wa_message_id,
          lida: false
        })
        .select()
        .single();

      if (mensagemError) {
        console.error('❌ Erro ao salvar mensagem:', mensagemError);
        
        // Check if it's a duplicate wa_message_id error - treat as idempotent success
        if (mensagemError.code === '23505') {
          console.log('ℹ️ Mensagem duplicada detectada (23505) - verificando conversa correta');
          
          // Fetch the existing message to check if it's in the correct conversa
          const { data: existingMsg, error: fetchError } = await supabase
            .from('mensagens')
            .select('id, conversa_id')
            .eq('wa_message_id', wa_message_id)
            .maybeSingle();
          
          if (fetchError) {
            console.error('⚠️ Erro ao buscar mensagem existente:', fetchError);
          }
          
          // If the message exists but in a DIFFERENT conversa, move it to the correct one
          if (existingMsg && existingMsg.conversa_id !== conversa.id) {
            console.log(`🔄 Mensagem está na conversa errada (${existingMsg.conversa_id}), movendo para a correta (${conversa.id})`);
            const { error: moveError } = await supabase
              .from('mensagens')
              .update({ 
                conversa_id: conversa.id,
                conteudo: effectiveMessageText,
                remetente: remetente,
                tipo_mensagem: tipoMensagem,
              })
              .eq('id', existingMsg.id);
            
            if (moveError) {
              console.error('❌ Erro ao mover mensagem para conversa correta:', moveError);
            } else {
              console.log('✅ Mensagem movida para conversa correta com sucesso');
              
              // Update the correct conversa with last message info
              await supabase
                .from('conversas')
                .update({
                  ultima_mensagem: effectiveMessageText,
                  ultima_interacao: new Date().toISOString(),
                })
                .eq('id', conversa.id);
            }
          }
          
          const idempotentResponse = {
            success: true,
            code: existingMsg && existingMsg.conversa_id !== conversa.id ? 'MESSAGE_MOVED_TO_CORRECT_CONVERSA' : 'MESSAGE_ALREADY_EXISTS',
            message: existingMsg && existingMsg.conversa_id !== conversa.id 
              ? 'Mensagem movida da conversa incorreta para a correta.' 
              : 'Mensagem já registrada com este wa_message_id, operação ignorada.',
            wa_message_id: wa_message_id,
            mensagemId: existingMsg?.id || null,
            conversaId: conversa.id,
            contactId: contact.id,
            instanciaId: instance.id
          };
          
          console.log('✅ Resposta:', JSON.stringify(idempotentResponse, null, 2));
          return new Response(
            JSON.stringify(idempotentResponse),
            { 
              status: 200, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        
        // Check if it's a CHECK constraint error
        if (mensagemError.code === '23514') {
          const constraintError = {
            success: false,
            code: 'DB_MENSAGEM_CHECK_FAILED',
            message: 'Valor inválido para "remetente" ou "tipo_mensagem" na tabela "mensagens".',
            details: {
              dbCode: mensagemError.code,
              dbMessage: mensagemError.message,
              constraint: mensagemError.details || 'mensagens_remetente_check ou mensagens_tipo_mensagem_check',
              attemptedValues: {
                remetente: remetente,
                tipo_mensagem: tipoMensagem,
                original_message_type: message_type,
                original_from_me: from_me
              },
              failingRow: {
                conversa_id: conversa.id,
                conteudo: message_text,
                remetente: remetente,
                tipo_mensagem: tipoMensagem,
                wa_message_id: wa_message_id
              }
            }
          };
          console.error('❌ CHECK CONSTRAINT violation:', JSON.stringify(constraintError, null, 2));
          return new Response(
            JSON.stringify(constraintError),
            { 
              status: 400, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        
        throw mensagemError;
      }
      
      mensagem = newMensagem;
      console.log('✅ Mensagem remetente salva:', mensagem?.id);

      // Save mirror message in recipient conversation if internal
      if (conversaDestinataria) {
        console.log('💾 Salvando mensagem na conversa destinatária...');
        
        const remetenteDestinataria = remetente === 'enviada' ? 'recebida' : 'enviada';
        
        const { data: newMensagemDest, error: mensagemDestError } = await supabase
          .from('mensagens')
          .insert({
            conversa_id: conversaDestinataria.id,
            conteudo: effectiveMessageText,
            remetente: remetenteDestinataria,
            tipo_mensagem: tipoMensagem,
            wa_message_id: `${wa_message_id}_dest`,
            lida: false
          })
          .select()
          .single();

        if (mensagemDestError && mensagemDestError.code !== '23505') {
          console.error('❌ Erro ao salvar mensagem destinatária:', mensagemDestError);
        } else {
          mensagemDestinataria = newMensagemDest;
          console.log('✅ Mensagem destinatária salva:', mensagemDestinataria?.id);
        }
      }
      console.log('✅ Mensagem salva na tabela mensagens:', mensagem.id);

      // CORREÇÃO 4: Reutilizar variável conversa já carregada (evita SELECT duplicado)
      if (mensagem && mensagem.remetente === 'recebida' && conversa) {
        const currentUnread = conversa.unread_count || 0;
        const CLOSURE_PATTERNS = /^(ok|okay|obrigad[oa]|obg|vlw|valeu|blz|beleza|perfeito|combinado|certo|entendi|show|top|massa|boa|bom dia|boa tarde|boa noite|tá|ta|sim|não|nao|haha|kk|rs|kkk|👍|👌|🙏|😊|😁|❤|🤝|👏)$/i;
        const msgText = mensagem.conteudo || '';
        const isClosure = CLOSURE_PATTERNS.test(msgText.trim());
        await supabase
          .from('conversas')
          .update({
            unread_count: currentUnread + 1,
            last_message_from_me: isClosure ? null : false,
          })
          .eq('id', conversa.id);
        console.log('🔔 unread_count atualizado:', currentUnread, '→', currentUnread + 1, '| last_message_from_me:', isClosure ? null : false);
      }
    } else {
      console.log('⏭️ Pulando salvamento na tabela mensagens (sem conversa CRM)');
    }

    // ========================================
    // STEP 6: REMOVIDO — INSERT em `messages` era DUPLICADO
    // A tabela `messages` já é alimentada pelo evolution-messages-webhook.
    // Este webhook (n8n-inbound) só precisa salvar em `mensagens` (tabela CRM).
    // Correção elimina ~94% do custo de writes desnecessários.
    // ========================================

    // ========================================
    // STEP 7: RETURN SUCCESS RESPONSE
    // ========================================
    const response: any = {
      success: true,
      contactId: contact.id,
      instanciaId: instance.id,
      message: skipConversaCRM
        ? 'Mensagem interna salva no histórico (conversa CRM não criada)'
        : 'Mensagem processada e salva com sucesso'
    };

    if (conversa) {
      response.conversaId = conversa.id;
    }

    if (mensagem) {
      response.mensagemId = mensagem.id;
    }

    if (conversaDestinataria) {
      response.conversaDestinatariaId = conversaDestinataria.id;
      response.bidirectional = true;
    }

    if (mensagemDestinataria) {
      response.mensagemDestinatariaId = mensagemDestinataria.id;
    }

    if (skipConversaCRM) {
      response.code = 'INTERNAL_MESSAGE_LOGGED';
      response.internal_number = true;
    }

    console.log('✅ Processamento completo:', response);

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    // Log completo do erro para debugging
    console.error('❌ EDGE_ERROR_PROCESS_MESSAGE - Erro completo:', error);
    
    // Extrair informações úteis do erro
    const errorDetails: {
      message: string;
      code?: string;
      details?: string;
      hint?: string;
    } = {
      message: error instanceof Error ? error.message : String(error)
    };

    // Se for erro do Supabase/Postgres, extrair campos adicionais
    if (error && typeof error === 'object') {
      const err = error as any;
      if (err.code) errorDetails.code = err.code;
      if (err.details) errorDetails.details = err.details;
      if (err.hint) errorDetails.hint = err.hint;
    }

    return new Response(
      JSON.stringify({ 
        error: 'Erro interno ao processar mensagem',
        details: errorDetails
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});