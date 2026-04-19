import { useState, useEffect, useCallback } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface FilterCounts {
  todas: number;
  nao_lidas: number;
  aguardando: number;
}

interface ConversationFiltersProps {
  onSearchChange: (value: string) => void;
  activeFilter: "todas" | "nao_lidas" | "aguardando";
  onFilterChange: (filter: "todas" | "nao_lidas" | "aguardando") => void;
  counts: FilterCounts;
  placeholder?: string;
}

const PILLS: { key: "todas" | "nao_lidas" | "aguardando"; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "nao_lidas", label: "Não lidas" },
  { key: "aguardando", label: "Aguardando" },
];

export function ConversationFilters({
  onSearchChange, activeFilter, onFilterChange, counts, placeholder = "Pesquisar..."
}: ConversationFiltersProps) {
  const [localSearch, setLocalSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => onSearchChange(localSearch), 300);
    return () => clearTimeout(timer);
  }, [localSearch, onSearchChange]);

  return (
    <div className="space-y-1.5 px-2">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          placeholder={placeholder}
          className="pl-7 h-8 text-xs"
        />
      </div>
      <div className="flex gap-1">
        {PILLS.map((pill) => {
          const count = counts[pill.key];
          const isActive = activeFilter === pill.key;
          return (
            <button
              key={pill.key}
              onClick={() => onFilterChange(pill.key)}
              className={`text-[11px] px-2.5 py-1 rounded-full transition-colors flex items-center gap-1
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
      </div>
    </div>
  );
}
