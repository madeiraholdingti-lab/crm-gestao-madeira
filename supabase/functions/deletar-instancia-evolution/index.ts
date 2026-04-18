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
    console.log('Iniciando deleção de instância na Evolution API');
    
    const { instanceId } = await req.json();
    
    if (!instanceId) {
      console.error('ID da instância não fornecido');
      return new Response(
        JSON.stringify({ success: false, error: 'ID da instância é obrigatório' }),
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
    
    console.log(`[DELEÇÃO PROFUNDA] Iniciando exclusão completa da instância: ${instanceId}`);

    // PASSO 1: Desconectar/Logout primeiro
    const logoutUrl = `${evolutionBaseUrl}/instance/logout/${encodeURIComponent(instanceId)}`;
    console.log(`[PASSO 1] Forçando logout em: ${logoutUrl}`);
    
    try {
      const logoutResponse = await fetch(logoutUrl, {
        method: 'DELETE',
        headers: {
          'apikey': evolutionApiKey,
          'Content-Type': 'application/json',
        },
      });
      console.log(`[PASSO 1] Status logout: ${logoutResponse.status}`);
    } catch (e) {
      console.log("[PASSO 1] Erro ao fazer logout (esperado se já desconectado):", e);
    }

    // PASSO 2: Limpar dados de conexão
    const connectionStateUrl = `${evolutionBaseUrl}/instance/connectionState/${encodeURIComponent(instanceId)}`;
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

    // PASSO 3: Deletar instância completamente (remove todos os dados do disco)
    const deleteUrl = `${evolutionBaseUrl}/instance/delete/${encodeURIComponent(instanceId)}`;
    console.log(`[PASSO 3] Deletando instância permanentemente em: ${deleteUrl}`);

    const response = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        'apikey': evolutionApiKey,
        'Content-Type': 'application/json',
      },
    });

    console.log(`[PASSO 3] Status da deleção: ${response.status}`);
    const responseText = await response.text();
    console.log('[PASSO 3] Resposta da Evolution API:', responseText);

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      data = { raw: responseText };
    }

    if (!response.ok && response.status !== 404) {
      console.error('[ERRO] Falha na deleção da instância:', response.status, data);
      return new Response(
        JSON.stringify({
          success: false,
          error: `Deleção falhou com status ${response.status}`,
          details: JSON.stringify(data)
        }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[DELEÇÃO PROFUNDA] Instância completamente removida (dados + sessão + cache)');
    
    return new Response(
      JSON.stringify({
        success: true,
        message: "Instância completamente deletada e limpa",
        data: data
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
