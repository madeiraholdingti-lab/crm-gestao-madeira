import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar, Clock } from "lucide-react";
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
  consulta: { label: "Consulta", color: "bg-blue-500" },
  retorno: { label: "Retorno", color: "bg-green-500" },
  reuniao: { label: "Reunião", color: "bg-purple-500" },
  exame: { label: "Exame", color: "bg-orange-500" },
};

const statusConfig = {
  confirmado: { label: "Confirmado", variant: "default" as const },
  pendente: { label: "Pendente", variant: "secondary" as const },
  cancelado: { label: "Cancelado", variant: "destructive" as const },
  concluido: { label: "Concluído", variant: "outline" as const },
};

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
    color: "bg-gray-500",
  };
  
  const statusInfo = statusConfig[status as keyof typeof statusConfig] || {
    label: status,
    variant: "secondary" as const,
  };

  const horaInicio = format(new Date(data_hora_inicio), "HH:mm", { locale: ptBR });
  const horaFim = format(new Date(data_hora_fim), "HH:mm", { locale: ptBR });

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`${tipoConfig.color} w-1 h-full rounded-full flex-shrink-0`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="font-semibold text-sm">
                {horaInicio} - {horaFim}
              </span>
            </div>
            
            <h3 className="font-medium text-base mb-2 truncate">{titulo}</h3>
            
            <div className="flex flex-wrap gap-2 mb-2">
              <Badge variant="outline" className="text-xs">
                {tipoConfig.label}
              </Badge>
              <Badge variant={statusInfo.variant} className="text-xs">
                {statusInfo.label}
              </Badge>
            </div>
            
            {descricao && (
              <p className="text-sm text-muted-foreground line-clamp-2">{descricao}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
