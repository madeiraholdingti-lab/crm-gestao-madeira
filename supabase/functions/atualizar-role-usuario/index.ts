import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const { userId, role } = await req.json();

    if (!userId || !role) {
      return new Response(
        JSON.stringify({ error: 'userId e role são obrigatórios' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Validar role
    const validRoles = ['admin_geral', 'medico', 'secretaria_medica', 'administrativo', 'disparador'];
    if (!validRoles.includes(role)) {
      return new Response(
        JSON.stringify({ error: 'Role inválida' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log('[atualizar-role-usuario] Atualizando role:', { userId, role });

    // Verificar se já existe uma role para o usuário
    const { data: existingRole, error: fetchError } = await supabase
      .from('user_roles')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('[atualizar-role-usuario] Erro ao buscar role:', fetchError);
      throw fetchError;
    }

    if (existingRole) {
      // Atualizar role existente
      const { error: updateError } = await supabase
        .from('user_roles')
        .update({ role })
        .eq('user_id', userId);

      if (updateError) {
        console.error('[atualizar-role-usuario] Erro ao atualizar role:', updateError);
        throw updateError;
      }
    } else {
      // Criar nova role
      const { error: insertError } = await supabase
        .from('user_roles')
        .insert({ user_id: userId, role });

      if (insertError) {
        console.error('[atualizar-role-usuario] Erro ao inserir role:', insertError);
        throw insertError;
      }
    }

    console.log('[atualizar-role-usuario] Role atualizada com sucesso');

    return new Response(
      JSON.stringify({ success: true, message: 'Role atualizada com sucesso' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error('[atualizar-role-usuario] Erro:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
