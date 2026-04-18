import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("[calendar-webhook] Recebido:", JSON.stringify(body, null, 2));

    const { tipo, subtipo } = body;

    if (tipo !== "calendar") {
      return new Response(
        JSON.stringify({ success: false, error: "Tipo inválido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Buscar URL do webhook da config_global
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: configData, error: configError } = await supabase
      .from("config_global")
      .select("webhook_url")
      .limit(1)
      .single();

    if (configError || !configData?.webhook_url) {
      console.error("[calendar-webhook] Erro ao buscar webhook_url:", configError);
      return new Response(
        JSON.stringify({ success: false, error: "Webhook URL não configurada" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const webhookUrl = configData.webhook_url;
    console.log("[calendar-webhook] Enviando para webhook:", webhookUrl);

    // Enviar para o webhook n8n
    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text();
      console.error("[calendar-webhook] Webhook retornou erro:", webhookResponse.status, errorText);
      
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Webhook retornou erro: ${webhookResponse.status}`,
          details: errorText
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let webhookData;
    const responseText = await webhookResponse.text();
    console.log("[calendar-webhook] Resposta bruta do webhook:", responseText);
    
    try {
      webhookData = JSON.parse(responseText);
      console.log("[calendar-webhook] Resposta do webhook parseada:", JSON.stringify(webhookData, null, 2));
    } catch (e) {
      console.error("[calendar-webhook] Resposta não é JSON válido:", responseText);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Webhook retornou resposta inválida (não é JSON)" 
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify(webhookData),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("[calendar-webhook] Erro:", error);
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
