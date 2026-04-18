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
    const { conversa_id, texto, instancia_whatsapp_id, user_id } = await req.json();

    if (!conversa_id || !texto || !user_id) {
      console.error("Missing required fields:", { conversa_id, texto, user_id });
      return new Response(
        JSON.stringify({ success: false, code: "MISSING_FIELDS", message: "conversa_id, texto e user_id são obrigatórios" }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`[ENVIO] Iniciando envio de mensagem para conversa: ${conversa_id}`);
    console.log(`[ENVIO] Usuário enviando mensagem: ${user_id}`);
    if (instancia_whatsapp_id) {
      console.log(`[ENVIO] Instância específica solicitada: ${instancia_whatsapp_id}`);
    }

    // Inicializar Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Buscar a conversa
    const { data: conversa, error: conversaError } = await supabase
      .from('conversas')
      .select('id, numero_contato, current_instance_id')
      .eq('id', conversa_id)
      .single();
    
    if (conversaError || !conversa) {
      console.error("Conversa não encontrada:", conversaError);
      return new Response(
        JSON.stringify({ success: false, code: "CONVERSA_NAO_ENCONTRADA", message: "Conversa não encontrada" }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Limpar número de contato (remover JID se existir)
    let numero_contato = conversa.numero_contato;
    if (numero_contato.includes('@')) {
      numero_contato = numero_contato.split('@')[0];
      console.log(`[ENVIO] Número limpo (removido JID): ${numero_contato}`);
    }

    // Usar a instância fornecida pelo frontend OU a current_instance_id da conversa como fallback
    const instance_fk = instancia_whatsapp_id || conversa.current_instance_id;

    if (!instance_fk) {
      console.error("Nenhuma instância especificada para envio");
      return new Response(
        JSON.stringify({ success: false, code: "SEM_INSTANCIA", message: "Nenhuma instância WhatsApp especificada para envio" }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`[ENVIO] Número contato: ${numero_contato}, Instance FK: ${instance_fk}`);

    // 2. Buscar a instância WhatsApp
    const { data: instancia, error: instanciaError } = await supabase
      .from('instancias_whatsapp')
      .select('id, instancia_id, nome_instancia, ativo, status')
      .eq('id', instance_fk)
      .single();
    
    if (instanciaError || !instancia) {
      console.error("Instância não encontrada:", instanciaError);
      return new Response(
        JSON.stringify({ success: false, code: "INSTANCIA_NAO_ENCONTRADA", message: "Instância WhatsApp não encontrada" }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Não validar mais o campo 'ativo' do banco, pois ele pode estar desatualizado
    // Vamos validar o status real da Evolution API antes de enviar
    if (instancia.status === 'deletada') {
      console.error("Instância deletada:", instancia.nome_instancia);
      return new Response(
        JSON.stringify({ 
          success: false, 
          code: "INSTANCIA_DELETADA", 
          message: `A instância "${instancia.nome_instancia}" foi deletada.` 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const instancia_evolution_id = instancia.instancia_id; // ID técnico da Evolution (ex: "conectar", "Helen", "iza")
    console.log(`[ENVIO] Dados completos da instância:`, {
      db_uuid: instancia.id,
      evolution_id: instancia_evolution_id,
      nome: instancia.nome_instancia,
      ativo: instancia.ativo,
      status: instancia.status
    });

    // IMPORTANTE: Para validar status, usar o NOME da instância, não o UUID
    const instancia_name_for_status = instancia.nome_instancia;

    // 3. Buscar configuração global da Evolution API
    const { data: config, error: configError } = await supabase
      .from('config_global')
      .select('evolution_base_url, evolution_api_key')
      .single();
    
    if (configError || !config) {
      console.error("Erro ao buscar configuração global:", configError);
      return new Response(
        JSON.stringify({ success: false, code: "CONFIG_ERROR", message: "Falha ao buscar configuração da Evolution API" }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const evolutionApiKey = config.evolution_api_key || Deno.env.get('EVOLUTION_API_KEY');
    if (!evolutionApiKey) {
      console.error("Evolution API Key não configurada");
      return new Response(
        JSON.stringify({ success: false, code: "MISSING_API_KEY", message: "Evolution API key não configurada" }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const evolutionBaseUrl = config.evolution_base_url;

    // 4. Validar status real da instância na Evolution API (usando o NOME, não UUID)
    const statusUrl = `${evolutionBaseUrl}/instance/connectionState/${encodeURIComponent(instancia_name_for_status)}`;
    console.log(`[ENVIO] Validando status da instância: ${statusUrl}`);

    const statusResponse = await fetch(statusUrl, {
      method: 'GET',
      headers: {
        'apikey': evolutionApiKey,
        'Content-Type': 'application/json',
      },
    });

    if (statusResponse.ok) {
      const statusData = await statusResponse.json();
      const connectionState = statusData?.state || statusData?.instance?.state || 'unknown';
      const isConnected = connectionState === 'open' || connectionState === 'connected';
      
      console.log(`[ENVIO] Status da instância "${instancia.nome_instancia}": ${connectionState}, Conectada: ${isConnected}`);
      
      if (!isConnected) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            code: "INSTANCIA_DESCONECTADA", 
            message: `A instância "${instancia.nome_instancia}" está desconectada no momento. Conecte-a em 'Configurações Zaps' antes de enviar mensagens.` 
          }),
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
    } else {
      console.warn(`[ENVIO] Não foi possível validar status da instância (${statusResponse.status}). Tentando enviar mesmo assim...`);
    }

    // 5. Enviar mensagem via Evolution API (formato v2)
    // IMPORTANTE: Para enviar mensagem, usar o NOME da instância
    const sendUrl = `${evolutionBaseUrl}/message/sendText/${encodeURIComponent(instancia_name_for_status)}`;
    const payload = {
      number: numero_contato,
      text: texto  // v2: text direto no root, não dentro de textMessage
    };

    console.log(`[ENVIO] Enviando para Evolution: ${sendUrl}`);
    console.log(`[ENVIO] Instance Evolution ID: ${instancia_evolution_id}`);
    console.log(`[ENVIO] Payload:`, JSON.stringify(payload));

    const response = await fetch(sendUrl, {
      method: 'POST',
      headers: {
        'apikey': evolutionApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    const responseBody = await response.text();
    console.log(`[ENVIO] Evolution API Response Status: ${response.status}`);
    console.log(`[ENVIO] Evolution API Response Body: ${responseBody}`);
    
    let responseData;
    try {
      responseData = JSON.parse(responseBody);
    } catch (e) {
      console.warn('[ENVIO] Resposta não é JSON válido');
    }

    if (!response.ok) {
      console.error(`[ENVIO] Evolution API error: ${response.status}`);
      
      // Tratar erro específico de instância não existente
      if (response.status === 404 && responseBody.includes('instance does not exist')) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            code: "EVOLUTION_INSTANCE_NOT_FOUND",
            message: `A instância "${instancia_evolution_id}" não existe na Evolution API`,
            instance: instancia_evolution_id,
            details: responseBody
          }),
          { 
            status: 200, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
      
      return new Response(
        JSON.stringify({ 
          success: false, 
          code: "EVOLUTION_SEND_ERROR",
          status: response.status,
          message: `Erro ao enviar via Evolution API: ${response.statusText}`,
          details: responseBody
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // 6. Registrar mensagem no banco (tabela mensagens)
    // Extrair wa_message_id da resposta se disponível
    const waMessageId = responseData?.key?.id || responseData?.message?.key?.id;
    
    const { error: mensagemError } = await supabase
      .from('mensagens')
      .insert({
        conversa_id: conversa_id,
        conteudo: texto,
        remetente: 'enviada',
        tipo_mensagem: 'texto',
        enviado_por: user_id,
        wa_message_id: waMessageId,
        status: 'PENDING'
      });

    if (mensagemError) {
      console.error('[ENVIO] Erro ao registrar mensagem no banco:', mensagemError);
      // Não retornar erro aqui, pois a mensagem já foi enviada
    } else {
      console.log('[ENVIO] Mensagem registrada no banco com sucesso');
    }

    // 7. Atualizar conversa (ultima_mensagem, ultima_interacao e current_instance_id)
    const conversaUpdate: any = {
      ultima_mensagem: texto,
      ultima_interacao: new Date().toISOString()
    };
    
    // Se foi usada uma instância específica, atualizar o current_instance_id
    if (instancia_whatsapp_id) {
      conversaUpdate.current_instance_id = instancia_whatsapp_id;
      console.log(`[ENVIO] Atualizando current_instance_id para: ${instancia_whatsapp_id}`);
    }

    const { error: updateError } = await supabase
      .from('conversas')
      .update(conversaUpdate)
      .eq('id', conversa_id);

    if (updateError) {
      console.error('[ENVIO] Erro ao atualizar conversa:', updateError);
    }

    console.log('[ENVIO] Mensagem enviada com sucesso!');

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Mensagem enviada com sucesso"
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('[ENVIO] Erro geral:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ 
        success: false, 
        code: "INTERNAL_ERROR",
        message: errorMessage 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
