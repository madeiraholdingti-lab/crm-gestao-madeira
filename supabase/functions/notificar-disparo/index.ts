import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotificacaoPayload {
  user_id: string;
  tipo: "disparo_agendado_sucesso" | "disparo_massa_concluido" | "disparo_massa_parcial" | "disparo_erro";
  titulo: string;
  mensagem: string;
  dados?: Record<string, unknown>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const payload: NotificacaoPayload = await req.json();
    
    console.log("[NOTIFICAR] Criando notificação:", payload);

    if (!payload.user_id || !payload.tipo || !payload.titulo || !payload.mensagem) {
      return new Response(
        JSON.stringify({ error: "Campos obrigatórios: user_id, tipo, titulo, mensagem" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data, error } = await supabase
      .from("notificacoes")
      .insert({
        user_id: payload.user_id,
        tipo: payload.tipo,
        titulo: payload.titulo,
        mensagem: payload.mensagem,
        dados: payload.dados || null,
        lida: false
      })
      .select()
      .single();

    if (error) {
      console.error("[NOTIFICAR] Erro ao inserir notificação:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[NOTIFICAR] Notificação criada com sucesso:", data.id);

    return new Response(
      JSON.stringify({ success: true, notificacao_id: data.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[NOTIFICAR] Erro geral:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
