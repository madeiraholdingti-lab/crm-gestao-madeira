import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MetricasCampanha {
  campanha_id: string;
  nome: string;
  tipo: string | null;
  campanha_status: string | null;
  created_at: string;
  mensagem_inicial: string | null;
  envios_por_dia: number | null;
  total_envios: number;
  pendentes: number;
  enviados: number;
  em_conversa: number;
  qualificados: number;
  descartados: number;
  responderam: number;
  enviados_hoje: number;
  respostas_hoje: number;
  com_erro: number;
  ultimo_envio: string | null;
  ultima_resposta: string | null;
  taxa_resposta_pct: number;
  taxa_qualificacao_pct: number;
}

export function useMetricasCampanhas(statusFilter?: string) {
  return useQuery({
    queryKey: ["metricas-campanhas", statusFilter || "todas"],
    queryFn: async () => {
      let q = supabase
        .from("vw_metricas_campanha")
        .select("*")
        .order("ultimo_envio", { ascending: false, nullsFirst: false });

      if (statusFilter && statusFilter !== "todas") {
        q = q.eq("campanha_status", statusFilter);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as MetricasCampanha[];
    },
    refetchInterval: 60000,
  });
}
