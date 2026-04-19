// Edge function google-calendar-sync
// Chamada pelo pg_cron a cada 10min (ou manualmente).
// Para cada conta Google ativa, puxa eventos dos próximos 60 dias da API do
// Google Calendar e faz UPSERT em eventos_agenda (origem='google_sync').
//
// Fluxo por conta:
//   1. Decripta refresh_token e access_token via RPC
//   2. Se access_token expirado (<5min de vida), faz refresh via Google
//   3. GET calendar/v3/calendars/primary/events
//   4. UPSERT cada evento; DELETE os com status=cancelled
//   5. Atualiza last_sync_at / last_sync_error

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_EVENTS_URL =
  'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const SYNC_WINDOW_DAYS = 60;
const REFRESH_BUFFER_SECONDS = 300; // refresh se falta <5min pra expirar

interface GoogleAccount {
  id: string;
  user_id: string;
  email: string;
  refresh_token: string;
  access_token: string;
  expires_at: string | null;
}

interface GoogleEvent {
  id: string;
  status: string; // 'confirmed', 'tentative', 'cancelled'
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  updated?: string;
}

function isoStart(ev: GoogleEvent): string | null {
  const s = ev.start;
  if (!s) return null;
  if (s.dateTime) return s.dateTime;
  if (s.date) return `${s.date}T00:00:00-03:00`; // all-day — assume BRT
  return null;
}

function isoEnd(ev: GoogleEvent): string | null {
  const e = ev.end;
  if (!e) return null;
  if (e.dateTime) return e.dateTime;
  if (e.date) return `${e.date}T23:59:59-03:00`;
  return null;
}

async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<{ access_token: string; expires_in: number } | { error: string }> {
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }).toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    return { error: `refresh_failed_${resp.status}: ${text.slice(0, 200)}` };
  }
  return await resp.json();
}

async function fetchEventsForAccount(
  accessToken: string,
  windowDays: number,
): Promise<{ items: GoogleEvent[] } | { error: string }> {
  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + windowDays * 24 * 3600 * 1000).toISOString();

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '2500',
  });

  const resp = await fetch(`${GOOGLE_EVENTS_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const text = await resp.text();
    return { error: `events_list_${resp.status}: ${text.slice(0, 200)}` };
  }
  return await resp.json();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
    const encryptionKey = Deno.env.get('GOOGLE_TOKEN_ENCRYPTION_KEY');

    if (!clientId || !clientSecret || !encryptionKey) {
      console.error('[google-calendar-sync] Secrets faltando');
      return new Response(
        JSON.stringify({ error: 'Integração Google não configurada' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 1) Pegar contas ativas com tokens decriptados
    const { data: accounts, error: rpcError } = await supabase.rpc(
      'get_active_google_accounts_decrypted',
      { key: encryptionKey },
    );

    if (rpcError) {
      console.error('[google-calendar-sync] RPC decrypt falhou:', rpcError);
      return new Response(
        JSON.stringify({ error: rpcError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const accountList = (accounts || []) as GoogleAccount[];
    console.log(`[google-calendar-sync] Processando ${accountList.length} contas ativas`);

    let syncedCount = 0;
    let errorCount = 0;
    const results: any[] = [];

    // 2) Processar cada conta
    for (const acc of accountList) {
      let accessToken = acc.access_token;

      // 2.1) Verificar se precisa refresh
      const expiresAt = acc.expires_at ? new Date(acc.expires_at).getTime() : 0;
      const needsRefresh = !accessToken || expiresAt < Date.now() + REFRESH_BUFFER_SECONDS * 1000;

      if (needsRefresh) {
        console.log(`[google-calendar-sync] Refreshing token ${acc.email}`);
        const refreshed = await refreshAccessToken(acc.refresh_token, clientId, clientSecret);
        if ('error' in refreshed) {
          console.error(`[google-calendar-sync] Refresh falhou p/ ${acc.email}:`, refreshed.error);
          await supabase
            .from('google_accounts')
            .update({
              ativo: false,
              last_sync_error: refreshed.error.slice(0, 500),
              last_sync_at: new Date().toISOString(),
            })
            .eq('id', acc.id);
          errorCount++;
          results.push({ email: acc.email, status: 'refresh_failed', error: refreshed.error });
          continue;
        }
        accessToken = refreshed.access_token;
        const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
        await supabase.rpc('update_google_account_tokens', {
          p_account_id: acc.id,
          p_access_token: accessToken,
          p_expires_at: newExpiresAt,
          p_encryption_key: encryptionKey,
        });
      }

      // 2.2) Listar eventos
      const eventsResp = await fetchEventsForAccount(accessToken, SYNC_WINDOW_DAYS);
      if ('error' in eventsResp) {
        console.error(`[google-calendar-sync] Events list falhou p/ ${acc.email}:`, eventsResp.error);
        await supabase
          .from('google_accounts')
          .update({
            last_sync_error: eventsResp.error.slice(0, 500),
            last_sync_at: new Date().toISOString(),
          })
          .eq('id', acc.id);
        errorCount++;
        results.push({ email: acc.email, status: 'events_failed', error: eventsResp.error });
        continue;
      }

      const items = eventsResp.items || [];
      let upserted = 0;
      let deleted = 0;

      // 2.3) UPSERT/DELETE por evento
      for (const ev of items) {
        if (ev.status === 'cancelled') {
          const { error: delError } = await supabase
            .from('eventos_agenda')
            .delete()
            .eq('google_account_id', acc.id)
            .eq('google_event_id', ev.id);
          if (!delError) deleted++;
          continue;
        }

        const start = isoStart(ev);
        const end = isoEnd(ev);
        if (!start || !end) continue;

        const tz = ev.start?.timeZone || 'America/Sao_Paulo';

        const { error: upError } = await supabase
          .from('eventos_agenda')
          .upsert(
            {
              titulo: ev.summary || '(Sem título)',
              descricao: ev.description || null,
              tipo_evento: 'consulta',
              data_hora_inicio: start,
              data_hora_fim: end,
              timezone: tz,
              medico_id: acc.user_id,
              status: 'confirmado',
              origem: 'google_sync',
              google_event_id: ev.id,
              google_account_id: acc.id,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'google_account_id,google_event_id' },
          );

        if (upError) {
          console.error(`[google-calendar-sync] UPSERT falhou ev=${ev.id}:`, upError);
        } else {
          upserted++;
        }
      }

      // 2.4) Marcar sync sucesso
      await supabase
        .from('google_accounts')
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_error: null,
        })
        .eq('id', acc.id);

      syncedCount++;
      results.push({
        email: acc.email,
        status: 'ok',
        eventos_total: items.length,
        upserted,
        deleted,
      });

      console.log(`[google-calendar-sync] ${acc.email}: ${upserted} upserted, ${deleted} deleted`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        contas_processadas: accountList.length,
        sincronizadas: syncedCount,
        com_erro: errorCount,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[google-calendar-sync] Erro geral:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
