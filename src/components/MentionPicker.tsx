import { useEffect, useMemo, useRef, useState } from "react";
import { GroupParticipant } from "@/hooks/useGroupParticipants";

interface MentionPickerProps {
  participants: GroupParticipant[];
  query: string;
  onSelect: (participant: GroupParticipant) => void;
  onClose: () => void;
  /** Forwarded keyboard events from the parent textarea (ArrowUp/Down/Enter/Esc). */
  externalKey?: string;
}

const MAX_VISIBLE = 8;

/**
 * Dropdown de menção pra grupo. Abre quando user digita @ no chat.
 * Filtragem case-insensitive em participant_name (fallback: jid se sem nome).
 *
 * Navegação:
 * - ArrowUp/ArrowDown: muda destaque
 * - Enter: confirma seleção
 * - Esc: fecha
 *
 * O parent (ChatInput) controla a visibilidade e propaga eventos de teclado
 * via prop externalKey (estado puxado do onKeyDown do textarea).
 */
export function MentionPicker({ participants, query, onSelect, onClose, externalKey }: MentionPickerProps) {
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return participants.slice(0, 50);
    return participants
      .filter(p => {
        const name = (p.participant_name || "").toLowerCase();
        const jid = p.participant_jid.toLowerCase();
        return name.includes(q) || jid.includes(q);
      })
      .slice(0, 50);
  }, [participants, query]);

  // Reset highlight quando lista muda
  useEffect(() => {
    setHighlight(0);
  }, [query]);

  // Reage a teclas externas (forward do textarea)
  useEffect(() => {
    if (!externalKey) return;
    if (externalKey === "ArrowDown") {
      setHighlight(h => Math.min(h + 1, filtered.length - 1));
    } else if (externalKey === "ArrowUp") {
      setHighlight(h => Math.max(h - 1, 0));
    } else if (externalKey === "Enter") {
      if (filtered[highlight]) onSelect(filtered[highlight]);
    } else if (externalKey === "Escape") {
      onClose();
    }
  }, [externalKey]);

  // Auto-scroll do item destacado
  useEffect(() => {
    const el = containerRef.current?.querySelector(`[data-idx="${highlight}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  if (filtered.length === 0) {
    return (
      <div className="absolute bottom-full left-0 right-0 mb-1 mx-3 bg-popover border rounded-md shadow-lg p-2 text-xs text-muted-foreground">
        Nenhum participante encontrado
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 right-0 mb-1 mx-3 bg-popover border rounded-md shadow-lg max-h-64 overflow-y-auto"
      style={{ maxHeight: `${MAX_VISIBLE * 44}px` }}
    >
      {filtered.map((p, idx) => {
        const phone = p.participant_jid.split("@")[0];
        const name = p.participant_name || phone;
        const isHighlighted = idx === highlight;
        return (
          <button
            key={p.participant_jid}
            type="button"
            data-idx={idx}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent ${
              isHighlighted ? "bg-accent" : ""
            }`}
            onMouseEnter={() => setHighlight(idx)}
            onMouseDown={(e) => {
              // mousedown ao invés de click pra não perder foco do textarea antes de processar
              e.preventDefault();
              onSelect(p);
            }}
          >
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium">
              {name[0]?.toUpperCase() || "?"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="truncate font-medium">{name}</div>
              {p.participant_name && (
                <div className="text-xs text-muted-foreground truncate">{phone}</div>
              )}
            </div>
            {p.is_admin && (
              <span className="text-[10px] uppercase font-semibold text-primary flex-shrink-0">admin</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
