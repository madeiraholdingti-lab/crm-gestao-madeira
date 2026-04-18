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

    const evolutionApiKey = Deno.env.get('EVOLUTION_API_KEY');
    
    if (!evolutionApiKey) {
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
    
    console.log(`[LIMPEZA AGRESSIVA] Iniciando limpeza completa da instância: ${instanceName}`);

    // PASSO 1: Desconectar sessão (logout)
    const logoutUrl = `${evolutionBaseUrl}/instance/logout/${encodeURIComponent(instanceName)}`;
    console.log(`[PASSO 1] Executando logout em: ${logoutUrl}`);

    const logoutResponse = await fetch(logoutUrl, {
      method: 'DELETE',
      headers: {
        'apikey': evolutionApiKey,
        'Content-Type': 'application/json',
      },
    });

    console.log(`[PASSO 1] Status logout: ${logoutResponse.status}`);
    
    let logoutData;
    try {
      logoutData = await logoutResponse.json();
      console.log("[PASSO 1] Resposta logout:", logoutData);
    } catch (e) {
      console.log("[PASSO 1] Sem resposta JSON do logout");
    }

    // PASSO 2: Limpar dados de conexão (connectionState) - forçar remoção de dados corrompidos
    const connectionStateUrl = `${evolutionBaseUrl}/instance/connectionState/${encodeURIComponent(instanceName)}`;
    console.log(`[PASSO 2] Limpando estado de conexão em: ${connectionStateUrl}`);
    
    try {
      const connectionStateResponse = await fetch(connectionStateUrl, {
        method: 'DELETE',
        headers: {
          'apikey': evolutionApiKey,
          'Content-Type': 'application/json',
        },
      });
      console.log(`[PASSO 2] Status limpeza de estado: ${connectionStateResponse.status}`);
    } catch (e) {
      console.log("[PASSO 2] Erro ao limpar estado (esperado se não existir):", e);
    }

    // PASSO 3: Tentar limpar dados de sessão do disco (se o endpoint existir)
    const restartUrl = `${evolutionBaseUrl}/instance/restart/${encodeURIComponent(instanceName)}`;
    console.log(`[PASSO 3] Tentando forçar restart (limpeza de cache) em: ${restartUrl}`);
    
    try {
      const restartResponse = await fetch(restartUrl, {
        method: 'PUT',
        headers: {
          'apikey': evolutionApiKey,
          'Content-Type': 'application/json',
        },
      });
      console.log(`[PASSO 3] Status restart: ${restartResponse.status}`);
    } catch (e) {
      console.log("[PASSO 3] Erro ao forçar restart (esperado se não existir):", e);
    }

    console.log("[LIMPEZA AGRESSIVA] Sequência de limpeza completa executada");

    // Verificar se ao menos o logout foi bem-sucedido
    if (!logoutResponse.ok && logoutResponse.status !== 404) {
      console.error(`[ERRO] Falha crítica no logout: ${logoutResponse.status}`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Logout falhou com status ${logoutResponse.status}`,
          details: logoutData
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Instância desconectada e limpa com sucesso",
        data: {
          logout: logoutData,
          cleanupCompleted: true
        }
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("Erro ao desconectar:", errorMessage);
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
