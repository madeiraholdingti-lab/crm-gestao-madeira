import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface InstanciaWhatsApp {
  id: string;
  instancia_id: string;
  nome_instancia: string;
  numero_chip: string | null;
  cor_identificacao: string;
  ativo: boolean;
  status: 'ativa' | 'inativa' | 'deletada';
}

async function fetchInstancias(): Promise<InstanciaWhatsApp[]> {
  const { data, error } = await supabase
    .from("instancias_whatsapp")
    .select("id, instancia_id, nome_instancia, numero_chip, cor_identificacao, ativo, status")
    .neq("status", "deletada")
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data || []) as InstanciaWhatsApp[];
}

export function useInstancias() {
  return useQuery({
    queryKey: ["instancias"],
    queryFn: fetchInstancias,
    staleTime: 5 * 60_000,
  });
}
