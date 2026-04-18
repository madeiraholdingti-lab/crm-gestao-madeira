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
    const { instanceName } = await req.json();

    if (!instanceName) {
      return new Response(
        JSON.stringify({ error: "Missing instanceName" }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Reconectando instância desconectada: ${instanceName}`);

    const evolutionApiKey = Deno.env.get('EVOLUTION_API_KEY');
    
    if (!evolutionApiKey) {
      console.error("EVOLUTION_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Evolution API key not configured" }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
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
    
    // Evolution API v2: Para reconectar instância desconectada:
    // 1. Fazer logout primeiro (se necessário)
    // 2. Conectar para obter novo QR code
    
    // Passo 1: Tentar fazer logout da instância
    console.log(`Passo 1: Fazendo logout da instância: ${instanceName}`);
    const logoutUrl = `${evolutionBaseUrl}/instance/logout/${encodeURIComponent(instanceName)}`;
    
    console.log(`Calling: DELETE ${logoutUrl}`);
    
    const logoutResponse = await fetch(logoutUrl, {
      method: 'DELETE',
      headers: {
        'apikey': evolutionApiKey,
        'Content-Type': 'application/json',
      },
    });

    const logoutText = await logoutResponse.text();
    console.log(`Logout response status: ${logoutResponse.status}`);
    console.log(`Logout response body: ${logoutText}`);

    // Ignorar erro de logout (pode já estar deslogada)
    if (!logoutResponse.ok && logoutResponse.status !== 404 && logoutResponse.status !== 400) {
      console.warn(`Aviso no logout: ${logoutResponse.status} - continuando mesmo assim`);
    }

    // Aguardar um pouco para a Evolution processar o logout
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Passo 2: Conectar para obter QR Code
    const connectUrl = `${evolutionBaseUrl}/instance/connect/${encodeURIComponent(instanceName)}`;
    
    console.log(`Passo 2: Buscando QR Code: GET ${connectUrl}`);
    
    const qrResponse = await fetch(connectUrl, {
      method: 'GET',
      headers: {
        'apikey': evolutionApiKey,
      },
    });

    const qrResponseText = await qrResponse.text();
    console.log(`QR Response status: ${qrResponse.status}`);
    console.log(`QR Response body: ${qrResponseText.substring(0, 1000)}`);

    if (!qrResponse.ok) {
      console.error(`Evolution API error ao buscar QR: ${qrResponse.status}`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `API retornou ${qrResponse.status}. Verifique se a instância existe.`,
          details: qrResponseText
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    let qrData;
    try {
      qrData = JSON.parse(qrResponseText);
    } catch (e) {
      qrData = {};
    }

    const base64QrCode = qrData?.base64 || qrData?.qrcode?.base64 || null;
    const pairingCode = qrData?.pairingCode || qrData?.code || null;

    console.log(`✓ QR Code obtido: base64=${!!base64QrCode}, pairingCode=${pairingCode || 'N/A'}`);

    return new Response(
      JSON.stringify({ 
        success: true,
        restarted: true,
        instanceName: instanceName,
        base64: base64QrCode,
        pairingCode: pairingCode,
        state: 'connecting',
        qrData: qrData
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error reconnecting Evolution instance:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
