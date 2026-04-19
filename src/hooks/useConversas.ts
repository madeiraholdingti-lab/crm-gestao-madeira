import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Contact {
  id: string;
  jid: string;
  phone: string;
  name: string | null;
  profile_picture_url?: string | null;
  perfil_profissional?: string | null;
  especialidade?: string | null;
  instituicao?: string | null;
  perfil_sugerido_ia?: string | null;
  perfil_confirmado?: boolean | null;
}

export interface Conversa {
  id: string;
  contact: Contact;
  instancia_id: string;
  orig_instance_id: string | null;
  current_instance_id: string | null;
  responsavel_atual: string | null;
  ultima_mensagem: string | null;
  ultima_interacao: string | null;
  nome_contato: string | null;
  numero_contato: string;
  foto_contato?: string | null;
  status?: string;
  status_qualificacao?: string;
  tags?: string[];
  unread_count?: number;
  last_message_status?: string;
  last_message_from_me?: boolean;
  fixada?: boolean;
}

const DELETED_INSTANCES_KEY = "DELETED_INSTANCES";

async function fetchConversas(): Promise<Record<string, Conversa[]>> {
  const { data: conversasData, error } = await supabase
    .from("conversas")
    .select(`
      id, contact_id, numero_contato, nome_contato,
      orig_instance_id, current_instance_id, instancia_id,
      responsavel_atual, status, status_qualificacao,
      ultima_mensagem, ultima_interacao, tags, unread_count,
      foto_contato, fixada, last_message_from_me,
      contacts!conversas_contact_id_fkey (
        id, jid, phone, name, profile_picture_url,
        perfil_profissional, especialidade, instituicao,
        perfil_sugerido_ia, perfil_confirmado
      )
    `)
    .not('contact_id', 'is', null)
    .order("ultima_interacao", { ascending: false });

  if (error) throw error;

  const { data: todasInstancias } = await supabase
    .from("instancias_whatsapp")
    .select("id, status, numero_chip");

  const instanciasMap = new Map(
    todasInstancias?.map(i => [i.id, { status: i.status }]) || []
  );

  const grouped: Record<string, Conversa[]> = {};

  (conversasData || []).forEach((conv: any) => {
    const instanceId = conv.current_instance_id || conv.orig_instance_id;
    const instanceData = instanceId ? instanciasMap.get(instanceId) : null;
    const isDeleted = instanceData?.status === 'deletada' || !instanceData;

    const conversa: Conversa = {
      id: conv.id,
      contact: conv.contacts || {
        id: conv.contact_id, phone: conv.numero_contato,
        name: conv.nome_contato, jid: '', profile_picture_url: null
      },
      instancia_id: isDeleted ? DELETED_INSTANCES_KEY : (instanceId || DELETED_INSTANCES_KEY),
      orig_instance_id: conv.orig_instance_id,
      current_instance_id: conv.current_instance_id,
      responsavel_atual: conv.responsavel_atual,
      ultima_mensagem: conv.ultima_mensagem,
      ultima_interacao: conv.ultima_interacao,
      nome_contato: conv.nome_contato,
      numero_contato: conv.numero_contato,
      foto_contato: conv.foto_contato || conv.contacts?.profile_picture_url,
      status: conv.status,
      status_qualificacao: conv.status_qualificacao,
      tags: conv.tags || [],
      unread_count: conv.unread_count || 0,
      last_message_from_me: conv.last_message_from_me ?? undefined,
      fixada: conv.fixada || false
    };

    const groupKey = isDeleted ? DELETED_INSTANCES_KEY : conversa.instancia_id;
    if (!grouped[groupKey]) grouped[groupKey] = [];
    grouped[groupKey].push(conversa);
  });

  return grouped;
}

export function useConversas() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["conversas"],
    queryFn: fetchConversas,
    staleTime: 30_000,
  });

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const channel = supabase
      .channel("conversas-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversas" }, () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["conversas"] });
        }, 2000);
      })
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["conversas"] });
  }, [queryClient]);

  return { ...query, invalidate };
}
