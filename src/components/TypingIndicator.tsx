import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface TypingIndicatorProps {
  conversaId: string;
  initialLastTypingAt?: string | null;
}

const TYPING_TIMEOUT_MS = 5_000;

/**
 * Indicador "digitando..." baseado em conversas.last_typing_at.
 * Backend (evolution-messages-webhook) processa presence.update da Evolution
 * e atualiza last_typing_at. Aqui assinamos UPDATE realtime da conversa
 * específica e renderizamos enquanto < 5s desde último composing.
 */
export function TypingIndicator({ conversaId, initialLastTypingAt }: TypingIndicatorProps) {
  const [lastTypingAt, setLastTypingAt] = useState<number | null>(
    initialLastTypingAt ? new Date(initialLastTypingAt).getTime() : null
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setLastTypingAt(initialLastTypingAt ? new Date(initialLastTypingAt).getTime() : null);
  }, [initialLastTypingAt]);

  useEffect(() => {
    if (!conversaId) return;
    const channel = supabase
      .channel(`typing-${conversaId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversas", filter: `id=eq.${conversaId}` },
        (payload) => {
          const next = (payload.new as { last_typing_at?: string | null })?.last_typing_at;
          setLastTypingAt(next ? new Date(next).getTime() : null);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversaId]);

  // Tick a cada 1s pra invalidar quando passar do timeout
  useEffect(() => {
    if (!lastTypingAt) return;
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [lastTypingAt]);

  const ativo = lastTypingAt && now - lastTypingAt < TYPING_TIMEOUT_MS;
  if (!ativo) return null;

  return (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 italic">
      digitando
      <span className="inline-flex gap-[2px]">
        <span className="w-1 h-1 rounded-full bg-emerald-600 animate-bounce" style={{ animationDelay: "0ms" }} />
        <span className="w-1 h-1 rounded-full bg-emerald-600 animate-bounce" style={{ animationDelay: "150ms" }} />
        <span className="w-1 h-1 rounded-full bg-emerald-600 animate-bounce" style={{ animationDelay: "300ms" }} />
      </span>
    </span>
  );
}
