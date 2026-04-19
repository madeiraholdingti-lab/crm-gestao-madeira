import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MembroEquipe {
  id: string;
  nome: string;
  cor_perfil: string;
  role: string;
}

/**
 * Retorna os membros da equipe que podem ser atribuídos a uma conversa
 * (médico, secretárias, admin). Não inclui `disparador` porque não
 * atende conversas.
 */
export function useEquipe() {
  return useQuery({
    queryKey: ["equipe"],
    queryFn: async (): Promise<MembroEquipe[]> => {
      // profiles ativos
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, nome, cor_perfil")
        .eq("ativo", true);

      if (profilesError) throw profilesError;
      if (!profiles?.length) return [];

      // cruzar com user_roles pra pegar role
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", profiles.map(p => p.id));

      if (rolesError) throw rolesError;

      const roleMap = new Map(roles?.map(r => [r.user_id, r.role]) || []);

      return profiles
        .map(p => ({
          id: p.id,
          nome: p.nome,
          cor_perfil: p.cor_perfil || "#6B7280",
          role: roleMap.get(p.id) || "",
        }))
        .filter(m => m.role && m.role !== "disparador")
        .sort((a, b) => a.nome.localeCompare(b.nome));
    },
    staleTime: 5 * 60_000, // 5 min — equipe muda raramente
  });
}
