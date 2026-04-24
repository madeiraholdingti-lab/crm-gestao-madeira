import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, Edit, Play, Pause, Send, MessageSquare, Flame, Clock, AlertTriangle, Info } from "lucide-react";
import { toast } from "sonner";
import CampanhaKanban from "@/components/prospeccao/CampanhaKanban";
import NovaCampanhaWizard, { type CampanhaEditInput } from "@/components/prospeccao/NovaCampanhaWizard";
import { useCampanhaEnvios } from "@/hooks/useCampanhaEnvios";
import { useMetricasCampanhas } from "@/hooks/useMetricasCampanha";

interface CampanhaFull {
  id: string;
  nome: string;
  status: string;
  tipo: string | null;
  descricao: string | null;
  mensagem: string;
  chip_ids: string[] | null;
  ativo: boolean;
  briefing_ia: Record<string, unknown> | null;
  created_at: string;
  envios_por_dia: number | null;
  horario_inicio: string | null;
  horario_fim: string | null;
}

export default function CampanhaProspeccao() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [camp, setCamp] = useState<CampanhaFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  const { data: envios = [], isLoading: enviosLoading } = useCampanhaEnvios(id);
  const { data: metricas = [] } = useMetricasCampanhas();
  const metrica = metricas.find((m) => m.campanha_id === id);

  async function fetchCamp() {
    if (!id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("campanhas_disparo")
      .select("*")
      .eq("id", id)
      .single();
    if (error) {
      toast.error("Erro ao carregar campanha");
      setLoading(false);
      return;
    }
    setCamp(data as unknown as CampanhaFull);
    setLoading(false);
  }

  useEffect(() => { fetchCamp(); }, [id]);

  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`campanha-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "campanhas_disparo", filter: `id=eq.${id}` }, () => {
        fetchCamp();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id]);

  async function toggleStatus() {
    if (!camp) return;
    const novo = camp.status === "ativa" ? "pausada" : "ativa";
    const { error } = await supabase
      .from("campanhas_disparo")
      .update({ status: novo })
      .eq("id", camp.id);
    if (error) return toast.error("Erro: " + error.message);
    toast.success(novo === "ativa" ? "Campanha ativada" : "Campanha pausada");
  }

  if (loading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-[50vh] w-full" />
      </div>
    );
  }

  if (!camp) {
    return (
      <div className="p-6">
        <Card><CardContent className="py-12 text-center text-sm text-mh-ink-3">
          Campanha não encontrada.
          <Button variant="outline" className="mt-4 block mx-auto" onClick={() => navigate("/prospeccao")}>
            <ChevronLeft className="h-3 w-3 mr-1" /> Voltar
          </Button>
        </CardContent></Card>
      </div>
    );
  }

  const briefing = (camp.briefing_ia || {}) as Record<string, unknown>;
  const iaAtiva = !!briefing.ia_ativa;
  const handoffPhones = (Array.isArray(briefing.handoff_telefones) ? briefing.handoff_telefones : []) as string[];
  const isAtiva = camp.status === "ativa";

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => navigate("/prospeccao")}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
          </Button>
          <div className="flex items-center gap-2">
            <h1 className="font-serif-display text-2xl font-medium text-mh-ink truncate">{camp.nome}</h1>
            <Badge variant={isAtiva ? "default" : "secondary"}>{camp.status}</Badge>
            {camp.tipo && <Badge variant="outline">{camp.tipo}</Badge>}
          </div>
          {camp.descricao && <p className="text-sm text-mh-ink-3 mt-1">{camp.descricao}</p>}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Edit className="h-3 w-3 mr-1" /> Editar
          </Button>
          <Button variant={isAtiva ? "secondary" : "default"} size="sm" onClick={toggleStatus}>
            {isAtiva ? <Pause className="h-3 w-3 mr-1" /> : <Play className="h-3 w-3 mr-1" />}
            {isAtiva ? "Pausar" : "Ativar"}
          </Button>
        </div>
      </div>

      {/* Avisos */}
      {!iaAtiva && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-3 flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-700 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-amber-900">IA desativada</div>
              <div className="text-xs text-amber-800">Quando o lead responder, a conversa fica parada no SDR Zap até alguém responder manualmente. Edite a campanha pra ativar a IA no briefing.</div>
            </div>
          </CardContent>
        </Card>
      )}
      {iaAtiva && handoffPhones.length === 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-3 flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-700 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-amber-900">Sem telefone de handoff</div>
              <div className="text-xs text-amber-800">Quando a IA identificar lead quente, ninguém vai ser notificado. Edite o briefing pra adicionar pelo menos 1 telefone.</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      {metrica && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Stat icon={<Send className="h-3 w-3" />} label="Total" value={metrica.total_envios} />
          <Stat icon={<MessageSquare className="h-3 w-3" />} label="Respostas" value={metrica.responderam} sub={`${metrica.taxa_resposta_pct}%`} />
          <Stat icon={<Flame className="h-3 w-3 text-orange-500" />} label="Quentes" value={metrica.qualificados} sub={`${metrica.taxa_qualificacao_pct}%`} highlight />
          <Stat icon={<Clock className="h-3 w-3" />} label="Hoje" value={metrica.enviados_hoje} sub={`${metrica.respostas_hoje} resp.`} />
          <Stat icon={<AlertTriangle className="h-3 w-3" />} label="Erros" value={metrica.com_erro} dim />
        </div>
      )}

      {/* Kanban */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <h2 className="font-serif-display text-lg font-medium">Pipeline</h2>
          <span className="text-xs text-mh-ink-3 flex items-center gap-1">
            <Info className="h-3 w-3" />
            status controlado automaticamente pela IA. Clique num card pra abrir a conversa no SDR Zap.
          </span>
        </div>
        <CampanhaKanban envios={envios} isLoading={enviosLoading} />
      </div>

      <NovaCampanhaWizard
        open={editOpen}
        onOpenChange={setEditOpen}
        editing={camp as unknown as CampanhaEditInput}
        onSaved={fetchCamp}
      />
    </div>
  );
}

function Stat({ icon, label, value, sub, highlight, dim }: { icon: React.ReactNode; label: string; value: number; sub?: string; highlight?: boolean; dim?: boolean }) {
  return (
    <Card className={highlight ? "border-orange-200 bg-orange-50/40" : ""}>
      <CardContent className={"p-3 " + (dim ? "opacity-70" : "")}>
        <div className="flex items-center gap-1 text-[10px] text-mh-ink-3 uppercase tracking-wide">
          {icon}
          <span>{label}</span>
        </div>
        <div className="font-serif-display text-xl tabular-nums">{value}</div>
        {sub && <div className="text-[10px] text-mh-ink-3">{sub}</div>}
      </CardContent>
    </Card>
  );
}
