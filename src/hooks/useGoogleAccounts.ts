import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface GoogleAccount {
  id: string;
  email: string;
  ativo: boolean;
  last_sync_at: string | null;
  last_sync_error: string | null;
  created_at: string;
}

/**
 * Retorna contas Google conectadas do user logado (RLS filtra por user_id).
 * Também expõe:
 *  - disconnect(id): deleta a conta
 *  - connect(): chama edge function google-oauth-init e redireciona o browser
 *    pra URL de consentimento do Google
 */
export function useGoogleAccounts() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["google_accounts"],
    queryFn: async (): Promise<GoogleAccount[]> => {
      const { data, error } = await supabase
        .from("google_accounts")
        .select("id, email, ativo, last_sync_at, last_sync_error, created_at")
        .order("created_at");
      if (error) throw error;
      return (data || []) as GoogleAccount[];
    },
    staleTime: 30_000,
  });

  const disconnect = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("google_accounts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["google_accounts"] }),
  });

  /**
   * Inicia o fluxo OAuth. Invoca a edge function que retorna a URL de
   * consentimento e redireciona a janela atual pra ela.
   */
  const connect = async () => {
    const { data, error } = await supabase.functions.invoke("google-oauth-init");
    if (error) throw error;
    const url = (data as { url?: string })?.url;
    if (!url) throw new Error("URL de consentimento não retornada");
    window.location.href = url;
  };

  return { ...query, disconnect, connect };
}
