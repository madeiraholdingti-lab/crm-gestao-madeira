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
    console.log('Iniciando criação de instância na Evolution API');
    
    const { instanceName, token, integration } = await req.json();
    
    if (!instanceName) {
      console.error('Nome da instância não fornecido');
      return new Response(
        JSON.stringify({ success: false, error: 'Nome da instância é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const evolutionApiKey = Deno.env.get('EVOLUTION_API_KEY');
    if (!evolutionApiKey) {
      console.error('EVOLUTION_API_KEY não configurada');
      return new Response(
        JSON.stringify({ success: false, error: 'API Key da Evolution não configurada' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Buscar URL base da Evolution API do banco
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { data: config, error: configError } = await supabase
      .from('config_global')
      .select('evolution_base_url')
      .single();
    
    if (configError || !config) {
      console.error("Error fetching config:", configError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch Evolution API URL configuration" }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const evolutionBaseUrl = config.evolution_base_url;
    const createUrl = `${evolutionBaseUrl}/instance/create`;

    console.log('Criando instância:', instanceName);

    const payload = {
      instanceName: instanceName,
      token: token || undefined,
      integration: integration || 'WHATSAPP-BAILEYS',
      qrcode: true,
      reject_call: false,
      msg_call: '',
      groups_ignore: true,
      always_online: false,
      read_messages: false,
      read_status: false
    };

    console.log('Payload da requisição:', JSON.stringify(payload));

    const response = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'apikey': evolutionApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    console.log('Status da resposta:', response.status);
    const responseText = await response.text();
    console.log('Resposta da Evolution API:', responseText);

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      data = { raw: responseText };
    }

    if (!response.ok) {
      console.error('Erro na criação da instância:', response.status, data);
      return new Response(
        JSON.stringify({
          success: false,
          error: `API retornou ${response.status}`,
          details: JSON.stringify(data)
        }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Instância criada com sucesso');
    
    // Extrair QR Code da resposta (vem no objeto qrcode)
    const qrCodeData = data.qrcode || {};
    const base64QrCode = qrCodeData.base64 || null;
    const qrCodeText = qrCodeData.code || null;
    const pairingCode = qrCodeData.pairingCode || null;

    console.log('QR Code extraído:', { 
      hasBase64: !!base64QrCode, 
      hasCode: !!qrCodeText,
      hasPairingCode: !!pairingCode 
    });

    const finalInstanceId = data.instance?.instanceId || data.instance?.instanceName || instanceName;

    // Webhook será configurado após conexão ativa
    console.log('Instância criada. Webhook será configurado após WhatsApp conectar.');

    // Retornar todos os dados relevantes incluindo QR Code
    return new Response(
      JSON.stringify({
        success: true,
        instance: data.instance || data,
        hash: data.hash,
        token: data.hash,
        instanceId: finalInstanceId,
        instanceName: data.instance?.instanceName || instanceName,
        status: data.instance?.status || 'connecting',
        // Dados do QR Code
        qrCode: {
          base64: base64QrCode,
          code: qrCodeText,
          pairingCode: pairingCode
        },
        webhookConfigured: false,
        raw: data
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: any) {
    console.error('Erro ao processar requisição:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
