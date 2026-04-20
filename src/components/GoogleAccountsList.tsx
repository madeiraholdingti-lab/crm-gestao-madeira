import { useGoogleAccounts } from "@/hooks/useGoogleAccounts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, AlertCircle, Mail, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

/**
 * Lista as contas Google conectadas do usuário logado.
 * Mostra status (ativa/com erro), última sincronização e permite desconectar.
 */
export const GoogleAccountsList = () => {
  const { data: contas, isLoading, disconnect } = useGoogleAccounts();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando contas...
      </div>
    );
  }

  if (!contas || contas.length === 0) {
    return (
      <div className="border border-dashed border-mh-gold-300/50 bg-mh-gold-100/40 rounded-lg p-4 text-center">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-mh-gold-100 border border-mh-gold-300/40 mb-2">
          <Mail className="h-4 w-4 text-mh-gold-700" />
        </div>
        <div className="font-serif-display text-sm font-medium text-mh-ink mb-0.5">
          Nenhum Google Calendar conectado
        </div>
        <p className="text-[11px] text-mh-ink-3 leading-relaxed max-w-xs mx-auto">
          Conecte sua conta pra ver eventos do Google diretamente na agenda do CRM. Sync automático a cada 10 min.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {contas.map((acc) => {
        const temErro = !!acc.last_sync_error;
        const desconectado = !acc.ativo;
        const ultimaSync = acc.last_sync_at
          ? formatDistanceToNow(new Date(acc.last_sync_at), { addSuffix: true, locale: ptBR })
          : "nunca";

        return (
          <div
            key={acc.id}
            className="flex items-center justify-between gap-3 border rounded-md p-3 bg-card"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <Mail className="h-4 w-4 text-mh-navy-700 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{acc.email}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {desconectado ? (
                    <Badge variant="destructive" className="text-[10px]">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      Reconectar
                    </Badge>
                  ) : temErro ? (
                    <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-700">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      Erro na última sync
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] border-mh-teal-500 text-mh-teal-700">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Ativa
                    </Badge>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    Última sync: {ultimaSync}
                  </span>
                </div>
                {temErro && (
                  <p className="text-[10px] text-amber-700 mt-1 truncate" title={acc.last_sync_error ?? ''}>
                    {acc.last_sync_error}
                  </p>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (confirm(`Desconectar ${acc.email}?`)) {
                  disconnect.mutate(acc.id, {
                    onSuccess: () => toast.success("Conta desconectada"),
                    onError: (err) => toast.error(
                      err instanceof Error ? err.message : "Erro ao desconectar"
                    ),
                  });
                }
              }}
              disabled={disconnect.isPending}
              className="flex-shrink-0 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      })}
    </div>
  );
};
