import { AlertCircle } from "lucide-react";
import { useRealtimeHealth } from "@/hooks/useRealtimeHealth";

/**
 * Banner global de aviso quando a conexão Realtime degrada.
 * Renderizar uma vez no shell da aplicação (AppLayout ou página de Conversas).
 */
export function RealtimeHealthBanner() {
  const { degraded, status } = useRealtimeHealth();
  if (!degraded) return null;

  return (
    <div className="bg-amber-100 border-b border-amber-300 px-4 py-2 text-sm text-amber-900 flex items-center gap-2">
      <AlertCircle className="h-4 w-4 flex-shrink-0" />
      <span>
        <strong>Conexão em tempo real degradada.</strong> Mensagens novas podem demorar a aparecer.
        Status: <code className="text-xs">{status}</code>. Tente recarregar a página se persistir.
      </span>
    </div>
  );
}
