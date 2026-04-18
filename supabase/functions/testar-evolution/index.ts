import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { instanceId, token } = await req.json();

    if (!instanceId || !token) {
      return new Response(
        JSON.stringify({ error: "Missing instanceId or token" }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Testing connection for instance: ${instanceId}`);

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
    const statusUrl = `${evolutionBaseUrl}/instance/connectionState/${encodeURIComponent(instanceId)}`;

    const response = await fetch(statusUrl, {
      method: 'GET',
      headers: {
        'apikey': evolutionApiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`Evolution API error: ${response.status} ${response.statusText}`);
      return new Response(
        JSON.stringify({ 
          connected: false, 
          error: `API returned ${response.status}` 
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const data = await response.json();
    console.log(`Connection status for ${instanceId}:`, data);

    // Verificar se está conectado
    // A estrutura exata depende da API Evolution, ajuste conforme necessário
    const isConnected = data?.state === 'open' || data?.instance?.state === 'open';

    return new Response(
      JSON.stringify({ 
        connected: isConnected,
        state: data?.state || data?.instance?.state,
        instanceId: instanceId
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error testing Evolution connection:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ 
        connected: false, 
        error: errorMessage 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
