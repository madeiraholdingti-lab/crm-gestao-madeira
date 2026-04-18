import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TransferirConversaPayload {
  conversaId: string;
  novaInstanciaId?: string;
  novoResponsavelId?: string;
  anotacao?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const payload: TransferirConversaPayload = await req.json();
    const { conversaId, novaInstanciaId, novoResponsavelId, anotacao } = payload;

    console.log('[notificar-transferencia] Payload recebido:', payload);

    if (!conversaId) {
      return new Response(
        JSON.stringify({ error: 'conversaId é obrigatório' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Buscar informações da conversa
    const { data: conversa, error: conversaError } = await supabase
      .from('conversas')
      .select(`
        id,
        numero_contato,
        nome_contato,
        orig_instance_id,
        current_instance_id,
        responsavel_atual
      `)
      .eq('id', conversaId)
      .single();

    if (conversaError || !conversa) {
      console.error('[notificar-transferencia] Erro ao buscar conversa:', conversaError);
      return new Response(
        JSON.stringify({ error: 'Conversa não encontrada' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }

    // Preparar dados para atualização
    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    if (novaInstanciaId !== undefined) {
      updateData.current_instance_id = novaInstanciaId;
    }

    if (novoResponsavelId !== undefined) {
      updateData.responsavel_atual = novoResponsavelId;
    }

    if (anotacao !== undefined) {
      updateData.anotacao_transferencia = anotacao;
    }

    // Atualizar conversa
    const { error: updateError } = await supabase
      .from('conversas')
      .update(updateData)
      .eq('id', conversaId);

    if (updateError) {
      console.error('[notificar-transferencia] Erro ao atualizar conversa:', updateError);
      return new Response(
        JSON.stringify({ error: 'Erro ao transferir conversa' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    console.log('[notificar-transferencia] Conversa transferida com sucesso');

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Conversa transferida com sucesso',
        conversaId,
        updates: updateData
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error('[notificar-transferencia] Erro:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
