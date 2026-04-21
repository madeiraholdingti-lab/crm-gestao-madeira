import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Clock } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface AgendaCardProps {
  titulo: string;
  tipo_evento: string;
  data_hora_inicio: string;
  data_hora_fim: string;
  status: string;
  descricao?: string;
}

const tipoEventoConfig = {
  consulta: { label: "Consulta", color: "bg-mh-navy-700" },
  retorno: { label: "Retorno", color: "bg-mh-teal-600" },
  reuniao: { label: "Reunião", color: "bg-mh-gold-600" },
  exame: { label: "Exame", color: "bg-amber-600" },
};

const statusConfig = {
  confirmado: { label: "Confirmado", variant: "default" as const },
  pendente: { label: "Pendente", variant: "secondary" as const },
  cancelado: { label: "Cancelado", variant: "destructive" as const },
  concluido: { label: "Concluído", variant: "outline" as const },
};

/**
 * Normaliza descrição do Google Calendar:
 * - Converte <br>, </p>, </div> em quebras de linha (depois vira espaço)
 * - Remove tags HTML restantes
 * - Decodifica entidades HTML comuns
 * - Encurta URLs longas (mostra só domínio + ...) pra não expandir o card
 * - Normaliza espaços
 */
function cleanDescription(raw: string): string {
  if (!raw) return "";
  let out = raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li)>/gi, " ")
    .replace(/<[^>]+>/g, "") // remove todas as outras tags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Encurta URLs longas (>45 chars) mantendo só domínio
  out = out.replace(/https?:\/\/(\S{46,})/g, (match) => {
    try {
      const url = new URL(match);
      return `${url.hostname}/…`;
    } catch {
      return match.slice(0, 40) + "…";
    }
  });

  // Normaliza whitespace
  return out.replace(/\s+/g, " ").trim();
}

export const AgendaCard = ({
  titulo,
  tipo_evento,
  data_hora_inicio,
  data_hora_fim,
  status,
  descricao,
}: AgendaCardProps) => {
  const tipoConfig = tipoEventoConfig[tipo_evento as keyof typeof tipoEventoConfig] || {
    label: tipo_evento,
    color: "bg-mh-ink-3",
  };

  const statusInfo = statusConfig[status as keyof typeof statusConfig] || {
    label: status,
    variant: "secondary" as const,
  };

  const horaInicio = format(new Date(data_hora_inicio), "HH:mm", { locale: ptBR });
  const horaFim = format(new Date(data_hora_fim), "HH:mm", { locale: ptBR });
  const descricaoLimpa = descricao ? cleanDescription(descricao) : "";

  return (
    <Card className="hover:shadow-md transition-shadow overflow-hidden">
      <CardContent className="p-3 overflow-hidden">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className={`${tipoConfig.color} w-1 self-stretch rounded-full flex-shrink-0`} />
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="flex items-center gap-1.5 mb-1 text-mh-ink-3">
              <Clock className="h-3 w-3 flex-shrink-0" />
              <span className="font-mono text-[11px] font-semibold tabular-nums">
                {horaInicio} – {horaFim}
              </span>
            </div>

            <h3 className="font-serif-display font-medium text-[15px] leading-tight mb-1.5 break-words text-mh-ink">
              {titulo}
            </h3>

            <div className="flex flex-wrap gap-1.5 mb-1.5">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                {tipoConfig.label}
              </Badge>
              <Badge variant={statusInfo.variant} className="text-[10px] px-1.5 py-0 h-4">
                {statusInfo.label}
              </Badge>
            </div>

            {descricaoLimpa && (
              <p
                className="text-[11.5px] text-mh-ink-3 line-clamp-2 leading-snug"
                style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                title={descricaoLimpa}
              >
                {descricaoLimpa}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
