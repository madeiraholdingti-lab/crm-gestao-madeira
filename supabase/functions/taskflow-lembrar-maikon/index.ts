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

    // Pega TODAS as tarefas na coluna "Lembrar Dr. Maikon" (sem filtro de prazo):
    // a intenção é que enquanto a task estiver nessa coluna, é pra lembrar o Maikon
    // todo dia até alguém tirar de lá. Se tiver prazo, mostramos pra ele priorizar.
    // Ordena por prazo ASC (prazos mais próximos primeiro, sem prazo no fim).
    // Limita a 30 pra não inundar a msg (coluna tem acumulado se ficar sem gestão).
    const { data: tasks, error } = await supabase
      .from("task_flow_tasks")
      .select("id, titulo, descricao, prazo, created_at")
      .eq("column_id", COLUMN_ID)
      .is("deleted_at", null)
      .order("prazo", { ascending: true, nullsFirst: false })
      .limit(30);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Helper: classifica urgência do prazo relativo a hoje
    const now = new Date();
    const hojeBRT = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    hojeBRT.setHours(0, 0, 0, 0);
    const amanhaBRT = new Date(hojeBRT); amanhaBRT.setDate(amanhaBRT.getDate() + 1);

    const result = (tasks || []).map((t: { titulo: string; descricao: string | null; prazo: string | null }) => {
      let prazo_label: string | null = null;
      let urgencia: "atrasada" | "hoje" | "amanha" | "futura" | "sem_prazo" = "sem_prazo";
      if (t.prazo) {
        // Prazo é armazenado como "midnight do dia do prazo em BRT" (ex: prazo dia 23/04 vira 2026-04-23T03:00:00Z)
        // Extrai o dia BRT diretamente via toLocaleDateString com TZ
        const prazoDate = new Date(t.prazo);
        // Pega ano/mes/dia em BRT
        const prazoBRTStr = prazoDate.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); // YYYY-MM-DD
        const [ano, mes, dia] = prazoBRTStr.split("-").map(Number);
        const prazoDia = new Date(ano, mes - 1, dia);
        if (prazoDia < hojeBRT) urgencia = "atrasada";
        else if (prazoDia.getTime() === hojeBRT.getTime()) urgencia = "hoje";
        else if (prazoDia.getTime() === amanhaBRT.getTime()) urgencia = "amanha";
        else urgencia = "futura";
        prazo_label = `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}`;
      }
      return {
        titulo: t.titulo,
        descricao: t.descricao || null,
        prazo: t.prazo,
        prazo_label,
        urgencia,
      };
    });

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
