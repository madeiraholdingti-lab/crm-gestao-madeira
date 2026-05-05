import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Monitor de saúde da conexão Realtime.
 * Cria um canal heartbeat dedicado e observa transições de status.
 * Marca "degradado" se ficar fora de SUBSCRIBED por > thresholdMs.
 *
 * Uso típico:
 *   const { status, degraded, lastChange } = useRealtimeHealth();
 *   if (degraded) <Banner />
 */
export function useRealtimeHealth(thresholdMs = 30_000) {
  const [status, setStatus] = useState<string>("CONNECTING");
  const [degraded, setDegraded] = useState(false);
  const [lastChange, setLastChange] = useState<number>(Date.now());

  useEffect(() => {
    const channel = supabase.channel("realtime-health-heartbeat");
    const handleStatus = (s: string) => {
      setStatus(s);
      setLastChange(Date.now());
      if (s === "SUBSCRIBED") setDegraded(false);
    };
    channel.subscribe(handleStatus);

    // Polling pra marcar degradado se ficar fora de SUBSCRIBED muito tempo
    const interval = setInterval(() => {
      if (status !== "SUBSCRIBED" && Date.now() - lastChange > thresholdMs) {
        setDegraded(true);
      }
    }, 5_000);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thresholdMs]);

  return { status, degraded, lastChange };
}
