import { useRef, useMemo, useCallback, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ConversationCard } from "./ConversationCard";
import { ConversationFilters } from "./ConversationFilters";
import type { Conversa } from "@/hooks/useConversas";

interface ConversationListProps {
  conversas: Conversa[];
  selectedId: string | null;
  corInstancia: string;
  onSelect: (conversa: Conversa) => void;
  onPin: (id: string, fixada: boolean) => void;
  onFollowUp: (id: string) => void;
  onBlacklist: (id: string) => void;
  onDelete: (id: string) => void;
  header?: React.ReactNode;
}

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
  conversas, selectedId, corInstancia, onSelect,
  onPin, onFollowUp, onBlacklist, onDelete, header
}: ConversationListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [busca, setBusca] = useState("");
  const [filter, setFilter] = useState<"todas" | "nao_lidas" | "aguardando">("todas");

  const sorted = useMemo(() => {
    return [...conversas].sort((a, b) => {
      if (a.fixada && !b.fixada) return -1;
      if (!a.fixada && b.fixada) return 1;
      return new Date(b.ultima_interacao || 0).getTime() - new Date(a.ultima_interacao || 0).getTime();
    });
  }, [conversas]);

  const searched = useMemo(() => filtrarPorBusca(sorted, busca), [sorted, busca]);

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
      <div ref={scrollRef} className="flex-1 overflow-y-auto mt-1.5 px-1.5">
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">
            {busca ? 'Nenhuma conversa encontrada' : 'Sem conversas'}
          </p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const conversa = filtered[virtualItem.index];
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
                  <ConversationCard
                    conversa={conversa}
                    isSelected={selectedId === conversa.id}
                    corInstancia={corInstancia}
                    onClick={() => onSelect(conversa)}
                    onPin={onPin}
                    onFollowUp={onFollowUp}
                    onBlacklist={onBlacklist}
                    onDelete={onDelete}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
