import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
    const body = await req.json();
    console.log('[CALENDAR-CONFIRMED-CALLBACK] Recebido:', JSON.stringify(body, null, 2));

    // Expected payload from n8n:
    // {
    //   "request_id": "uuid",
    //   "status": "success" | "error",
    //   "event_id": "google_calendar_event_id",
    //   "message": "Evento criado com sucesso",
    //   "event": {
    //     "title": "...",
    //     "start": "...",
    //     "end": "...",
    //     "link": "..." // optional: link to google calendar event
    //   }
    // }

    const { request_id, status, event_id, message, event } = body;

    if (!request_id) {
      console.error('[CALENDAR-CONFIRMED-CALLBACK] request_id ausente');
      return new Response(
        JSON.stringify({ error: 'request_id é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log the callback for debugging
    console.log(`[CALENDAR-CONFIRMED-CALLBACK] request_id: ${request_id}, status: ${status}, event_id: ${event_id}`);

    // Here you could:
    // 1. Store the event in eventos_agenda table
    // 2. Send a WhatsApp confirmation message to the contact
    // 3. Update a pending_events table to mark as confirmed

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Callback de confirmação recebido com sucesso',
        received: {
          request_id,
          status,
          event_id,
          message,
          event
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[CALENDAR-CONFIRMED-CALLBACK] Erro:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(
      JSON.stringify({ error: 'Erro ao processar callback', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
