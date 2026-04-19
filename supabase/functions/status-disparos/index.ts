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
    const evolutionApiKey = Deno.env.get("EVOLUTION_API_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: config } = await supabase
      .from("config_global")
      .select("evolution_base_url, evolution_api_key")
      .single();

    const evolutionBaseUrl = config?.evolution_base_url || "";
    const evoKey = config?.evolution_api_key || evolutionApiKey;

    // 1. Status das instâncias WhatsApp
    const { data: instancias } = await supabase
      .from("instancias_whatsapp")
      .select("id, nome_instancia, instancia_id, ativa");

    const conectadas: string[] = [];
    const desconectadas: string[] = [];
    const problemas: string[] = [];

    for (const inst of instancias || []) {
      if (!inst.ativa) {
        desconectadas.push(inst.nome_instancia);
        continue;
      }

      try {
        const resp = await fetch(
          `${evolutionBaseUrl}/instance/connectionState/${encodeURIComponent(inst.nome_instancia)}`,
          { headers: { apikey: evoKey } }
        );
        const data = await resp.json();
        const state = data?.instance?.state || data?.state || "unknown";

        if (state === "open") {
          conectadas.push(inst.nome_instancia);
        } else {
          desconectadas.push(inst.nome_instancia);
          problemas.push(
            `${inst.nome_instancia} desconectada (estado: ${state})`
          );
        }
      } catch {
        desconectadas.push(inst.nome_instancia);
        problemas.push(`${inst.nome_instancia} - erro ao verificar conexão`);
      }
    }

    // 2. Status das campanhas
    const { data: campanhas } = await supabase
      .from("campanhas_disparo")
      .select("id, nome, status, instancia_whatsapp_id")
      .in("status", ["ativa", "agendada", "pausada"]);

    const instMap: Record<string, string> = {};
    for (const inst of instancias || []) {
      instMap[inst.id] = inst.nome_instancia;
    }

    const campanhasStatus = [];
    for (const c of campanhas || []) {
      const { count: enviados } = await supabase
        .from("campanha_envios")
        .select("id", { count: "exact", head: true })
        .eq("campanha_id", c.id)
        .eq("status", "enviado");

      const { count: pendentes } = await supabase
        .from("campanha_envios")
        .select("id", { count: "exact", head: true })
        .eq("campanha_id", c.id)
        .eq("status", "pendente");

      const { count: erros } = await supabase
        .from("campanha_envios")
        .select("id", { count: "exact", head: true })
        .eq("campanha_id", c.id)
        .in("status", ["erro", "falha"]);

      const whatsappNome = instMap[c.instancia_whatsapp_id] || "N/A";
      const whatsappDesconectado = desconectadas.includes(whatsappNome);

      let diagnostico = null;
      if (whatsappDesconectado) {
        diagnostico = `WhatsApp "${whatsappNome}" está desconectado`;
        if (!problemas.some((p) => p.includes(c.nome))) {
          problemas.push(
            `Campanha "${c.nome}" usa WhatsApp desconectado (${whatsappNome})`
          );
        }
      } else if ((erros || 0) > 0) {
        diagnostico = `${erros} envios com erro`;
      }

      campanhasStatus.push({
        nome: c.nome,
        status: c.status,
        whatsapp: whatsappNome,
        enviados: enviados || 0,
        pendentes: pendentes || 0,
        erros: erros || 0,
        diagnostico,
      });
    }

    const resultado = {
      whatsapp: {
        total: (instancias || []).length,
        conectadas,
        desconectadas,
      },
      campanhas: campanhasStatus,
      problemas,
      gerado_em: new Date().toISOString(),
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
