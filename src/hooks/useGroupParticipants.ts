import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface GroupParticipant {
  participant_jid: string;
  participant_name: string | null;
  is_admin: boolean;
}

const SYNC_STALE_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Carrega participantes de um grupo WhatsApp.
 * - Se groupJid não termina em @g.us, retorna [] sem fetch.
 * - Lê cache local da tabela whatsapp_group_participants.
 * - Se sync_em > 24h, dispara sync-grupo-participantes em background.
 */
export function useGroupParticipants(groupJid: string | undefined | null, instance: string | undefined | null) {
  const [participants, setParticipants] = useState<GroupParticipant[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!groupJid || !groupJid.endsWith("@g.us") || !instance) {
      setParticipants([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      // Cache local primeiro
      const { data, error } = await supabase
        .from("whatsapp_group_participants")
        .select("participant_jid, participant_name, is_admin, sync_em")
        .eq("instance", instance)
        .eq("group_jid", groupJid)
        .order("participant_name", { ascending: true, nullsFirst: false });

      if (cancelled) return;
      if (error) {
        console.warn("[useGroupParticipants] erro:", error.message);
        setParticipants([]);
        setLoading(false);
        return;
      }

      const list = (data || []) as Array<GroupParticipant & { sync_em: string | null }>;
      setParticipants(list);
      setLoading(false);

      // Decide se precisa re-sincronizar (sem bloquear UI)
      const ultimaSync = list[0]?.sync_em ? new Date(list[0].sync_em).getTime() : 0;
      const stale = list.length === 0 || Date.now() - ultimaSync > SYNC_STALE_MS;
      if (stale) {
        try {
          await supabase.functions.invoke("sync-grupo-participantes", {
            body: { instance, group_jid: groupJid },
          });
          // Refetch após sync
          const { data: fresh } = await supabase
            .from("whatsapp_group_participants")
            .select("participant_jid, participant_name, is_admin")
            .eq("instance", instance)
            .eq("group_jid", groupJid)
            .order("participant_name", { ascending: true, nullsFirst: false });
          if (!cancelled && fresh) setParticipants(fresh as GroupParticipant[]);
        } catch (e) {
          console.warn("[useGroupParticipants] sync falhou:", e);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [groupJid, instance]);

  return { participants, loading };
}
