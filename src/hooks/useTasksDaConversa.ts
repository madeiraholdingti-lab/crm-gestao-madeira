import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TaskDaConversa {
  id: string;
  titulo: string;
  descricao: string | null;
  prazo: string | null;
  column_id: string;
  responsavel_id: string | null;
  created_at: string;
}

/**
 * Tasks do TaskFlow vinculadas a uma conversa específica (via conversa_id).
 * Exclui tasks soft-deletadas.
 */
export function useTasksDaConversa(conversaId: string | null | undefined) {
  return useQuery({
    queryKey: ["tasks_da_conversa", conversaId],
    queryFn: async (): Promise<TaskDaConversa[]> => {
      if (!conversaId) return [];
      const { data, error } = await supabase
        .from("task_flow_tasks")
        .select("id, titulo, descricao, prazo, column_id, responsavel_id, created_at")
        .eq("conversa_id", conversaId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!conversaId,
    staleTime: 30_000,
  });
}
