import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Send, MessageSquare, Flame, Clock, Search, ListFilter } from "lucide-react";
import { useMetricasCampanhas } from "@/hooks/useMetricasCampanha";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import CampanhaCard from "@/components/prospeccao/CampanhaCard";
import NovaCampanhaWizard, { type CampanhaEditInput } from "@/components/prospeccao/NovaCampanhaWizard";

export default function Prospeccao() {
  const [statusFilter, setStatusFilter] = useState<string>("todas");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CampanhaEditInput | null>(null);

  const { data: metricas = [], isLoading, refetch } = useMetricasCampanhas(statusFilter);

  const filtradas = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return metricas;
    return metricas.filter((m) => m.nome.toLowerCase().includes(t));
  }, [metricas, search]);

  const totais = useMemo(() => metricas.reduce(
    (acc, m) => ({
      enviados_hoje: acc.enviados_hoje + (m.enviados_hoje || 0),
      respostas_hoje: acc.respostas_hoje + (m.respostas_hoje || 0),
      qualificados: acc.qualificados + (m.qualificados || 0),
      em_conversa: acc.em_conversa + (m.em_conversa || 0),
    }),
    { enviados_hoje: 0, respostas_hoje: 0, qualificados: 0, em_conversa: 0 },
  ), [metricas]);

  async function handleToggleStatus(m: typeof metricas[0]) {
    const novoStatus = m.campanha_status === "ativa" ? "pausada" : "ativa";
    const { error } = await supabase
      .from("campanhas_disparo")
      .update({ status: novoStatus })
      .eq("id", m.campanha_id);
    if (error) return toast.error("Erro: " + error.message);
    toast.success(novoStatus === "ativa" ? "Campanha ativada" : "Campanha pausada");
    refetch();
  }

  async function handleEdit(m: typeof metricas[0]) {
    const { data, error } = await supabase
      .from("campanhas_disparo")
      .select("*")
      .eq("id", m.campanha_id)
      .single();
    if (error) return toast.error("Erro ao carregar: " + error.message);
    setEditing(data as unknown as CampanhaEditInput);
    setDialogOpen(true);
  }

  function handleNova() {
    setEditing(null);
    setDialogOpen(true);
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mh-gold-600">
            Máquina de Prospecção
          </div>
          <h1 className="font-serif-display text-2xl md:text-3xl font-medium text-mh-ink leading-tight mt-1">
            Prospecção
          </h1>
          <p className="text-sm text-mh-ink-3 mt-1">
            Campanhas de disparo com IA conversacional, chip rotation e handoff automático.
          </p>
        </div>
        <Button onClick={handleNova}>
          <Plus className="h-4 w-4 mr-2" />
          Nova campanha
        </Button>
      </div>

      {/* Stats globais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<Send className="h-4 w-4" />} label="Enviadas hoje" value={totais.enviados_hoje} />
        <StatCard icon={<MessageSquare className="h-4 w-4" />} label="Respostas hoje" value={totais.respostas_hoje} />
        <StatCard icon={<Flame className="h-4 w-4 text-orange-500" />} label="Quentes" value={totais.qualificados} highlight />
        <StatCard icon={<Clock className="h-4 w-4" />} label="Em conversa" value={totais.em_conversa} />
      </div>

      {/* Filtros */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList>
            <TabsTrigger value="todas">Todas</TabsTrigger>
            <TabsTrigger value="ativa">Ativas</TabsTrigger>
            <TabsTrigger value="pausada">Pausadas</TabsTrigger>
            <TabsTrigger value="rascunho">Rascunhos</TabsTrigger>
            <TabsTrigger value="finalizada">Finalizadas</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-mh-ink-3" />
          <Input
            placeholder="Buscar campanha..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-64 w-full" />)}
        </div>
      ) : filtradas.length === 0 ? (
        <Card><CardContent className="py-16 text-center">
          <ListFilter className="h-8 w-8 text-mh-ink-3 mx-auto mb-3" />
          <p className="text-sm text-mh-ink-3">
            {search ? `Nenhuma campanha com "${search}"` : `Nenhuma campanha no filtro "${statusFilter}".`}
          </p>
          {!search && (
            <Button variant="outline" size="sm" className="mt-3" onClick={handleNova}>
              <Plus className="h-3 w-3 mr-1" /> Criar campanha
            </Button>
          )}
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtradas.map((m) => (
            <CampanhaCard
              key={m.campanha_id}
              m={m}
              onEdit={() => handleEdit(m)}
              onToggleStatus={() => handleToggleStatus(m)}
            />
          ))}
        </div>
      )}

      <NovaCampanhaWizard
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={() => refetch()}
      />
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
