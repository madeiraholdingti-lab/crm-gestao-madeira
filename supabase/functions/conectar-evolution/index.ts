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
    const { instanceId } = await req.json();

    if (!instanceId) {
      return new Response(
        JSON.stringify({ error: "Missing instanceId" }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Connecting instance: ${instanceId}`);

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
    
    // Tentar conectar instância usando GET /instance/connect/{instanceName} primeiro
    // Este método é mais confiável para obter o QR code
    console.log(`Tentando conectar instância: ${instanceId}`);
    const connectUrl = `${evolutionBaseUrl}/instance/connect/${encodeURIComponent(instanceId)}`;
    
    // Tentar primeiro com GET (mais comum na v2)
    let qrResponse = await fetch(connectUrl, {
      method: 'GET',
      headers: {
        'apikey': evolutionApiKey,
      },
    });

    // Se GET falhar com 404 ou 405, tentar com POST
    if (!qrResponse.ok && (qrResponse.status === 404 || qrResponse.status === 405)) {
      console.log(`GET falhou (${qrResponse.status}), tentando com POST...`);
      qrResponse = await fetch(connectUrl, {
        method: 'POST',
        headers: {
          'apikey': evolutionApiKey,
          'Content-Type': 'application/json',
        },
      });
    }

    const responseText = await qrResponse.text();
    console.log(`Response status: ${qrResponse.status}`);
    console.log(`Response body: ${responseText.substring(0, 500)}...`);

    if (!qrResponse.ok) {
      console.error(`Evolution API error: ${qrResponse.status} ${qrResponse.statusText}`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `API retornou ${qrResponse.status}. Verifique se a instância existe e se a URL base está correta.`,
          details: responseText
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      data = { raw: responseText };
    }
    
    console.log(`✓ Conexão iniciada:`, JSON.stringify(data).substring(0, 500));
    
    // Extrair QR code de diferentes formatos de resposta
    const qrCode = data?.pairingCode || data?.code || data?.qr || null;
    const base64QrCode = data?.base64 || data?.qrcode?.base64 || data?.qr?.base64 || null;

    return new Response(
      JSON.stringify({ 
        success: true,
        qrCode: qrCode,
        base64: base64QrCode,
        instanceId: instanceId,
        raw: data
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error connecting Evolution instance:', error);
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
