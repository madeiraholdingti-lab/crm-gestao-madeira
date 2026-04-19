import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const agora = new Date();
    const inicioHoje = new Date(
      agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
    );
    inicioHoje.setHours(0, 0, 0, 0);

    const { data: pendentes } = await supabase
      .from("conversas")
      .select(
        "id, responsavel_atual, ultima_interacao, ultima_mensagem, nome_contato, numero_contato, status"
      )
      .eq("last_message_from_me", false)
      .in("status", ["novo", "Aguardando Contato", "Em Atendimento"])
      .not("responsavel_atual", "is", null)
      .order("ultima_interacao", { ascending: true });

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, nome")
      .eq("ativo", true);

    const profileMap = new Map(
      (profiles || []).map((p: any) => [p.id, p.nome])
    );

    const porResponsavel: Record<
      string,
      { nome: string; user_id: string; pendentes: any[]; total: number }
    > = {};

    for (const conv of pendentes || []) {
      const userId = conv.responsavel_atual!;
      if (!porResponsavel[userId]) {
        porResponsavel[userId] = {
          nome: profileMap.get(userId) || "Desconhecido",
          user_id: userId,
          pendentes: [],
          total: 0,
        };
      }

      const tempoMin = conv.ultima_interacao
        ? Math.floor(
            (agora.getTime() - new Date(conv.ultima_interacao).getTime()) /
              60000
          )
        : 9999;

      const urgencia =
        tempoMin > 240 ? "urgente" : tempoMin > 120 ? "atencao" : "normal";

      porResponsavel[userId].pendentes.push({
        nome_contato: conv.nome_contato || conv.numero_contato,
        ultima_mensagem: (conv.ultima_mensagem || "").substring(0, 100),
        tempo_minutos: tempoMin,
        urgencia,
      });
      porResponsavel[userId].total++;
    }

    const { count: respondidasHoje } = await supabase
      .from("conversas")
      .select("id", { count: "exact", head: true })
      .eq("last_message_from_me", true)
      .gte("ultima_interacao", inicioHoje.toISOString());

    const resultado = {
      gerado_em: agora.toISOString(),
      por_responsavel: Object.values(porResponsavel).sort(
        (a, b) => b.total - a.total
      ),
      total_respondidas_hoje: respondidasHoje || 0,
      total_aguardando: (pendentes || []).length,
    };

    return new Response(JSON.stringify(resultado, null, 2), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Erro desconhecido",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
