import { useRef, useMemo, useCallback, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ConversationCard } from "./ConversationCard";
import { ConversationFilters } from "./ConversationFilters";
import { DraggableCard } from "@/components/DraggableCard";
import { DroppableColumn } from "@/components/DroppableColumn";
import type { Conversa } from "@/hooks/useConversas";
import type { MembroEquipe } from "@/hooks/useEquipe";

interface ConversationListProps {
  conversas: Conversa[];
  selectedId: string | null;
  getCorInstancia: (conversa: Conversa) => string;
  onSelect: (conversa: Conversa) => void;
  onPin: (id: string, fixada: boolean) => void;
  onFollowUp: (id: string) => void;
  onBlacklist: (id: string) => void;
  onDelete: (id: string) => void;
  onAssign?: (conversaId: string, userId: string | null) => void;
  equipe?: MembroEquipe[];
  currentUserId?: string;
  header?: React.ReactNode;
  dropZoneId?: string;
  draggable?: boolean;
}

type AssignFilter = "all" | "mine" | "unassigned";
const ASSIGN_PILLS: { key: AssignFilter; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "mine", label: "Minhas" },
  { key: "unassigned", label: "Sem dono" },
];

function filtrarPorBusca(lista: Conversa[], busca: string): Conversa[] {
  if (!busca.trim()) return lista;
  const q = busca.toLowerCase();
  const digits = q.replace(/\D/g, '');
  return lista.filter(c => {
    const name = (c.contact?.name || c.nome_contato || '').toLowerCase();
    const phone = (c.contact?.phone || c.numero_contato || '').replace(/\D/g, '');
    return name.includes(q) || (digits && phone.includes(digits));
  });
}

export function ConversationList({
  conversas, selectedId, getCorInstancia, onSelect,
  onPin, onFollowUp, onBlacklist, onDelete, header,
  dropZoneId, draggable, onAssign, equipe, currentUserId
}: ConversationListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [busca, setBusca] = useState("");
  const [filter, setFilter] = useState<"todas" | "nao_lidas" | "aguardando">("todas");
  const [assignFilter, setAssignFilter] = useState<AssignFilter>("all");

  const sorted = useMemo(() => {
    return [...conversas].sort((a, b) => {
      if (a.fixada && !b.fixada) return -1;
      if (!a.fixada && b.fixada) return 1;
      return new Date(b.ultima_interacao || 0).getTime() - new Date(a.ultima_interacao || 0).getTime();
    });
  }, [conversas]);

  const assignFiltered = useMemo(() => {
    if (assignFilter === "mine" && currentUserId) {
      return sorted.filter(c => c.responsavel_atual === currentUserId);
    }
    if (assignFilter === "unassigned") {
      return sorted.filter(c => !c.responsavel_atual);
    }
    return sorted;
  }, [sorted, assignFilter, currentUserId]);

  const searched = useMemo(() => filtrarPorBusca(assignFiltered, busca), [assignFiltered, busca]);

  const filtered = useMemo(() => {
    if (filter === "nao_lidas") return searched.filter(c => (c.unread_count || 0) > 0);
    if (filter === "aguardando") return searched.filter(c => c.last_message_from_me === false);
    return searched;
  }, [searched, filter]);

  const counts = useMemo(() => ({
    todas: searched.length,
    nao_lidas: searched.filter(c => (c.unread_count || 0) > 0).length,
    aguardando: searched.filter(c => c.last_message_from_me === false).length,
  }), [searched]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 68,
    overscan: 8,
  });

  const handleSearchChange = useCallback((v: string) => setBusca(v), []);
  const handleFilterChange = useCallback((f: "todas" | "nao_lidas" | "aguardando") => setFilter(f), []);

  return (
    <div className="flex flex-col h-full">
      {header}
      <ConversationFilters
        onSearchChange={handleSearchChange}
        activeFilter={filter}
        onFilterChange={handleFilterChange}
        counts={counts}
      />
      {/* Pills de atribuição — só aparecem se tem info de equipe */}
      {(currentUserId || equipe?.length) && (
        <div className="flex gap-1 px-2 mt-1">
          {ASSIGN_PILLS.map(pill => {
            const isActive = assignFilter === pill.key;
            const disabled = pill.key === "mine" && !currentUserId;
            return (
              <button
                key={pill.key}
                onClick={() => !disabled && setAssignFilter(pill.key)}
                disabled={disabled}
                className={`text-[10px] px-2 py-0.5 rounded-full transition-colors border
                  ${isActive
                    ? 'bg-accent text-accent-foreground border-accent'
                    : 'bg-transparent border-border text-muted-foreground hover:bg-muted'}
                  ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                {pill.label}
              </button>
            );
          })}
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto mt-1.5 px-1.5">
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">
            {busca ? 'Nenhuma conversa encontrada' : 'Sem conversas'}
          </p>
        ) : (
          (() => {
            const virtualBody = (
              <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                {virtualizer.getVirtualItems().map((virtualItem) => {
                  const conversa = filtered[virtualItem.index];
                  const corInstancia = getCorInstancia(conversa);
                  const card = (
                    <ConversationCard
                      conversa={conversa}
                      isSelected={selectedId === conversa.id}
                      corInstancia={corInstancia}
                      onClick={() => onSelect(conversa)}
                      onPin={onPin}
                      onFollowUp={onFollowUp}
                      onBlacklist={onBlacklist}
                      onDelete={onDelete}
                      onAssign={onAssign}
                      equipe={equipe}
                    />
                  );
                  return (
                    <div
                      key={conversa.id}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                    >
                      {draggable ? (
                        <DraggableCard id={conversa.id} onClick={() => onSelect(conversa)}>
                          {card}
                        </DraggableCard>
                      ) : card}
                    </div>
                  );
                })}
              </div>
            );
            return dropZoneId ? (
              <DroppableColumn id={dropZoneId}>
                {virtualBody}
              </DroppableColumn>
            ) : virtualBody;
          })()
        )}
      </div>
    </div>
  );
}
