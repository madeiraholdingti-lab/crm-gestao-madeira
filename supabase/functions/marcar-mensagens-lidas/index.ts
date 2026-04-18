import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { conversaId } = await req.json();

    if (!conversaId) {
      return new Response(
        JSON.stringify({ error: 'conversaId é obrigatório' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Marcando mensagens como lidas para conversa: ${conversaId}`);

    // Marcar todas as mensagens recebidas como lidas
    const { error: updateError } = await supabase
      .from('mensagens')
      .update({ 
        lida: true,
        status: 'READ'
      })
      .eq('conversa_id', conversaId)
      .eq('remetente', 'recebida')
      .eq('lida', false);

    if (updateError) {
      console.error('Erro ao atualizar mensagens:', updateError);
      throw updateError;
    }

    // Zerar o contador de não lidas na conversa
    const { error: conversaError } = await supabase
      .from('conversas')
      .update({ unread_count: 0 })
      .eq('id', conversaId);

    if (conversaError) {
      console.error('Erro ao atualizar contador:', conversaError);
      throw conversaError;
    }

    console.log('Mensagens marcadas como lidas com sucesso');

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Mensagens marcadas como lidas' 
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Erro ao marcar mensagens como lidas:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
