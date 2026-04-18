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
    console.log('[CALENDAR-VERIFY-CALLBACK] Recebido:', JSON.stringify(body, null, 2));

    // Expected payload from n8n:
    // {
    //   "request_id": "uuid",
    //   "status": "available" | "conflict" | "error",
    //   "message": "Horário disponível" | "Horário ocupado",
    //   "suggested_times": [...] // optional
    //   "data": { ... } // any additional data
    // }

    const { request_id, status, message, suggested_times, data } = body;

    if (!request_id) {
      console.error('[CALENDAR-VERIFY-CALLBACK] request_id ausente');
      return new Response(
        JSON.stringify({ error: 'request_id é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log the callback for debugging
    console.log(`[CALENDAR-VERIFY-CALLBACK] request_id: ${request_id}, status: ${status}`);

    // Here you could store the result in a database table for the frontend to poll
    // For now, we just acknowledge receipt

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Callback de verificação recebido com sucesso',
        received: {
          request_id,
          status,
          message,
          suggested_times,
          data
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[CALENDAR-VERIFY-CALLBACK] Erro:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(
      JSON.stringify({ error: 'Erro ao processar callback', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
