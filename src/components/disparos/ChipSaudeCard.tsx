import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChipSaude {
  instancia_id: string;
  nome_instancia: string;
  numero_chip: string | null;
  cor_identificacao: string | null;
  enviados: number;
  erros: number;
  nozap: number;
  total: number;
  taxa_erro_pct: number;
  ultimo_uso: string | null;
}

/**
 * Card compacto de saúde dos chips — baseado em disparos_logs das últimas 24h.
 * Cores:
 *   🟢 <10% erro
 *   🟡 10-30% erro
 *   🔴 >30% erro (auto-pausado pela função)
 * Se total=0 → "idle" (cinza).
 */
export function ChipSaudeCard() {
  const { data: chips, isLoading } = useQuery({
    queryKey: ["chip-saude-24h"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vw_chip_saude_24h" as never)
        .select("*")
        .order("total", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ChipSaude[];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const getTone = (c: ChipSaude) => {
    if (c.total === 0) return { color: "text-mh-ink-4", bg: "bg-muted/40", label: "Idle", icon: Activity };
    if (c.taxa_erro_pct >= 30) return { color: "text-destructive", bg: "bg-destructive/10", label: "Suspeito", icon: AlertCircle };
    if (c.taxa_erro_pct >= 10) return { color: "text-amber-700", bg: "bg-amber-100", label: "Atenção", icon: AlertCircle };
    return { color: "text-mh-teal-700", bg: "bg-mh-teal-500/10", label: "Saudável", icon: CheckCircle2 };
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-serif-display font-medium flex items-center gap-2">
            <Activity className="h-4 w-4 text-mh-navy-700" />
            Saúde dos chips (24h)
          </CardTitle>
          <span className="text-[10px] font-mono text-mh-ink-4">auto-atualiza a cada 60s</span>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-11" />)}
          </div>
        ) : chips && chips.length > 0 ? (
          <div className="space-y-1.5">
            {chips.map((chip) => {
              const tone = getTone(chip);
              return (
                <div
                  key={chip.instancia_id}
                  className={cn("flex items-center gap-3 px-2.5 py-1.5 rounded-md border border-border/60", tone.bg)}
                >
                  <span
                    className="w-1.5 h-8 rounded-full flex-shrink-0"
                    style={{ backgroundColor: chip.cor_identificacao || "#cbd5e1" }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-mh-ink truncate">
                        {chip.nome_instancia}
                      </span>
                      <tone.icon className={cn("h-3 w-3 flex-shrink-0", tone.color)} />
                      <span className={cn("text-[10px] font-semibold", tone.color)}>
                        {tone.label}
                      </span>
                    </div>
                    {chip.total > 0 && (
                      <div className="flex items-center gap-3 text-[10.5px] text-mh-ink-3 font-mono tabular-nums mt-0.5">
                        <span className="text-mh-teal-700">✓ {chip.enviados}</span>
                        {chip.erros > 0 && <span className="text-destructive">✗ {chip.erros}</span>}
                        {chip.nozap > 0 && <span>∅ {chip.nozap}</span>}
                        <span className="text-mh-ink-4">· {chip.taxa_erro_pct}% erro</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[11px] text-mh-ink-3 italic">Nenhum disparo nas últimas 24h.</p>
        )}
      </CardContent>
    </Card>
  );
}
