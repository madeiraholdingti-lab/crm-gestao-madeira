import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// --- Types ---

export interface HubSummary {
  total_contacts: number;
  classified: number;
  unclassified: number;
  by_profile: { perfil: string; total: number }[];
  by_instance: {
    instance_id: string;
    nome: string;
    cor: string | null;
    contact_count: number;
    conversa_count: number;
  }[];
}

export interface HubActivity {
  active_contacts: number;
  timeline: { date: string; conversations: number }[];
  by_profile_active: { perfil: string; active_count: number }[];
  by_instance_active: {
    instance_name: string;
    cor: string | null;
    active_contacts: number;
    total_conversas: number;
  }[];
}

export interface HubFilterParams {
  perfil?: string | null;
  especialidade?: string | null;
  instituicao?: string | null;
  instance_id?: string | null;
  days?: number | null;
  limit?: number;
  offset?: number;
}

export interface HubFilterContact {
  contact_id: string;
  name: string | null;
  phone: string;
  perfil_profissional: string | null;
  especialidade: string | null;
  instituicao: string | null;
  perfil_confirmado: boolean;
  last_interaction: string | null;
  instance_name: string | null;
  instance_color: string | null;
  conversation_count: number;
}

export interface HubFilterResult {
  total_count: number;
  contacts: HubFilterContact[];
}

// --- Hooks ---

export function useHubSummary() {
  return useQuery<HubSummary>({
    queryKey: ["hub-whatsapp", "summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("hub_contacts_summary" as any);
      if (error) throw error;
      return data as unknown as HubSummary;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useHubActivity(days: number) {
  return useQuery<HubActivity>({
    queryKey: ["hub-whatsapp", "activity", days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("hub_contacts_activity" as any, {
        p_days: days,
      });
      if (error) throw error;
      return data as unknown as HubActivity;
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useHubFilter(params: HubFilterParams, enabled: boolean) {
  return useQuery<HubFilterResult>({
    queryKey: ["hub-whatsapp", "filter", params],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("hub_contacts_filter" as any, {
        p_perfil: params.perfil || null,
        p_especialidade: params.especialidade || null,
        p_instituicao: params.instituicao || null,
        p_instance_id: params.instance_id || null,
        p_days: params.days || null,
        p_limit: params.limit || 50,
        p_offset: params.offset || 0,
      });
      if (error) throw error;
      return data as unknown as HubFilterResult;
    },
    enabled,
  });
}
