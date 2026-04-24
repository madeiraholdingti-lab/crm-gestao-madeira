import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";

export type StatusEnvio = "pendente" | "enviado" | "em_conversa" | "qualificado" | "descartado";

export interface EnvioRow {
  id: string;
  campanha_id: string;
  lead_id: string;
  telefone: string;
  status: StatusEnvio;
  erro: string | null;
  tentativas: number;
  enviado_em: string | null;
  respondeu_em: string | null;
  primeira_msg_contato_em: string | null;
  created_at: string;
  lead?: {
    id: string;
    nome: string | null;
    telefone: string;
    especialidade_id: string | null;
    perfil_profissional: string | null;
  } | null;
}

export function useCampanhaEnvios(campanhaId: string | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["campanha-envios", campanhaId],
    enabled: !!campanhaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campanha_envios")
        .select(
          "id, campanha_id, lead_id, telefone, status, erro, tentativas, enviado_em, respondeu_em, primeira_msg_contato_em, created_at, lead:lead_id(id, nome, telefone, especialidade_id, perfil_profissional)"
        )
        .eq("campanha_id", campanhaId!)
        .order("respondeu_em", { ascending: false, nullsFirst: false })
        .order("enviado_em", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data || []) as unknown as EnvioRow[];
    },
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (!campanhaId) return;
    const channel = supabase
      .channel(`campanha-envios-${campanhaId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "campanha_envios", filter: `campanha_id=eq.${campanhaId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["campanha-envios", campanhaId] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [campanhaId, qc]);

  return query;
}
