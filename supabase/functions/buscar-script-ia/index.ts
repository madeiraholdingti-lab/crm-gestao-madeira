import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const scriptId = url.searchParams.get("id");

    if (!scriptId) {
      return new Response(
        JSON.stringify({ error: "Parâmetro 'id' é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Buscar script
    const { data: script, error: scriptError } = await supabase
      .from("ia_scripts")
      .select("id, nome, descricao_vaga, tipo_vaga, presencial, necessario_mudar, detalhes_vaga, ativo")
      .eq("id", scriptId)
      .single();

    if (scriptError || !script) {
      return new Response(
        JSON.stringify({ error: "Script não encontrado", detail: scriptError?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Buscar perguntas do script
    const { data: perguntas } = await supabase
      .from("ia_script_perguntas")
      .select("id, pergunta, ordem, obrigatoria")
      .eq("script_id", scriptId)
      .order("ordem", { ascending: true });

    return new Response(
      JSON.stringify({ ...script, perguntas: perguntas || [] }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Erro interno", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
