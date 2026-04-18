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

    console.log('[restaurar-perfis] Buscando usuários do auth...');

    // Listar todos os usuários do auth
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();

    if (authError) {
      console.error('[restaurar-perfis] Erro ao listar usuários:', authError);
      return new Response(
        JSON.stringify({ error: authError.message }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log('[restaurar-perfis] Usuários encontrados:', authUsers.users.length);

    const results: any[] = [];

    for (const user of authUsers.users) {
      // Verificar se já existe perfil
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle();

      if (existingProfile) {
        console.log('[restaurar-perfis] Perfil já existe para:', user.email);
        results.push({ email: user.email, status: 'already_exists' });
        continue;
      }

      // Criar perfil
      const nome = user.user_metadata?.nome || user.email?.split('@')[0] || 'Usuário';
      const { error: insertError } = await supabase
        .from('profiles')
        .insert({
          id: user.id,
          nome: nome,
          telefone_contato: user.user_metadata?.telefone_contato || null,
          ativo: true,
        });

      if (insertError) {
        console.error('[restaurar-perfis] Erro ao criar perfil para', user.email, ':', insertError);
        results.push({ email: user.email, status: 'error', error: insertError.message });
      } else {
        console.log('[restaurar-perfis] Perfil criado para:', user.email);
        results.push({ email: user.email, status: 'created' });
      }

      // Verificar se já existe role
      const { data: existingRole } = await supabase
        .from('user_roles')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!existingRole) {
        // Criar role padrão (admin_geral para o primeiro usuário, secretaria_medica para os demais)
        // Verificar se é o primeiro usuário (admin)
        const isFirstUser = authUsers.users.indexOf(user) === 0;
        const role = isFirstUser ? 'admin_geral' : 'secretaria_medica';
        
        const { error: roleError } = await supabase
          .from('user_roles')
          .insert({
            user_id: user.id,
            role: role,
          });

        if (roleError) {
          console.error('[restaurar-perfis] Erro ao criar role para', user.email, ':', roleError);
        } else {
          console.log('[restaurar-perfis] Role', role, 'criada para:', user.email);
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        total: authUsers.users.length,
        results 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error('[restaurar-perfis] Erro:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
