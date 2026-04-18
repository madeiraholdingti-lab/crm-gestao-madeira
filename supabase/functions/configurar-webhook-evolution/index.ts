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
    const { instanceId, webhookUrlOverride } = await req.json();

    if (!instanceId) {
      return new Response(
        JSON.stringify({ error: "Missing instanceId" }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Configuring webhook for instance: ${instanceId}`);

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
      .select('evolution_base_url, webhook_url, webhook_base64_enabled')
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
    const webhookUrl = webhookUrlOverride || config.webhook_url;
    const webhookBase64Enabled = config.webhook_base64_enabled || false;
    
    if (!webhookUrl) {
      console.error("Webhook URL not configured");
      return new Response(
        JSON.stringify({ error: webhookUrlOverride ? "Webhook URL override is empty" : "Webhook URL not configured in settings" }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }
    
    console.log(`Using webhook URL: ${webhookUrl} (override: ${!!webhookUrlOverride})`);
    
    // Encode o instanceId para preservar espaços e caracteres especiais na URL
    const encodedInstanceId = encodeURIComponent(instanceId);
    const webhookSetUrl = `${evolutionBaseUrl}/webhook/set/${encodedInstanceId}`;

    const webhookConfig = {
      webhook: {
        url: webhookUrl,
        base64: webhookBase64Enabled,
        enabled: true,
        byEvents: false,
        events: [
          // Eventos de conexão
          "QRCODE_UPDATED",
          "CONNECTION_UPDATE",
          // Eventos de mensagens (inclui texto, mídia, áudio, vídeo, documentos)
          "MESSAGES_UPSERT",
          "MESSAGES_UPDATE",
          "MESSAGES_DELETE",
          "SEND_MESSAGE",
          // Eventos de contatos
          "CONTACTS_SET",
          "CONTACTS_UPSERT",
          "CONTACTS_UPDATE",
          // Eventos de chats
          "CHATS_SET",
          "CHATS_UPDATE",
          "CHATS_UPSERT",
          "CHATS_DELETE",
          // Eventos de grupos
          "GROUPS_UPSERT",
          "GROUP_UPDATE",
          "GROUP_PARTICIPANTS_UPDATE",
          // Eventos de presença (digitando, online, etc)
          "PRESENCE_UPDATE"
        ]
      }
    };

    console.log('Webhook config payload:', JSON.stringify(webhookConfig, null, 2));

    const response = await fetch(webhookSetUrl, {
      method: 'POST',
      headers: {
        'apikey': evolutionApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(webhookConfig)
    });

    const responseText = await response.text();
    console.log('Evolution API response status:', response.status);
    console.log('Evolution API response:', responseText);

    if (!response.ok) {
      console.error(`Evolution API error: ${response.status} ${response.statusText}`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `API returned ${response.status}`,
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

    console.log(`Webhook configured successfully for ${instanceId}:`, data);

    return new Response(
      JSON.stringify({ 
        success: true,
        instanceId: instanceId,
        webhookUrl: webhookUrl,
        events: webhookConfig.webhook.events,
        base64Configured: webhookConfig.webhook.base64,
        base64Active: data.webhookBase64 ?? data.base64 ?? webhookConfig.webhook.base64,
        message: "Webhook configured successfully",
        response: data
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error configuring webhook:', error);
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
