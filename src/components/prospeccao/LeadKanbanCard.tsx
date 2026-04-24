import { Card } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import { MessageSquare, Clock, AlertCircle, Flame } from "lucide-react";
import type { EnvioRow } from "@/hooks/useCampanhaEnvios";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Props {
  envio: EnvioRow;
}

export default function LeadKanbanCard({ envio }: Props) {
  const navigate = useNavigate();
  const lead = envio.lead;
  const nome = lead?.nome || envio.telefone;

  const openConversa = () => {
    navigate(`/sdr-zap?phone=${encodeURIComponent(envio.telefone)}`);
  };

  const tempo = envio.respondeu_em ? envio.respondeu_em : envio.enviado_em;
  const status = envio.status;

  return (
    <Card
      className={
        "p-2.5 hover:border-mh-gold-400 transition-colors cursor-pointer text-xs " +
        (status === "qualificado" ? "border-orange-300 bg-orange-50/40 " :
         status === "descartado" ? "opacity-60 " : "")
      }
      onClick={openConversa}
    >
      <div className="flex items-center gap-1 mb-1">
        {status === "qualificado" && <Flame className="h-3 w-3 text-orange-600 flex-shrink-0" />}
        {envio.erro && <AlertCircle className="h-3 w-3 text-destructive flex-shrink-0" />}
        <div className="font-medium truncate flex-1">{nome}</div>
      </div>
      <div className="text-[10px] text-mh-ink-3 font-mono">{envio.telefone}</div>
      {lead?.perfil_profissional && (
        <div className="text-[10px] text-mh-ink-3 mt-0.5 capitalize">
          {lead.perfil_profissional.replace(/_/g, " ")}
        </div>
      )}
      {tempo && (
        <div className="flex items-center gap-1 text-[10px] text-mh-ink-3 mt-1.5 pt-1.5 border-t border-mh-ink-100">
          {envio.respondeu_em ? <MessageSquare className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
          {formatDistanceToNow(new Date(tempo), { locale: ptBR, addSuffix: true })}
        </div>
      )}
      {envio.erro && (
        <div className="text-[10px] text-destructive mt-1 truncate" title={envio.erro}>{envio.erro}</div>
      )}
    </Card>
  );
}
