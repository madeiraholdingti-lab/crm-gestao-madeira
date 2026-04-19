// Edge function google-oauth-init
// Inicia o fluxo OAuth2 do Google Calendar pro user autenticado.
// Retorna a URL de consentimento que o frontend usa pra redirecionar.
//
// Chamado via:
//   supabase.functions.invoke('google-oauth-init')
// Retorno:
//   { url: 'https://accounts.google.com/o/oauth2/v2/auth?...' }
//   O frontend faz window.location.href = url.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { create as createJWT, getNumericDate } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function buildSigningKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
    const redirectUri = Deno.env.get('GOOGLE_OAUTH_REDIRECT_URI');
    const encryptionKey = Deno.env.get('GOOGLE_TOKEN_ENCRYPTION_KEY');

    if (!clientId || !redirectUri || !encryptionKey) {
      console.error('[google-oauth-init] Secrets faltando');
      return new Response(
        JSON.stringify({ error: 'Integração Google não configurada no servidor' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Validar o user autenticado via o JWT do cliente
    const authHeader = req.headers.get('Authorization') || '';
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await supabaseUser.auth.getUser();

    if (userError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: 'Usuário não autenticado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Gerar state JWT curto contendo user_id + nonce (valido 10 min)
    const key = await buildSigningKey(encryptionKey);
    const nonce = crypto.randomUUID();
    const state = await createJWT(
      { alg: 'HS256', typ: 'JWT' },
      {
        user_id: userData.user.id,
        nonce,
        exp: getNumericDate(60 * 10),
      },
      key,
    );

    // Montar URL de consentimento do Google
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email https://www.googleapis.com/auth/calendar.readonly',
      access_type: 'offline',
      prompt: 'consent',
      state,
      include_granted_scopes: 'true',
    });

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    console.log('[google-oauth-init] Gerou URL de consentimento para user', userData.user.id);

    return new Response(
      JSON.stringify({ url }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[google-oauth-init] Erro:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
