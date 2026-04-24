import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronRight, Edit, Play, Pause, TrendingUp, MessageSquare, Flame, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { MetricasCampanha } from "@/hooks/useMetricasCampanha";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Props {
  m: MetricasCampanha;
  onEdit: () => void;
  onToggleStatus: () => void;
}

const statusVariant = (status: string | null): "default" | "secondary" | "destructive" | "outline" => {
  switch (status) {
    case "ativa": return "default";
    case "pausada": return "secondary";
    case "finalizada": return "outline";
    case "rascunho": return "secondary";
    default: return "outline";
  }
};

const tipoLabel: Record<string, string> = {
  prospeccao: "Prospecção",
  evento: "Evento",
  reativacao: "Reativação",
  divulgacao: "Divulgação",
  pos_operatorio: "Pós-op",
  custom: "Custom",
};

export default function CampanhaCard({ m, onEdit, onToggleStatus }: Props) {
  const navigate = useNavigate();
  const isAtiva = m.campanha_status === "ativa";

  return (
    <Card className="hover:border-mh-gold-400 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base truncate">{m.nome}</CardTitle>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] text-mh-ink-3">
                {tipoLabel[m.tipo || "custom"] || m.tipo}
              </span>
              <span className="text-[10px] text-mh-ink-3">·</span>
              <span className="text-[10px] text-mh-ink-3">
                criada {formatDistanceToNow(new Date(m.created_at), { locale: ptBR, addSuffix: true })}
              </span>
            </div>
          </div>
          <Badge variant={statusVariant(m.campanha_status)}>{m.campanha_status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Números grandes — taxa de resposta e qualificação em destaque */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-mh-ink-50 rounded-md px-3 py-2">
            <div className="text-[10px] text-mh-ink-3 flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              Taxa resposta
            </div>
            <div className="font-serif-display text-2xl tabular-nums">{m.taxa_resposta_pct}%</div>
          </div>
          <div className="bg-orange-50/70 rounded-md px-3 py-2">
            <div className="text-[10px] text-orange-700 flex items-center gap-1">
              <Flame className="h-3 w-3" />
              Taxa qualificação
            </div>
            <div className="font-serif-display text-2xl tabular-nums text-orange-700">{m.taxa_qualificacao_pct}%</div>
          </div>
        </div>

        {/* Mini pipeline */}
        <div className="grid grid-cols-5 gap-1 text-[10px] text-center">
          <MiniPipe label="Pend." value={m.pendentes} />
          <MiniPipe label="Env." value={m.enviados} />
          <MiniPipe label="Convers." value={m.em_conversa} active />
          <MiniPipe label="Quentes" value={m.qualificados} highlight />
          <MiniPipe label="Desc." value={m.descartados} dim />
        </div>

        {/* Hoje */}
        <div className="flex items-center justify-between text-[11px] text-mh-ink-3 pt-2 border-t border-mh-ink-100">
          <span className="flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            Hoje: {m.enviados_hoje} env · {m.respostas_hoje} resp
          </span>
          {m.ultima_resposta && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Última resp. {formatDistanceToNow(new Date(m.ultima_resposta), { locale: ptBR, addSuffix: true })}
            </span>
          )}
        </div>

        {/* Ações */}
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => navigate(`/prospeccao/${m.campanha_id}`)}
          >
            Abrir
            <ChevronRight className="h-3 w-3 ml-1" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onEdit} title="Editar">
            <Edit className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant={isAtiva ? "secondary" : "default"}
            onClick={onToggleStatus}
            title={isAtiva ? "Pausar" : "Ativar"}
          >
            {isAtiva ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniPipe({ label, value, active, highlight, dim }: { label: string; value: number; active?: boolean; highlight?: boolean; dim?: boolean }) {
  return (
    <div className={
      "rounded px-1 py-1.5 " +
      (highlight ? "bg-orange-100 text-orange-800 " :
        active ? "bg-mh-navy-100 text-mh-navy-800 " :
        dim ? "bg-mh-ink-50 text-mh-ink-4 " :
        "bg-mh-ink-50 text-mh-ink-2 ")
    }>
      <div className="text-[9px] uppercase tracking-wide">{label}</div>
      <div className="font-serif-display text-base tabular-nums leading-none">{value}</div>
    </div>
  );
}
