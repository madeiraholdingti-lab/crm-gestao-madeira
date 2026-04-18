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

    const { email, password, nome, telefone_contato, role, instancia_padrao_id } = await req.json();

    if (!email || !password || !nome) {
      return new Response(
        JSON.stringify({ error: 'Email, senha e nome são obrigatórios' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Validar role
    const validRoles = ['admin_geral', 'medico', 'secretaria_medica', 'administrativo', 'disparador'];
    const userRole = role && validRoles.includes(role) ? role : 'secretaria_medica';

    console.log('[criar-usuario] Criando usuário:', { email, nome, role: userRole });

    // Criar usuário no auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirma o email
      user_metadata: {
        nome,
        telefone_contato,
        funcao: userRole
      }
    });

    if (authError) {
      console.error('[criar-usuario] Erro ao criar usuário:', authError);
      
      // Mensagens de erro amigáveis
      if (authError.message.includes('already been registered')) {
        return new Response(
          JSON.stringify({ error: 'Este email já está cadastrado' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }
      
      return new Response(
        JSON.stringify({ error: authError.message }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const userId = authData.user?.id;

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'Erro ao obter ID do usuário' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // Atualizar instância padrão se fornecida (o trigger já cria o profile)
    if (instancia_padrao_id) {
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ instancia_padrao_id })
        .eq('id', userId);

      if (profileError) {
        console.error('[criar-usuario] Erro ao atualizar instância:', profileError);
      }
    }

    console.log('[criar-usuario] Usuário criado com sucesso:', userId);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Usuário criado com sucesso',
        userId 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error('[criar-usuario] Erro:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
