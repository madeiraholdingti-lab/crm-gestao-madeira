import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MessageData {
  key: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
    remoteJidAlt?: string;
    participant?: string;
    addressingMode?: string;
  };
  pushName?: string;
  message?: {
    conversation?: string;
    extendedTextMessage?: {
      text?: string;
    };
    imageMessage?: {
      url?: string;
      mimetype?: string;
      caption?: string;
    };
    audioMessage?: {
      url?: string;
      mimetype?: string;
    };
    videoMessage?: {
      url?: string;
      mimetype?: string;
      caption?: string;
    };
    documentMessage?: {
      url?: string;
      mimetype?: string;
      fileName?: string;
    };
  };
  messageTimestamp?: number | { low: number; high: number };
  status?: string;
}

/**
 * Extrai o texto da mensagem de diferentes formatos
 */
function extractMessageText(message: MessageData["message"]): string | null {
  if (!message) return null;
  
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.imageMessage) return null; // Imagem sem legenda - texto null
  if (message.audioMessage) return null;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  if (message.videoMessage) return null;
  if (message.documentMessage?.fileName) return message.documentMessage.fileName;
  if (message.documentMessage) return null;
  
  return null;
}

/**
 * Converte timestamp para valor numérico (segundos)
 */
function getTimestampNumber(timestamp?: number | { low: number; high: number }): number {
  if (!timestamp) return Math.floor(Date.now() / 1000);
  
  if (typeof timestamp === "object" && "low" in timestamp) {
    return timestamp.low;
  }
  
  return timestamp as number;
}

/**
 * Converte timestamp para ISO string
 */
function timestampToISOString(timestamp?: number | { low: number; high: number }): string {
  const ts = getTimestampNumber(timestamp);
  
  // Se for em segundos (Unix timestamp), multiplicar por 1000
  const msTimestamp = ts < 10000000000 ? ts * 1000 : ts;
  
  return new Date(msTimestamp).toISOString();
}

/**
 * Extrai número de telefone do JID
 */
function extractPhoneFromJid(jid: string): string {
  return jid.replace("@s.whatsapp.net", "").replace("@g.us", "");
}

/**
 * Detecta tipo de mensagem
 */
function detectMessageType(message: MessageData["message"]): string {
  if (!message) return "conversation";
  
  if (message.imageMessage) return "imageMessage";
  if (message.audioMessage) return "audioMessage";
  if (message.videoMessage) return "videoMessage";
  if (message.documentMessage) return "documentMessage";
  if (message.extendedTextMessage) return "extendedTextMessage";
  
  return "conversation";
}

/**
 * Extrai URL de mídia da mensagem
 */
function extractMediaUrl(message: MessageData["message"]): string | null {
  if (!message) return null;
  
  if (message.imageMessage?.url) return message.imageMessage.url;
  if (message.audioMessage?.url) return message.audioMessage.url;
  if (message.videoMessage?.url) return message.videoMessage.url;
  if (message.documentMessage?.url) return message.documentMessage.url;
  
  return null;
}

/**
 * Extrai mimetype da mídia
 */
