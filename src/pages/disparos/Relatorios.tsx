import { useState } from "react";
import { useMetricasCampanhas } from "@/hooks/useMetricasCampanha";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Send,
  MessageSquare,
  Flame,
  XCircle,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  Clock,
} from "lucide-react";

const statusVariant = (status: string | null) => {
  switch (status) {
    case "ativa": return "default";
    case "pausada": return "secondary";
    case "finalizada": return "outline";
    case "rascunho": return "secondary";
    default: return "outline";
  }
};

const formatRelative = (iso: string | null) => {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR });
  } catch {
    return iso;
  }
};

export default function RelatoriosDisparos() {
  const [statusFilter, setStatusFilter] = useState<string>("todas");
  const { data: metricas = [], isLoading } = useMetricasCampanhas(statusFilter);

  const totais = metricas.reduce(
    (acc, m) => ({
      total_envios: acc.total_envios + (m.total_envios || 0),
      enviados_hoje: acc.enviados_hoje + (m.enviados_hoje || 0),
      respostas_hoje: acc.respostas_hoje + (m.respostas_hoje || 0),
      qualificados: acc.qualificados + (m.qualificados || 0),
      em_conversa: acc.em_conversa + (m.em_conversa || 0),
      descartados: acc.descartados + (m.descartados || 0),
      com_erro: acc.com_erro + (m.com_erro || 0),
    }),
    { total_envios: 0, enviados_hoje: 0, respostas_hoje: 0, qualificados: 0, em_conversa: 0, descartados: 0, com_erro: 0 },
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="font-serif-display text-3xl font-bold">Relatórios — Campanhas</h1>
        <p className="text-sm text-mh-ink-3 mt-1">
          Visão macro das campanhas de disparo. Atualiza a cada 1min.
        </p>
      </div>

      {/* Cards de totais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<Send className="h-4 w-4" />} label="Enviadas hoje" value={totais.enviados_hoje} />
        <StatCard icon={<MessageSquare className="h-4 w-4" />} label="Respostas hoje" value={totais.respostas_hoje} />
        <StatCard icon={<Flame className="h-4 w-4 text-orange-500" />} label="Quentes (qualificados)" value={totais.qualificados} highlight />
        <StatCard icon={<Clock className="h-4 w-4" />} label="Em conversa agora" value={totais.em_conversa} />
      </div>

      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList>
          <TabsTrigger value="todas">Todas</TabsTrigger>
          <TabsTrigger value="ativa">Ativas</TabsTrigger>
          <TabsTrigger value="pausada">Pausadas</TabsTrigger>
          <TabsTrigger value="finalizada">Finalizadas</TabsTrigger>
        </TabsList>

        <TabsContent value={statusFilter} className="mt-4">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
            </div>
          ) : metricas.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-sm text-mh-ink-3">
              Nenhuma campanha no filtro "{statusFilter}".
            </CardContent></Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {metricas.map(m => (
                <Card key={m.campanha_id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <CardTitle className="text-base truncate">{m.nome}</CardTitle>
                        <CardDescription className="text-xs">
                          {m.tipo || 'sem tipo'} · criada {formatRelative(m.created_at)}
                        </CardDescription>
                      </div>
                      <Badge variant={statusVariant(m.campanha_status)}>{m.campanha_status}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Métricas principais */}
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <Metric label="Total" value={m.total_envios} />
                      <Metric label="Respostas" value={m.responderam} icon={<MessageSquare className="h-3 w-3" />} />
                      <Metric label="Quentes" value={m.qualificados} icon={<Flame className="h-3 w-3 text-orange-500" />} highlight />
                    </div>

                    {/* Taxas */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-mh-ink-50 rounded px-2 py-1.5">
                        <div className="text-[10px] text-mh-ink-3">Taxa resposta</div>
                        <div className="font-serif-display text-lg tabular-nums">{m.taxa_resposta_pct}%</div>
                      </div>
                      <div className="bg-mh-ink-50 rounded px-2 py-1.5">
                        <div className="text-[10px] text-mh-ink-3">Taxa qualificação</div>
                        <div className="font-serif-display text-lg tabular-nums">{m.taxa_qualificacao_pct}%</div>
                      </div>
                    </div>

                    {/* Footer info */}
                    <div className="flex items-center justify-between text-[11px] text-mh-ink-3 pt-2 border-t border-mh-ink-100">
                      <span className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" />
                        Hoje: {m.enviados_hoje} env / {m.respostas_hoje} resp
                      </span>
                      {m.com_erro > 0 && (
                        <span className="flex items-center gap-1 text-destructive">
                          <AlertTriangle className="h-3 w-3" />
                          {m.com_erro} erros
                        </span>
                      )}
                    </div>
                    {m.ultima_resposta && (
                      <div className="text-[10px] text-mh-ink-3">
                        Última resposta: {formatRelative(m.ultima_resposta)}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: number; highlight?: boolean }) {
  return (
    <Card className={highlight ? "border-orange-200 bg-orange-50/50" : ""}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-mh-ink-3 mb-1">
          {icon}
          <span>{label}</span>
        </div>
        <div className="font-serif-display text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, icon, highlight }: { label: string; value: number; icon?: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded px-2 py-1.5 ${highlight ? 'bg-orange-50' : 'bg-mh-ink-50'}`}>
      <div className="text-[10px] text-mh-ink-3 flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className={`font-serif-display text-lg tabular-nums ${highlight ? 'text-orange-700' : ''}`}>{value}</div>
    </div>
  );
}
