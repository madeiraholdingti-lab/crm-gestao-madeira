import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { userId, email } = await req.json();

    if (!userId && !email) {
      return new Response(
        JSON.stringify({ error: 'userId ou email é obrigatório' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log('[reset-user-password] Enviando email de reset para:', email || userId);

    // Se temos email, envia diretamente
    if (email) {
      // Usar origin do header ou fallback para URL do projeto
      const origin = req.headers.get('origin') || 'https://b9709d56-c22f-4b80-a524-79be4e8ae5de.lovableproject.com';
      const redirectUrl = `${origin}/auth/reset`;
      
      console.log('[reset-user-password] Redirect URL:', redirectUrl);
      
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl,
      });

      if (error) {
        console.error('[reset-user-password] Erro ao enviar reset:', error);
        return new Response(
          JSON.stringify({ error: error.message }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }
    } else {
      // Buscar email do usuário pelo ID
      const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
      
      if (userError || !userData.user?.email) {
        console.error('[reset-user-password] Erro ao buscar usuário:', userError);
        return new Response(
          JSON.stringify({ error: 'Usuário não encontrado' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
        );
      }

      // Usar origin do header ou fallback para URL do projeto
      const origin = req.headers.get('origin') || 'https://b9709d56-c22f-4b80-a524-79be4e8ae5de.lovableproject.com';
      const redirectUrl = `${origin}/auth/reset`;
      
      console.log('[reset-user-password] Redirect URL:', redirectUrl);
      
      const { error } = await supabase.auth.resetPasswordForEmail(userData.user.email, {
        redirectTo: redirectUrl,
      });

      if (error) {
        console.error('[reset-user-password] Erro ao enviar reset:', error);
        return new Response(
          JSON.stringify({ error: error.message }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }
    }

    console.log('[reset-user-password] Email de reset enviado com sucesso');

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Email de redefinição de senha enviado com sucesso' 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error('[reset-user-password] Erro:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
