// Edge function google-oauth-callback
// Recebe o redirect do Google após consentimento do usuário.
// Troca o code por tokens, pega o email, persiste em google_accounts com
// tokens criptografados, e redireciona o browser de volta pro /perfil.
//
// URL configurada em redirect_uri: https://<project>.supabase.co/functions/v1/google-oauth-callback
//
// Google envia GET ?code=<authcode>&state=<jwt>&scope=...

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verify as verifyJWT } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';

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

function redirectToFrontend(frontendBase: string, params: Record<string, string>): Response {
  const qs = new URLSearchParams(params).toString();
  const location = `${frontendBase}/perfil?${qs}`;
  return new Response(null, {
    status: 302,
    headers: { Location: location, ...corsHeaders },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  const redirectUri = Deno.env.get('GOOGLE_OAUTH_REDIRECT_URI');
  const encryptionKey = Deno.env.get('GOOGLE_TOKEN_ENCRYPTION_KEY');
  const frontendBase = Deno.env.get('APP_FRONTEND_URL') || 'http://localhost:5173';
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  if (!clientId || !clientSecret || !redirectUri || !encryptionKey) {
    console.error('[google-oauth-callback] Secrets faltando');
    return redirectToFrontend(frontendBase, { google_status: 'error', reason: 'missing_env' });
  }

  try {
    // 1. Parsear code + state
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const googleError = url.searchParams.get('error');

    if (googleError) {
      console.error('[google-oauth-callback] Google retornou erro:', googleError);
      return redirectToFrontend(frontendBase, { google_status: 'error', reason: googleError });
    }
    if (!code || !state) {
      return redirectToFrontend(frontendBase, { google_status: 'error', reason: 'missing_params' });
    }

    // 2. Validar state JWT
    const key = await buildSigningKey(encryptionKey);
    let payload: { user_id: string; nonce: string; exp: number };
    try {
      payload = await verifyJWT(state, key) as typeof payload;
    } catch (_err) {
      return redirectToFrontend(frontendBase, { google_status: 'error', reason: 'invalid_state' });
    }
    const userId = payload.user_id;
    if (!userId) {
      return redirectToFrontend(frontendBase, { google_status: 'error', reason: 'invalid_state' });
    }

    // 3. Trocar code por tokens
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      console.error('[google-oauth-callback] Token exchange falhou:', tokenResp.status, errText);
      return redirectToFrontend(frontendBase, { google_status: 'error', reason: 'token_exchange_failed' });
    }

    const tokenData = await tokenResp.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
      id_token?: string;
    };

    if (!tokenData.refresh_token) {
      // Sem refresh_token: usuário provavelmente já tinha autorizado antes e Google não reemite.
      // Recomendar revogar em https://myaccount.google.com/permissions e tentar de novo.
      console.warn('[google-oauth-callback] Google não retornou refresh_token');
      return redirectToFrontend(frontendBase, { google_status: 'error', reason: 'no_refresh_token' });
    }

    // 4. Buscar email via userinfo
    const userInfoResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userInfoResp.ok) {
      console.error('[google-oauth-callback] userinfo falhou:', userInfoResp.status);
      return redirectToFrontend(frontendBase, { google_status: 'error', reason: 'userinfo_failed' });
    }
    const userInfo = await userInfoResp.json() as { email: string; verified_email?: boolean };
    const email = userInfo.email;
    if (!email) {
      return redirectToFrontend(frontendBase, { google_status: 'error', reason: 'no_email' });
    }

    // 5. UPSERT em google_accounts com tokens criptografados
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    // Usar SQL direto pra aproveitar pgp_sym_encrypt. Fazer via RPC temporária.
    const { error: sqlError } = await supabase.rpc('upsert_google_account', {
      p_user_id: userId,
      p_email: email,
      p_refresh_token: tokenData.refresh_token,
      p_access_token: tokenData.access_token,
      p_expires_at: expiresAt,
      p_scopes: tokenData.scope,
      p_encryption_key: encryptionKey,
    });

    if (sqlError) {
      console.error('[google-oauth-callback] UPSERT falhou:', sqlError);
      return redirectToFrontend(frontendBase, { google_status: 'error', reason: 'db_upsert_failed' });
    }

    console.log(`[google-oauth-callback] Conta conectada: ${email} para user ${userId}`);

    return redirectToFrontend(frontendBase, {
      google_status: 'connected',
      email,
    });
  } catch (err) {
    console.error('[google-oauth-callback] Erro geral:', err);
    return redirectToFrontend(frontendBase, {
      google_status: 'error',
      reason: 'unexpected',
    });
  }
});