function extractMediaMimeType(message: MessageData["message"]): string | null {
  if (!message) return null;
  
  if (message.imageMessage?.mimetype) return message.imageMessage.mimetype;
  if (message.audioMessage?.mimetype) return message.audioMessage.mimetype;
  if (message.videoMessage?.mimetype) return message.videoMessage.mimetype;
  if (message.documentMessage?.mimetype) return message.documentMessage.mimetype;
  
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

     const body = await req.json();
     const { contact_id, instancia_id, limit = 50, page = 1 } = body;

    if (!contact_id || !instancia_id) {
      return new Response(
        JSON.stringify({ success: false, error: "contact_id e instancia_id são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[SYNC-HISTORICO] Iniciando sincronização para contact_id=${contact_id}, instancia_id=${instancia_id}`);

    // Buscar configuração global
    const { data: config, error: configError } = await supabase
      .from("config_global")
      .select("evolution_base_url, evolution_api_key")
      .single();

    if (configError || !config) {
      console.error("[SYNC-HISTORICO] Erro ao buscar config:", configError);
      throw new Error("Configuração da Evolution não encontrada");
    }

    // Buscar contato para pegar o JID
    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("id, jid, phone, name")
      .eq("id", contact_id)
      .single();

    if (contactError || !contact) {
      console.error("[SYNC-HISTORICO] Erro ao buscar contato:", contactError);
      throw new Error("Contato não encontrado");
    }

    // Buscar instância
    const { data: instancia, error: instanciaError } = await supabase
      .from("instancias_whatsapp")
      .select("id, instancia_id, nome_instancia")
      .eq("id", instancia_id)
      .single();

    if (instanciaError || !instancia) {
      console.error("[SYNC-HISTORICO] Erro ao buscar instância:", instanciaError);
      throw new Error("Instância não encontrada");
    }

    console.log(`[SYNC-HISTORICO] Usando instância: ${instancia.nome_instancia}, contato: ${contact.phone}, jid: ${contact.jid}`);

    // Formatar JID - usar o telefone no formato padrão
    const remoteJidStandard = `${contact.phone}@s.whatsapp.net`;
    // Extrair apenas o número para comparação
    const phoneNumber = contact.phone;
    
    // A Evolution API tem bug no filtro remoteJid com @lid
    // Usar endpoint alternativo que busca todas as mensagens e filtrar manualmente
    const evolutionUrl = `${config.evolution_base_url}/chat/findMessages/${encodeURIComponent(instancia.nome_instancia)}`;
    
    console.log(`[SYNC-HISTORICO] Chamando Evolution API: ${evolutionUrl}, phone: ${phoneNumber}`);

    // Tentar buscar SEM filtro de remoteJid primeiro (buscar todas e filtrar)
    // Isso contorna o bug do filtro @lid vs @s.whatsapp.net
    const evolutionResponse = await fetch(evolutionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": config.evolution_api_key || "",
      },
      body: JSON.stringify({
        // Não filtrar por remoteJid - a Evolution tem bug com @lid
        // Buscar todas as mensagens recentes e filtrar depois
        limit: limit * 10, // Buscar mais para compensar a filtragem
        page: page,
      }),
    });

    if (!evolutionResponse.ok) {
      const errorText = await evolutionResponse.text();
      console.error(`[SYNC-HISTORICO] Erro da Evolution API: ${evolutionResponse.status}`, errorText);
      throw new Error(`Evolution API retornou ${evolutionResponse.status}: ${errorText}`);
    }

    const responseData = await evolutionResponse.json();

    const totalFromApi = responseData.messages?.total ?? 0;
    const pagesFromApi = responseData.messages?.pages ?? 1;
    const currentPage = responseData.messages?.currentPage ?? page;

    console.log(`[SYNC-HISTORICO] Response da Evolution (sem filtro) - total: ${totalFromApi}, pages: ${pagesFromApi}, currentPage: ${currentPage}`);

    // Filtrar mensagens pelo número do contato (tanto remoteJid quanto remoteJidAlt)
    const allMessages: MessageData[] = responseData.messages?.records || [];
    
    const messages = allMessages.filter((msg: MessageData) => {
      // Extrair número do remoteJid ou remoteJidAlt
      const jid = msg.key.remoteJid || "";
      const jidAlt = msg.key.remoteJidAlt || "";
      
      // Extrair apenas os números
      const jidNumber = jid.replace(/@.*$/, "");
      const jidAltNumber = jidAlt.replace(/@.*$/, "");
      
      // Verificar se algum bate com o telefone do contato
      return jidNumber === phoneNumber || jidAltNumber === phoneNumber;
    });

    console.log(`[SYNC-HISTORICO] Filtradas ${messages.length} mensagens do contato (de ${allMessages.length} total)`);

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Nenhuma mensagem encontrada no histórico",
          synced: 0
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Buscar wa_message_ids já existentes para evitar duplicatas
    const waMessageIds = messages.map(m => m.key.id).filter(Boolean);
    
    const { data: existingMessages } = await supabase
      .from("messages")
      .select("wa_message_id")
      .eq("contact_id", contact_id)
      .eq("instancia_whatsapp_id", instancia_id)
      .in("wa_message_id", waMessageIds);

    const existingIds = new Set((existingMessages || []).map(m => m.wa_message_id));
    console.log(`[SYNC-HISTORICO] ${existingIds.size} mensagens já existem no banco`);

    // Preparar mensagens para inserção na tabela 'messages'
    const mensagensParaInserir: any[] = [];

    for (const msg of messages) {
      // Pular se já existe
      if (existingIds.has(msg.key.id)) {
        continue;
      }

      const texto = extractMessageText(msg.message);
      const messageType = detectMessageType(msg.message);
      
      // Permitir mensagens sem texto se forem de mídia
      if (!texto && messageType === "conversation") {
        continue;
      }

      const waTimestamp = getTimestampNumber(msg.messageTimestamp);

      mensagensParaInserir.push({
        contact_id: contact_id,
        instance: instancia.instancia_id,
        instance_uuid: instancia.id,
        instancia_whatsapp_id: instancia_id,
        from_me: msg.key.fromMe,
        text: texto,
        message_type: messageType,
        wa_message_id: msg.key.id,
        wa_timestamp: waTimestamp,
        status: msg.key.fromMe ? "SENT" : "RECEIVED",
        sender_jid: msg.key.fromMe ? null : (msg.key.remoteJidAlt || msg.key.remoteJid || remoteJidStandard),
        media_url: extractMediaUrl(msg.message),
        media_mime_type: extractMediaMimeType(msg.message),
        event: "messages.upsert",
        source: "history_sync",
        created_at: timestampToISOString(msg.messageTimestamp)
      });
    }

    console.log(`[SYNC-HISTORICO] ${mensagensParaInserir.length} novas mensagens para inserir`);

    // Inserir mensagens em lotes
    let insertedCount = 0;
    const batchSize = 50;

    for (let i = 0; i < mensagensParaInserir.length; i += batchSize) {
      const batch = mensagensParaInserir.slice(i, i + batchSize);
      
      const { error: insertError } = await supabase
        .from("messages")
        .insert(batch);

      if (insertError) {
        console.error(`[SYNC-HISTORICO] Erro ao inserir lote ${i / batchSize + 1}:`, insertError);
      } else {
        insertedCount += batch.length;
      }
    }

    console.log(`[SYNC-HISTORICO] Sincronização concluída: ${insertedCount} mensagens inseridas`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Sincronização concluída`,
        total_encontradas: messages.length,
        total: totalFromApi,
        pages: pagesFromApi,
        currentPage: currentPage,
        ja_existentes: existingIds.size,
        novas_inseridas: insertedCount
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[SYNC-HISTORICO] Erro geral:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Erro desconhecido"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
