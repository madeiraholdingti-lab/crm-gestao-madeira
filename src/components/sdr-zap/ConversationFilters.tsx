import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface FilterCounts {
  todas: number;
  nao_lidas: number;
  aguardando: number;
  ignoradas: number;
}

export type StatusFilter = "todas" | "nao_lidas" | "aguardando" | "ignoradas";
export type AssignFilter = "all" | "mine" | "unassigned";

interface ConversationFiltersProps {
  onSearchChange: (value: string) => void;
  activeFilter: StatusFilter;
  onFilterChange: (filter: StatusFilter) => void;
  counts: FilterCounts;
  placeholder?: string;
  // Filtros de atribuição (opcionais — só aparecem se `showAssignFilter` for true)
  assignFilter?: AssignFilter;
  onAssignFilterChange?: (filter: AssignFilter) => void;
  showAssignFilter?: boolean;
  canUseMine?: boolean; // desabilita "Minhas" se não houver user logado
}

const STATUS_PILLS: { key: StatusFilter; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "nao_lidas", label: "Não lidas" },
  { key: "aguardando", label: "Aguardando" },
  { key: "ignoradas", label: "Ignoradas" },
];

const ASSIGN_PILLS: { key: AssignFilter; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "mine", label: "Minhas" },
  { key: "unassigned", label: "Sem dono" },
];

/**
 * Filtros da lista de conversas consolidados em 2 linhas:
 *   1) Search (largura total)
 *   2) Segmented control unificado: status + (opcional) atribuição, com divisor
 *
 * Antes eram 5 linhas de controles competindo pela atenção. Redução de densidade
 * segundo heurística de minimalismo + recognition over recall.
 */
export function ConversationFilters({
  onSearchChange,
  activeFilter,
  onFilterChange,
  counts,
  placeholder = "Pesquisar...",
  assignFilter,
  onAssignFilterChange,
  showAssignFilter = false,
  canUseMine = true,
}: ConversationFiltersProps) {
  const [localSearch, setLocalSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => onSearchChange(localSearch), 300);
    return () => clearTimeout(timer);
  }, [localSearch, onSearchChange]);

  return (
    <div className="space-y-1.5 px-2">
      {/* Linha 1: search */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          placeholder={placeholder}
          className="pl-7 h-8 text-xs"
        />
      </div>

      {/* Linha 2: segmented control unificado (scroll horizontal se não couber) */}
      <div className="flex items-center gap-1 overflow-x-auto pb-0.5 -mx-0.5 px-0.5 scrollbar-none">
        {STATUS_PILLS.map((pill) => {
          const count = counts[pill.key];
          const isActive = activeFilter === pill.key;
          return (
            <button
              key={pill.key}
              onClick={() => onFilterChange(pill.key)}
              className={`text-[11px] px-2.5 py-1 rounded-full transition-colors flex items-center gap-1 flex-shrink-0
                ${isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-transparent border border-border text-muted-foreground hover:bg-muted'
                }`}
            >
              {pill.label}
              {pill.key !== "todas" && count > 0 && (
                <span className={`inline-flex items-center justify-center rounded-full min-w-[16px] h-4 px-1 text-[9px] font-bold
                  ${isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-destructive text-destructive-foreground'}`}
                >
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </button>
          );
        })}

        {/* Divisor + filtros de atribuição (se habilitado) */}
        {showAssignFilter && onAssignFilterChange && (
          <>
            <div className="h-4 w-px bg-border mx-1 flex-shrink-0" aria-hidden />
            {ASSIGN_PILLS.map((pill) => {
              const isActive = assignFilter === pill.key;
              const disabled = pill.key === "mine" && !canUseMine;
              return (
                <button
                  key={pill.key}
                  onClick={() => !disabled && onAssignFilterChange(pill.key)}
                  disabled={disabled}
                  className={`text-[11px] px-2.5 py-1 rounded-full transition-colors flex-shrink-0
                    ${isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'bg-transparent border border-border text-muted-foreground hover:bg-muted'}
                    ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  {pill.label}
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
