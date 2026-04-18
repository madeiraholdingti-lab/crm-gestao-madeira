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
    console.log('Listando instâncias da Evolution API');
    
    // Buscar configuração (URL e API Key) do banco
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { data: config, error: configError } = await supabase
      .from('config_global')
      .select('evolution_base_url, evolution_api_key')
      .limit(1)
      .maybeSingle();
    
    if (configError || !config) {
      console.error("Error fetching config:", configError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch Evolution API configuration" }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const evolutionApiKey = config.evolution_api_key;
    if (!evolutionApiKey) {
      console.error('EVOLUTION_API_KEY não configurada no banco');
      return new Response(
        JSON.stringify({ success: false, error: 'API Key da Evolution não configurada' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const evolutionBaseUrl = config.evolution_base_url;
    const listUrl = `${evolutionBaseUrl}/instance/fetchInstances`;

    console.log('Fazendo requisição para:', listUrl);

    const response = await fetch(listUrl, {
      method: 'GET',
      headers: {
        'apikey': evolutionApiKey,
        'Content-Type': 'application/json',
      },
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
      console.error('Erro ao listar instâncias:', response.status, data);
      return new Response(
        JSON.stringify({
          success: false,
          error: `API retornou ${response.status}`,
          details: JSON.stringify(data)
        }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Instâncias listadas com sucesso');
    
    return new Response(
      JSON.stringify({
        success: true,
        instances: data
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
