import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

const COLUMN_ID = "a2816095-38f9-44f9-9af9-e17ca8a2f5ea";
const ALLOWED_API_KEY = "maikon-taskflow-2026-secure";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Auth via x-api-key header
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey || apiKey !== ALLOWED_API_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Today's date in Brazil timezone
    const now = new Date();
    const brDate = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const todayStr = `${brDate.getFullYear()}-${String(brDate.getMonth() + 1).padStart(2, "0")}-${String(brDate.getDate()).padStart(2, "0")}`;

    // Prazo armazenado como "00h BRT do dia do prazo" = "03h UTC do mesmo dia"
    // Ex: prazo dia 23/04 -> 2026-04-23T03:00:00+00:00
    // Filtro inclusivo nos 2 extremos pra pegar "exatamente hoje":
    // prazo >= 2026-04-23T03:00:00Z  AND  prazo <= 2026-04-23T03:00:00Z
    const startUTC = `${todayStr}T03:00:00+00:00`;
    const tomorrow = new Date(brDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    // endUTC como "00h BRT do dia seguinte" (exclusivo) pra pegar prazo de hoje
    const endUTC = `${tomorrowStr}T03:00:00+00:00`;

    const { data: tasks, error } = await supabase
      .from("task_flow_tasks")
      .select("id, titulo, descricao, prazo, created_at, updated_at")
      .eq("column_id", COLUMN_ID)
      .is("deleted_at", null)
      .gte("prazo", startUTC)
      .lt("prazo", endUTC)
      .order("ordem", { ascending: true });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = (tasks || []).map((t: { titulo: string; descricao: string | null; updated_at: string }) => ({
      titulo: t.titulo,
      descricao: t.descricao || null,
      atualizado_em: t.updated_at,
    }));

    return new Response(
      JSON.stringify({
        data: new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
        total: result.length,
        tarefas: result,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
