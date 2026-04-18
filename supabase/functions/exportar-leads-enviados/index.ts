import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const allLeads: any[] = [];
  const batchSize = 500;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase.rpc("get_leads_enviados_batch", {
      p_limit: batchSize,
      p_offset: offset,
    });

    if (error) {
      // Fallback: query directly
      const { data: rawData, error: rawError } = await supabase
        .from("campanha_envios")
        .select(`
          telefone,
          status,
          lead_id,
          enviado_em,
          envio_id,
          envios_disparo!campanha_envios_envio_id_fkey (
            instancia_id,
            instancias_whatsapp!envios_disparo_instancia_id_fkey (
              nome_instancia
            )
          )
        `)
        .eq("status", "enviado")
        .range(offset, offset + batchSize - 1);

      if (rawError) {
        return new Response(JSON.stringify({ error: rawError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!rawData || rawData.length === 0) {
        hasMore = false;
        break;
      }

      for (const row of rawData) {
        const instancia = (row as any).envios_disparo?.instancias_whatsapp?.nome_instancia || "Sem instancia";
        allLeads.push({
          numero: row.telefone,
          instancia,
          data_ultimo_envio: row.enviado_em,
          total_envios: 1,
          status_atual: row.status,
          lead_id: row.lead_id,
        });
      }

      if (rawData.length < batchSize) {
        hasMore = false;
      }
      offset += batchSize;
      continue;
    }

    if (!data || data.length === 0) {
      hasMore = false;
      break;
    }
    allLeads.push(...data);
    if (data.length < batchSize) hasMore = false;
    offset += batchSize;
  }

  // Group by telefone+instancia to aggregate
  const grouped = new Map<string, any>();
  for (const lead of allLeads) {
    const key = `${lead.numero}_${lead.instancia}_${lead.lead_id}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.total_envios += 1;
      if (lead.data_ultimo_envio && (!existing.data_ultimo_envio || lead.data_ultimo_envio > existing.data_ultimo_envio)) {
        existing.data_ultimo_envio = lead.data_ultimo_envio;
      }
    } else {
      grouped.set(key, { ...lead });
    }
  }

  const result = {
    leads_enviados: Array.from(grouped.values()),
    total: grouped.size,
  };

  return new Response(JSON.stringify(result, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
