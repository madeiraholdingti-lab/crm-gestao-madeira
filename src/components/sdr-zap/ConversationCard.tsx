import { memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { User, MoreVertical, Pin, Clock, Ban, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { getConversaUrgencyColor, getTempoSemResposta } from "@/utils/urgencyHelpers";
import type { Conversa } from "@/hooks/useConversas";

interface ConversationCardProps {
  conversa: Conversa;
  isSelected: boolean;
  corInstancia: string;
  onClick: () => void;
  onPin: (id: string, fixada: boolean) => void;
  onFollowUp: (id: string) => void;
  onBlacklist: (id: string) => void;
  onDelete: (id: string) => void;
}

export const ConversationCard = memo(function ConversationCard({
  conversa, isSelected, corInstancia, onClick, onPin, onFollowUp, onBlacklist, onDelete
}: ConversationCardProps) {
  const urgColor = getConversaUrgencyColor(conversa.last_message_from_me ?? null, conversa.ultima_interacao);
  const tempoResp = conversa.last_message_from_me === false && conversa.ultima_interacao
    ? getTempoSemResposta(conversa.ultima_interacao)
    : null;

  const fotoUrl = conversa.foto_contato || conversa.contact?.profile_picture_url;
  const hasFoto = fotoUrl && fotoUrl !== 'NO_PICTURE';
  const contactName = conversa.contact?.name || conversa.numero_contato?.replace('@s.whatsapp.net', '') || 'Desconhecido';

  return (
    <Card
      className="cursor-pointer transition-all border mb-0.5 overflow-hidden group hover:shadow-sm"
      style={{
        backgroundColor: isSelected ? corInstancia : undefined,
        borderColor: isSelected ? corInstancia : 'var(--border)',
        borderLeftColor: urgColor,
        borderLeftWidth: '4px',
        color: isSelected ? '#ffffff' : undefined,
      }}
      onClick={onClick}
    >
      <CardContent className="p-2.5">
        <div className="flex items-center gap-2.5">
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            {hasFoto ? (
              <img
                src={fotoUrl!}
                alt=""
                className="w-11 h-11 rounded-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center"
                style={{ backgroundColor: isSelected ? '#ffffff20' : `${corInstancia}20` }}
              >
                <User className="h-5 w-5" style={{ color: isSelected ? '#fff' : corInstancia }} />
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Row 1: Name + Time */}
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1 min-w-0 flex-1">
                {conversa.fixada && <Pin className="h-3 w-3 flex-shrink-0 opacity-60" />}
                <span className="text-sm font-semibold truncate">{contactName}</span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {conversa.ultima_interacao && (
                  <span
                    className="text-[11px]"
                    style={{ color: isSelected ? '#ffffffcc' : tempoResp ? urgColor : '#00000066' }}
                  >
                    {format(new Date(conversa.ultima_interacao), "HH:mm", { locale: ptBR })}
                  </span>
                )}
              </div>
            </div>

            {/* Row 2: Preview + Badges */}
            <div className="flex items-center justify-between gap-1 mt-0.5">
              <p
                className="text-xs truncate flex-1"
                style={{ color: isSelected ? '#ffffffaa' : '#00000077' }}
              >
                {conversa.ultima_mensagem || ''}
              </p>
              <div className="flex items-center gap-1 flex-shrink-0">
                {tempoResp && (
                  <span className="text-[10px] font-medium" style={{ color: urgColor }}>
                    {tempoResp}
                  </span>
                )}
                {(conversa.unread_count || 0) > 0 && (
                  <div className="flex items-center justify-center rounded-full min-w-[18px] h-[18px] px-1 text-[10px] font-bold bg-primary text-primary-foreground">
                    {conversa.unread_count! > 99 ? '99+' : conversa.unread_count}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="p-1 rounded hover:bg-black/10" onClick={(e) => e.stopPropagation()}>
                  <MoreVertical className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onPin(conversa.id, !conversa.fixada); }}>
                  <Pin className="h-3.5 w-3.5 mr-2" />
                  {conversa.fixada ? 'Desafixar' : 'Fixar conversa'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onFollowUp(conversa.id); }}>
                  <Clock className="h-3.5 w-3.5 mr-2" />
                  Follow-up
                </DropdownMenuItem>
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onBlacklist(conversa.id); }}>
                  <Ban className="h-3.5 w-3.5 mr-2" />
                  Enviar p/ Blacklist
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={(e) => { e.stopPropagation(); onDelete(conversa.id); }}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                  Excluir conversa
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}, (prev, next) => {
  return prev.conversa.id === next.conversa.id
    && prev.conversa.unread_count === next.conversa.unread_count
    && prev.conversa.ultima_interacao === next.conversa.ultima_interacao
    && prev.conversa.ultima_mensagem === next.conversa.ultima_mensagem
    && prev.conversa.last_message_from_me === next.conversa.last_message_from_me
    && prev.conversa.fixada === next.conversa.fixada
    && prev.isSelected === next.isSelected
    && prev.corInstancia === next.corInstancia;
});
