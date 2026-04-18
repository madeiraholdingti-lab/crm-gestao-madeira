import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  campanhaId?: string;
  currentEnvioId?: string;
  filterTipoLead?: string;
  filterEspecialidade?: string;
  filterBusca?: string;
  page?: number;
  perPage?: number;
}

interface LeadRow {
  id: string;
  nome: string | null;
  telefone: string;
  tipo_lead: string | null;
  especialidade_id: string | null;
}

async function fetchAll<T>(fetchPage: (from: number, to: number) => Promise<T[]>, pageSize = 5000) {
  const rows: T[] = [];
  for (let from = 0; from < 200000; from += pageSize) {
    const batch = await fetchPage(from, from + pageSize - 1);
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const {
      campanhaId,
      currentEnvioId,
      filterTipoLead,
      filterEspecialidade,
      filterBusca,
      page = 1,
      perPage = 500,
    }: RequestBody = await req.json();

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!campanhaId) {
      return new Response(
        JSON.stringify({ leads: [], total: 0, especialidades: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [blacklistRows, campanhaRows, cooldownRows, candidateLeads] = await Promise.all([
      fetchAll<{ lead_id: string }>(async (from, to) => {
        const { data, error } = await adminClient
          .from("lead_blacklist")
          .select("lead_id")
          .range(from, to);
        if (error) throw error;
        return data || [];
      }),
      fetchAll<{ lead_id: string; envio_id: string | null }>(async (from, to) => {
        const { data, error } = await adminClient
          .from("campanha_envios")
          .select("lead_id, envio_id")
          .eq("campanha_id", campanhaId)
          .range(from, to);
        if (error) throw error;
        return data || [];
      }),
      fetchAll<{ lead_id: string; campanha_id: string }>(async (from, to) => {
        const { data, error } = await adminClient
          .from("campanha_envios")
          .select("lead_id, campanha_id")
          .gte("created_at", seteDiasAtras)
          .range(from, to);
        if (error) throw error;
        return data || [];
      }),
      fetchAll<LeadRow>(async (from, to) => {
        let query = adminClient
          .from("leads")
          .select("id, nome, telefone, tipo_lead, especialidade_id")
          .eq("ativo", true)
          .order("created_at", { ascending: false });

        if (filterTipoLead) {
          query = query.eq("tipo_lead", filterTipoLead);
        }

        if (filterBusca?.trim()) {
          const escaped = filterBusca.trim().replace(/[%(),]/g, " ");
          query = query.or(`nome.ilike.%${escaped}%,telefone.ilike.%${escaped}%`);
        }

        const { data, error } = await query.range(from, to);
        if (error) throw error;
        return (data || []) as LeadRow[];
      }),
    ]);

    // Fetch especialidades catalog
    const { data: espCatalog } = await adminClient
      .from("especialidades")
      .select("id, nome")
      .order("nome");
    const espMap = new Map<string, string>();
    for (const e of (espCatalog || [])) {
      espMap.set(e.id, e.nome);
    }

    const leadsNaBlacklist = new Set(blacklistRows.map((row) => row.lead_id));
    const leadsJaNaCampanha = new Set(
      campanhaRows
        .filter((row) => !(currentEnvioId && row.envio_id === currentEnvioId))
        .map((row) => row.lead_id)
    );
    const leadsEmCooldown = new Set(
      cooldownRows
        .filter((row) => row.campanha_id !== campanhaId)
        .map((row) => row.lead_id)
    );

    const disponiveisBase = candidateLeads.filter(
      (lead) =>
        !leadsNaBlacklist.has(lead.id) &&
        !leadsJaNaCampanha.has(lead.id) &&
        !leadsEmCooldown.has(lead.id)
    );

    const especialidadeCounts = new Map<string, number>();
    for (const lead of disponiveisBase) {
      if (!lead.especialidade_id) continue;
      especialidadeCounts.set(lead.especialidade_id, (especialidadeCounts.get(lead.especialidade_id) || 0) + 1);
    }

    const especialidades = Array.from(especialidadeCounts.entries())
      .map(([id, count]) => ({ id, nome: espMap.get(id) || id, count }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));

    const disponiveis = filterEspecialidade
      ? disponiveisBase.filter((lead) => lead.especialidade_id === filterEspecialidade)
      : disponiveisBase;

    const total = disponiveis.length;
    const start = Math.max(0, (page - 1) * perPage);
    const pagedLeads = disponiveis.slice(start, start + perPage);

    return new Response(
      JSON.stringify({
        leads: pagedLeads,
        total,
        especialidades,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[listar-leads-disparo] erro:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro interno" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});