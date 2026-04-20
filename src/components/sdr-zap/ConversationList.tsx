import { useRef, useMemo, useCallback, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ConversationCard } from "./ConversationCard";
import { ConversationFilters, type AssignFilter, type StatusFilter } from "./ConversationFilters";
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
  onIgnore?: (id: string, jaIgnorada: boolean) => void;
  equipe?: MembroEquipe[];
  currentUserId?: string;
  header?: React.ReactNode;
  dropZoneId?: string;
  draggable?: boolean;
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
  conversas, selectedId, getCorInstancia, onSelect,
  onPin, onFollowUp, onBlacklist, onDelete, header,
  dropZoneId, draggable, onAssign, onIgnore, equipe, currentUserId
}: ConversationListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [busca, setBusca] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("todas");
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

  // Ignoradas só aparecem quando o filtro é "ignoradas". Nos outros 3 filtros
  // (Todas/Não lidas/Aguardando) ficam escondidas — essa é a dor que o Maikon
  // levantou: "não quero ver vendedor de móveis aqui batendo toda hora".
  const visiveisNosFiltrosNormais = useMemo(
    () => searched.filter(c => !c.ignorada_em),
    [searched]
  );

  const filtered = useMemo(() => {
    if (filter === "ignoradas") return searched.filter(c => !!c.ignorada_em);
    if (filter === "nao_lidas") return visiveisNosFiltrosNormais.filter(c => (c.unread_count || 0) > 0);
    if (filter === "aguardando") return visiveisNosFiltrosNormais.filter(c => c.last_message_from_me === false);
    return visiveisNosFiltrosNormais;
  }, [searched, visiveisNosFiltrosNormais, filter]);

  const counts = useMemo(() => ({
    todas: visiveisNosFiltrosNormais.length,
    nao_lidas: visiveisNosFiltrosNormais.filter(c => (c.unread_count || 0) > 0).length,
    aguardando: visiveisNosFiltrosNormais.filter(c => c.last_message_from_me === false).length,
    ignoradas: searched.filter(c => !!c.ignorada_em).length,
  }), [searched, visiveisNosFiltrosNormais]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 68,
    overscan: 8,
  });

  const handleSearchChange = useCallback((v: string) => setBusca(v), []);
  const handleFilterChange = useCallback((f: StatusFilter) => setFilter(f), []);
  const handleAssignFilterChange = useCallback((f: AssignFilter) => setAssignFilter(f), []);

  const hasAssignFeature = !!(currentUserId || equipe?.length);

  return (
    <div className="flex flex-col h-full">
      {header}
      <ConversationFilters
        onSearchChange={handleSearchChange}
        activeFilter={filter}
        onFilterChange={handleFilterChange}
        counts={counts}
        showAssignFilter={hasAssignFeature}
        assignFilter={assignFilter}
        onAssignFilterChange={handleAssignFilterChange}
        canUseMine={!!currentUserId}
      />
      <div ref={scrollRef} className="flex-1 overflow-y-auto mt-1.5 px-1.5">
        {filtered.length === 0 ? (
          <div className="py-8 px-3 text-center">
            {busca ? (
              <>
                <div className="font-serif-display text-sm font-medium text-mh-ink mb-1">
                  Nenhuma conversa
                </div>
                <p className="text-[11px] text-mh-ink-3 leading-snug">
                  Nada encontrado para &ldquo;{busca}&rdquo;.
                </p>
              </>
            ) : filter === "ignoradas" ? (
              <>
                <div className="font-serif-display text-sm font-medium text-mh-ink mb-1">
                  Nenhuma ignorada
                </div>
                <p className="text-[11px] text-mh-ink-3 leading-snug">
                  Use &ldquo;Ignorar&rdquo; no menu de uma conversa pra afastá-la da lista principal.
                </p>
              </>
            ) : (
              <>
                <div className="font-serif-display text-sm font-medium text-mh-ink mb-1">
                  Caixa vazia
                </div>
                <p className="text-[11px] text-mh-ink-3 leading-snug">
                  Assim que chegar uma mensagem no WhatsApp conectado, ela aparece aqui.
                </p>
              </>
            )}
          </div>
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
                      onIgnore={onIgnore}
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
