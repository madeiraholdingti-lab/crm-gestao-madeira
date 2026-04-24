import { useMemo } from "react";
import type { EnvioRow, StatusEnvio } from "@/hooks/useCampanhaEnvios";
import LeadKanbanCard from "./LeadKanbanCard";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  envios: EnvioRow[];
  isLoading?: boolean;
}

const COLUNAS: { status: StatusEnvio; label: string; sub: string; cor: string }[] = [
  { status: "pendente",    label: "Frio",       sub: "aguardando disparo",   cor: "bg-slate-50 border-slate-200" },
  { status: "enviado",     label: "Contatado",  sub: "sem resposta",         cor: "bg-blue-50/60 border-blue-200" },
  { status: "em_conversa", label: "Em conversa",sub: "IA ativa",             cor: "bg-indigo-50/60 border-indigo-200" },
  { status: "qualificado", label: "Quente",     sub: "handoff enviado",      cor: "bg-orange-50 border-orange-300" },
  { status: "descartado",  label: "Descartado", sub: "opt-out/recusa",       cor: "bg-gray-50 border-gray-200" },
];

export default function CampanhaKanban({ envios, isLoading }: Props) {
  const grouped = useMemo(() => {
    const g: Record<StatusEnvio, EnvioRow[]> = {
      pendente: [], enviado: [], em_conversa: [], qualificado: [], descartado: [],
    };
    for (const e of envios) {
      if (g[e.status]) g[e.status].push(e);
    }
    return g;
  }, [envios]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
      {COLUNAS.map((col) => {
        const items = grouped[col.status] || [];
        return (
          <div key={col.status} className={"rounded-lg border p-2 flex flex-col " + col.cor}>
            <div className="px-1 pb-2 border-b border-mh-ink-100 mb-2">
              <div className="flex items-center justify-between">
                <span className="font-serif-display text-sm font-semibold">{col.label}</span>
                <span className="text-xs font-serif-display tabular-nums">{items.length}</span>
              </div>
              <div className="text-[10px] text-mh-ink-3 uppercase tracking-wide">{col.sub}</div>
            </div>
            <div className="space-y-2 overflow-y-auto max-h-[60vh] min-h-[120px]">
              {isLoading && Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
              {!isLoading && items.length === 0 && (
                <div className="text-[10px] text-mh-ink-3 italic text-center py-4">vazio</div>
              )}
              {items.map((e) => <LeadKanbanCard key={e.id} envio={e} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
