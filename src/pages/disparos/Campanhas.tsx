import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { 
  Plus, 
  Send, 
  Trash2,
  Edit,
  Target,
  MessageSquare,
  Users
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import DisparoBreadcrumb from "@/components/DisparoBreadcrumb";
import DisparosTopNav from "@/components/DisparosTopNav";

interface Campanha {
  id: string;
  nome: string;
  descricao: string | null;
  mensagem: string;
  tipo: string | null;
  instancia_id: string | null;
  status: string;
  total_leads: number;
  enviados: number;
  sucesso: number;
  falhas: number;
  filtro_tipo_lead: string[] | null;
  created_at: string;
  instancias_whatsapp?: { nome_instancia: string } | null;
}

interface TipoLead {
  id: string;
  nome: string;
  cor: string;
}

interface Especialidade {
  id: string;
  nome: string;
}

interface ScriptIA {
  id: string;
  nome: string;
  ativo: boolean;
}

// Tipos canônicos batendo com o CHECK constraint em campanhas_disparo
const tiposCampanha = [
  { value: "prospeccao", label: "Prospecção", desc: "Captar novos médicos/leads com IA qualificando", iaSugerida: true },
  { value: "evento", label: "Evento", desc: "Convite pra jornada, congresso, workshop", iaSugerida: true },
  { value: "reativacao", label: "Reativação", desc: "Pacientes/leads que sumiram há X meses", iaSugerida: true },
  { value: "divulgacao", label: "Divulgação", desc: "Aviso simples send-only (sem IA)", iaSugerida: false },
  { value: "pos_operatorio", label: "Pós-operatório", desc: "Sequência D+1, D+7, D+30", iaSugerida: true },
  { value: "custom", label: "Custom", desc: "Configurar tudo manualmente", iaSugerida: false },
];

interface InstanciaWhatsApp {
  id: string;
  nome_instancia: string;
  numero_chip: string | null;
  cor_identificacao: string | null;
  status: string;
}

interface BriefingIA {
  ia_ativa?: boolean;
  persona?: string;
  objetivo?: string;
  contexto?: string;
  objecoes?: Array<{ pergunta: string; resposta: string }>;
  handoff_keywords?: string[];
  /** @deprecated — use handoff_telefones (array). Mantido pra retrocompat */
  handoff_telefone?: string;
  handoff_telefones?: string[]; // Telefones que recebem alerta quando alerta_lead=true
  handoff_numero_chip?: string;
}

const DIAS_SEMANA = [
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
  { value: 0, label: "Dom" },
];

export default function CampanhasPage() {
  const navigate = useNavigate();
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [tiposLead, setTiposLead] = useState<TipoLead[]>([]);
  const [especialidades, setEspecialidades] = useState<Especialidade[]>([]);
  const [scriptsIA, setScriptsIA] = useState<ScriptIA[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Dialog states
  const [campanhaDialogOpen, setCampanhaDialogOpen] = useState(false);
  
  // Form states
  const [editingCampanha, setEditingCampanha] = useState<Campanha | null>(null);
  
  // Form fields
  const [formCampanha, setFormCampanha] = useState({
    nome: "",
    descricao: "",
    mensagem: "",
    instancia_id: "",
    chip_ids: [] as string[],
    chip_ia_id: "", // instância que a IA usa pra responder (vazio = usa o 1º do chip_ids)
    filtro_tipo_lead: [] as string[],
    filtro_perfil_profissional: [] as string[],
    tipo_campanha: "prospeccao",
    script_ia_id: "",
    envios_por_dia: 120,
    intervalo_min_minutos: 1,
    intervalo_max_minutos: 3,
    horario_inicio: "09:00",
    horario_fim: "18:00",
    dias_semana: [1, 2, 3, 4, 5] as number[],
    spintax_ativo: true,
    briefing_ia: {
      ia_ativa: false,
      persona: "",
      objetivo: "",
      contexto: "",
      handoff_keywords: ["salario", "salário", "valor", "remuneração"],
      handoff_telefones: [] as string[],
      handoff_numero_chip: "",
    } as BriefingIA,
  });

  const [instancias, setInstancias] = useState<InstanciaWhatsApp[]>([]);

  useEffect(() => {
    fetchData();
  }, []);

  // Realtime subscription for campanhas_disparo
  useEffect(() => {
    const channel = supabase
      .channel('campanhas-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'campanhas_disparo'
        },
        (payload) => {
          console.log('[REALTIME] campanhas_disparo:', payload.eventType, payload);
          
          if (payload.eventType === 'INSERT') {
            const newCampanha = payload.new as Campanha;
            setCampanhas(prev => [newCampanha, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as Campanha;
            setCampanhas(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c));
          } else if (payload.eventType === 'DELETE') {
            const deleted = payload.old as Campanha;
            setCampanhas(prev => prev.filter(c => c.id !== deleted.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchData = async () => {
    setLoading(true);
    await Promise.all([
      fetchCampanhas(),
      fetchTiposLead(),
      fetchEspecialidades(),
      fetchScriptsIA(),
      fetchInstancias(),
    ]);
    setLoading(false);
  };

  const fetchInstancias = async () => {
    // SOMENTE chips com finalidade='disparo'. Nunca mostrar atendimento (Maikon/Iza/Mariana/Consultório).
    const { data } = await supabase
      .from("instancias_whatsapp")
      .select("id, nome_instancia, numero_chip, cor_identificacao, status")
      .eq("ativo", true)
      .eq("finalidade", "disparo")
      .in("status", ["conectada", "ativa", "open"])
      .order("nome_instancia");
    setInstancias((data || []) as InstanciaWhatsApp[]);
  };

  const fetchCampanhas = async () => {
    const { data, error } = await supabase
      .from("campanhas_disparo")
      .select("*, instancias_whatsapp(nome_instancia)")
      .order("created_at", { ascending: false });
    
    if (error) {
      toast.error("Erro ao carregar campanhas");
      return;
    }
    setCampanhas(data || []);
  };

  const fetchTiposLead = async () => {
    const { data } = await supabase
      .from("tipos_lead")
      .select("id, nome, cor")
      .order("nome");
    setTiposLead(data || []);
  };

  const fetchEspecialidades = async () => {
    const { data } = await supabase
      .from("especialidades")
      .select("id, nome")
      .order("nome");
    setEspecialidades(data || []);
  };

  const fetchScriptsIA = async () => {
    const { data } = await supabase
      .from("ia_scripts")
      .select("id, nome, ativo")
      .eq("ativo", true)
      .order("nome");
    setScriptsIA(data || []);
  };

  const handleSaveCampanha = async () => {
    if (!formCampanha.nome || !formCampanha.mensagem) {
      toast.error("Nome e mensagem são obrigatórios");
      return;
    }
    if (formCampanha.chip_ids.length === 0) {
      toast.error("Selecione pelo menos uma instância pra disparar");
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();

    // Briefing IA: salvar só se IA ativa
    // handoff_numero_chip defaulta pro chip_ia_id se tiver, senão null
    const briefingFinal = formCampanha.briefing_ia.ia_ativa
      ? {
          ...formCampanha.briefing_ia,
          handoff_numero_chip: formCampanha.chip_ia_id || null,
        }
      : null;

    const payload = {
      nome: formCampanha.nome,
      descricao: formCampanha.descricao,
      mensagem: formCampanha.mensagem,
      tipo: formCampanha.tipo_campanha,
      instancia_id: formCampanha.chip_ids[0], // primeira instância como principal (legado)
      chip_ids: formCampanha.chip_ids,
      filtro_tipo_lead: formCampanha.filtro_tipo_lead.length > 0 ? formCampanha.filtro_tipo_lead : null,
      filtro_perfil_profissional: formCampanha.filtro_perfil_profissional.length > 0 ? formCampanha.filtro_perfil_profissional : null,
      script_ia_id: formCampanha.script_ia_id || null,
      envios_por_dia: formCampanha.envios_por_dia,
      intervalo_min_minutos: formCampanha.intervalo_min_minutos,
      intervalo_max_minutos: formCampanha.intervalo_max_minutos,
      horario_inicio: formCampanha.horario_inicio,
      horario_fim: formCampanha.horario_fim,
      dias_semana: formCampanha.dias_semana,
      spintax_ativo: formCampanha.spintax_ativo,
      briefing_ia: briefingFinal,
    };

    if (editingCampanha) {
      const { error } = await supabase
        .from("campanhas_disparo")
        .update(payload)
        .eq("id", editingCampanha.id);

      if (error) {
        toast.error("Erro ao atualizar campanha: " + error.message);
        return;
      }
      toast.success("Campanha atualizada");
    } else {
      const { error } = await supabase
        .from("campanhas_disparo")
        .insert({ ...payload, created_by: user?.id, ativo: true });

      if (error) {
        toast.error("Erro ao criar campanha: " + error.message);
        return;
      }
      toast.success("Campanha criada — ative quando quiser começar os disparos");
    }

    setCampanhaDialogOpen(false);
    setEditingCampanha(null);
    resetForm();
    fetchCampanhas();
  };

  const resetForm = () => {
    setFormCampanha({
      nome: "", descricao: "", mensagem: "", instancia_id: "",
      chip_ids: [], chip_ia_id: "",
      filtro_tipo_lead: [], filtro_perfil_profissional: [],
      tipo_campanha: "prospeccao", script_ia_id: "",
      envios_por_dia: 120, intervalo_min_minutos: 1, intervalo_max_minutos: 3,
      horario_inicio: "09:00", horario_fim: "18:00",
      dias_semana: [1, 2, 3, 4, 5], spintax_ativo: true,
      briefing_ia: {
        ia_ativa: false, persona: "", objetivo: "", contexto: "",
        handoff_keywords: ["salario", "salário", "valor", "remuneração"],
        handoff_telefones: [], handoff_numero_chip: "",
      },
    });
  };

  const handleToggleAtivar = async (campanha: Campanha) => {
    const novoStatus = campanha.status === 'ativa' ? 'pausada' : 'ativa';
    const { error } = await supabase.from('campanhas_disparo')
      .update({ status: novoStatus })
      .eq('id', campanha.id);
    if (error) {
      toast.error("Erro: " + error.message);
      return;
    }
    toast.success(novoStatus === 'ativa' ? 'Campanha ativada — disparos iniciam no próximo ciclo' : 'Campanha pausada');
  };

  const handleDeleteCampanha = async (id: string) => {
    const { error } = await supabase.from("campanhas_disparo").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao deletar campanha");
      return;
    }
    toast.success("Campanha removida");
    fetchCampanhas();
  };

  const openEditDialog = (campanha: Campanha) => {
    setEditingCampanha(campanha);
    const c = campanha as unknown as Record<string, unknown>;
    const briefingRaw = (c.briefing_ia as BriefingIA | null) || null;
    const chipIdsRaw = (c.chip_ids as string[] | null) || (campanha.instancia_id ? [campanha.instancia_id] : []);

    // Migração: se vier só handoff_telefone (legado), converte pra handoff_telefones[]
    const briefingMigrado: BriefingIA | null = briefingRaw ? {
      ...briefingRaw,
      handoff_telefones: briefingRaw.handoff_telefones
        ?? (briefingRaw.handoff_telefone ? [briefingRaw.handoff_telefone] : []),
    } : null;

    setFormCampanha({
      nome: campanha.nome,
      descricao: campanha.descricao || "",
      mensagem: campanha.mensagem,
      instancia_id: campanha.instancia_id || "",
      chip_ids: chipIdsRaw,
      chip_ia_id: briefingRaw?.handoff_numero_chip || "",
      filtro_tipo_lead: campanha.filtro_tipo_lead || [],
      filtro_perfil_profissional: (c.filtro_perfil_profissional as string[]) || [],
      tipo_campanha: campanha.tipo || "prospeccao",
      script_ia_id: (c.script_ia_id as string) || "",
      envios_por_dia: (c.envios_por_dia as number) ?? 120,
      intervalo_min_minutos: (c.intervalo_min_minutos as number) ?? 1,
      intervalo_max_minutos: (c.intervalo_max_minutos as number) ?? 3,
      horario_inicio: (c.horario_inicio as string) || "09:00",
      horario_fim: (c.horario_fim as string) || "18:00",
      dias_semana: (c.dias_semana as number[]) || [1, 2, 3, 4, 5],
      spintax_ativo: (c.spintax_ativo as boolean) ?? true,
      briefing_ia: briefingMigrado || {
        ia_ativa: false, persona: "", objetivo: "", contexto: "",
        handoff_keywords: ["salario", "salário", "valor", "remuneração"],
        handoff_telefones: [], handoff_numero_chip: "",
      },
    });
    setCampanhaDialogOpen(true);
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      rascunho: { label: "Rascunho", variant: "secondary" },
      em_andamento: { label: "Em Andamento", variant: "default" },
      concluida: { label: "Concluída", variant: "outline" },
      pausada: { label: "Pausada", variant: "secondary" },
      cancelada: { label: "Cancelada", variant: "destructive" }
    };
    const config = statusConfig[status] || { label: status, variant: "secondary" as const };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const handleToggleTipoLead = (tipo: string) => {
    setFormCampanha(prev => ({
      ...prev,
      filtro_tipo_lead: prev.filtro_tipo_lead.includes(tipo)
        ? prev.filtro_tipo_lead.filter(t => t !== tipo)
        : [...prev.filtro_tipo_lead, tipo]
    }));
  };

  return (
    <div className="p-4 md:p-6">
      <DisparosTopNav />
      <div className="space-y-6">
          <DisparoBreadcrumb 
            items={[
              { label: "Disparos em Massa", href: "/disparos-em-massa" },
              { label: "Campanhas" }
            ]} 
          />
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mh-gold-600">
                Disparos · Campanhas
              </div>
              <h1 className="font-serif-display text-2xl md:text-3xl font-medium text-mh-ink leading-tight mt-1">
                Campanhas
              </h1>
              <p className="text-sm text-mh-ink-3 mt-1">
                Crie e gerencie campanhas para disparos em massa com filtros avançados.
              </p>
            </div>
          <Button onClick={() => {
            setEditingCampanha(null);
            setFormCampanha({ nome: "", descricao: "", mensagem: "", instancia_id: "", filtro_tipo_lead: [], filtro_perfil_profissional: [], tipo_campanha: "relacionamento", script_ia_id: "" });
            setCampanhaDialogOpen(true);
          }}>
            <Plus className="mr-2 h-4 w-4" />
            Nova Campanha
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <Target className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-2xl font-bold">{campanhas.length}</p>
                  <p className="text-sm text-muted-foreground">Total de Campanhas</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <Send className="h-8 w-8 text-blue-500" />
                <div>
                  <p className="text-2xl font-bold">
                    {campanhas.filter(c => c.status === "em_andamento").length}
                  </p>
                  <p className="text-sm text-muted-foreground">Em Andamento</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <MessageSquare className="h-8 w-8 text-green-500" />
                <div>
                  <p className="text-2xl font-bold">
                    {campanhas.reduce((acc, c) => acc + c.sucesso, 0)}
                  </p>
                  <p className="text-sm text-muted-foreground">Mensagens Enviadas</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <Users className="h-8 w-8 text-purple-500" />
                <div>
                  <p className="text-2xl font-bold">
                    {campanhas.reduce((acc, c) => acc + c.total_leads, 0)}
                  </p>
                  <p className="text-sm text-muted-foreground">Leads Alcançados</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Campanhas Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {campanhas.map(campanha => (
            <Card key={campanha.id} className="hover:shadow-lg transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg">{campanha.nome}</CardTitle>
                    <CardDescription className="line-clamp-2">
                      {campanha.descricao || "Sem descrição"}
                    </CardDescription>
                  </div>
                  {getStatusBadge(campanha.status)}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md whitespace-pre-wrap break-words">
                  {campanha.mensagem}
                </div>
                
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span>{campanha.total_leads} leads</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Send className="h-4 w-4 text-muted-foreground" />
                    <span>{campanha.enviados} enviados</span>
                  </div>
                </div>

                {campanha.filtro_tipo_lead && campanha.filtro_tipo_lead.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {campanha.filtro_tipo_lead.map(tipo => (
                      <Badge key={tipo} variant="outline" className="text-xs">
                        {tipo}
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(campanha.created_at), "dd/MM/yyyy", { locale: ptBR })}
                  </span>
                  <div className="flex gap-1 items-center">
                    {/* Ativar / Pausar — muda status pra ativa ou pausada */}
                    {campanha.status !== 'finalizada' && campanha.status !== 'concluida' && (
                      <Button
                        variant={campanha.status === 'ativa' ? 'secondary' : 'default'}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleToggleAtivar(campanha)}
                      >
                        {campanha.status === 'ativa' ? 'Pausar' : 'Ativar'}
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => openEditDialog(campanha)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost" size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDeleteCampanha(campanha.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {campanhas.length === 0 && (
            <Card className="col-span-full">
              <CardContent className="py-12 text-center text-muted-foreground">
                <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Nenhuma campanha criada ainda</p>
                <Button
                  variant="link"
                  onClick={() => setCampanhaDialogOpen(true)}
                >
                  Criar primeira campanha
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Campanha Dialog */}
      <Dialog open={campanhaDialogOpen} onOpenChange={setCampanhaDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingCampanha ? "Editar Campanha" : "Nova Campanha"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            {/* Tipo de Campanha */}
            <div className="space-y-3">
              <Label>Tipo de Campanha</Label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {tiposCampanha.map(tipo => (
                  <Card
                    key={tipo.value}
                    className={`cursor-pointer transition-all ${
                      formCampanha.tipo_campanha === tipo.value 
                        ? "border-primary bg-primary/5" 
                        : "hover:border-primary/50"
                    }`}
                    onClick={() => setFormCampanha({ ...formCampanha, tipo_campanha: tipo.value })}
                  >
                    <CardContent className="p-3">
                      <p className="font-medium text-sm">{tipo.label}</p>
                      <p className="text-xs text-muted-foreground">{tipo.desc}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            <div>
              <Label>Nome da Campanha *</Label>
              <Input
                value={formCampanha.nome}
                onChange={(e) => setFormCampanha({ ...formCampanha, nome: e.target.value })}
                placeholder="Ex: Campanha de Natal"
              />
            </div>

            <div>
              <Label>Descrição</Label>
              <Textarea
                value={formCampanha.descricao}
                onChange={(e) => setFormCampanha({ ...formCampanha, descricao: e.target.value })}
                placeholder="Descreva o objetivo desta campanha..."
                rows={2}
              />
            </div>

            <div>
              <Label className="mb-2 block">Mensagem *</Label>
              <Textarea
                value={formCampanha.mensagem}
                onChange={(e) => setFormCampanha({ ...formCampanha, mensagem: e.target.value })}
                placeholder={`Ex: {Oi|Olá|E aí} {{nome}}, {aqui é do|sou do} Dr. Maikon...`}
                rows={4}
              />
              <p className="text-xs text-mh-ink-3 mt-1">
                Use <code className="bg-muted px-1 rounded">{"{{nome}}"}</code> pra nome do lead.
                {formCampanha.spintax_ativo && (
                  <> Spintax: <code className="bg-muted px-1 rounded">{"{opção1|opção2}"}</code> escolhe 1 aleatório por envio.</>
                )}
              </p>
            </div>

            {/* ═════════════ INSTÂNCIA DE DISPARO ═════════════ */}
            <div className="border-t pt-4">
              <Label className="flex items-center gap-2 mb-2">
                <span className="inline-block w-1 h-4 bg-mh-navy-700 rounded-full" />
                Instância(s) que vão disparar *
              </Label>
              <p className="text-xs text-mh-ink-3 mb-2">
                Pode escolher mais de uma pra rotação de chips (melhor anti-ban). 1ª falhou → tenta a próxima.
              </p>
              <div className="flex flex-wrap gap-2">
                {instancias.map(inst => {
                  const selected = formCampanha.chip_ids.includes(inst.id);
                  return (
                    <button
                      key={inst.id}
                      type="button"
                      onClick={() => setFormCampanha(prev => ({
                        ...prev,
                        chip_ids: selected ? prev.chip_ids.filter(id => id !== inst.id) : [...prev.chip_ids, inst.id],
                      }))}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        selected
                          ? "bg-mh-navy-700 text-white border-mh-navy-700"
                          : "bg-card border-border text-mh-ink-3 hover:border-mh-navy-700/50"
                      }`}
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-full"
                        style={{ backgroundColor: inst.cor_identificacao || "#cbd5e1" }}
                      />
                      {inst.nome_instancia}
                    </button>
                  );
                })}
                {instancias.length === 0 && (
                  <p className="text-xs text-destructive italic">Nenhuma instância conectada — conecte em /zaps</p>
                )}
              </div>
            </div>

            {/* ═════════════ IA conversa ═════════════ */}
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-2">
                <Label className="flex items-center gap-2">
                  <span className="inline-block w-1 h-4 bg-mh-gold-600 rounded-full" />
                  IA responder as respostas
                </Label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={formCampanha.briefing_ia.ia_ativa || false}
                    onCheckedChange={(c) => setFormCampanha(prev => ({
                      ...prev,
                      briefing_ia: { ...prev.briefing_ia, ia_ativa: !!c },
                    }))}
                  />
                  <span className="text-xs">Ativar IA</span>
                </label>
              </div>

              {formCampanha.briefing_ia.ia_ativa ? (
                <div className="space-y-3 bg-mh-navy-50/50 border border-mh-navy-100 rounded-md p-3">
                  <div>
                    <Label className="text-xs">Instância que a IA usa pra conversar</Label>
                    <p className="text-[11px] text-mh-ink-3 mb-1">
                      Se vazio, usa a primeira das instâncias de disparo acima. O ideal é um número dedicado pra IA.
                    </p>
                    <Select
                      value={formCampanha.chip_ia_id}
                      onValueChange={(v) => setFormCampanha({ ...formCampanha, chip_ia_id: v })}
                    >
                      <SelectTrigger className="bg-card">
                        <SelectValue placeholder="Usar a primeira instância de disparo" />
                      </SelectTrigger>
                      <SelectContent>
                        {instancias.map(inst => (
                          <SelectItem key={inst.id} value={inst.id}>{inst.nome_instancia}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-xs">Persona / contexto da IA</Label>
                    <Textarea
                      rows={2}
                      value={formCampanha.briefing_ia.persona || ""}
                      onChange={(e) => setFormCampanha(prev => ({
                        ...prev,
                        briefing_ia: { ...prev.briefing_ia, persona: e.target.value },
                      }))}
                      placeholder="Ex: Você é da GSS Saúde, fala como colega médico do Dr. Maikon. Tom informal, sem enrolação."
                      className="bg-card"
                    />
                  </div>

                  <div>
                    <Label className="text-xs">Objetivo da conversa</Label>
                    <Textarea
                      rows={2}
                      value={formCampanha.briefing_ia.objetivo || ""}
                      onChange={(e) => setFormCampanha(prev => ({
                        ...prev,
                        briefing_ia: { ...prev.briefing_ia, objetivo: e.target.value },
                      }))}
                      placeholder="Ex: Confirmar se tem RQE em cardiologia pediátrica, especialidade e interesse. Se demonstrar interesse, escalar pra humano."
                      className="bg-card"
                    />
                  </div>

                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs">Telefones que recebem alerta de handoff (1 ou mais)</Label>
                      <Input
                        value={(formCampanha.briefing_ia.handoff_telefones || []).join(", ")}
                        onChange={(e) => setFormCampanha(prev => ({
                          ...prev,
                          briefing_ia: {
                            ...prev.briefing_ia,
                            handoff_telefones: e.target.value.split(",").map(s => s.trim()).filter(Boolean),
                          },
                        }))}
                        placeholder="Ex: 5547999999999, 5547988888888"
                        className="bg-card font-mono text-xs"
                      />
                      <p className="text-[10px] text-mh-ink-3 mt-1">
                        Cada telefone recebe alerta quando a IA identificar lead interessado ou palavra-chave. Separe por vírgula.
                      </p>
                    </div>
                    <div>
                      <Label className="text-xs">Palavras-chave pra escalar</Label>
                      <Input
                        value={(formCampanha.briefing_ia.handoff_keywords || []).join(", ")}
                        onChange={(e) => setFormCampanha(prev => ({
                          ...prev,
                          briefing_ia: {
                            ...prev.briefing_ia,
                            handoff_keywords: e.target.value.split(",").map(s => s.trim()).filter(Boolean),
                          },
                        }))}
                        placeholder="salário, valor, remuneração"
                        className="bg-card text-xs"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-mh-ink-3 italic">
                  IA desativada. Quando o lead responder, a conversa fica na caixa normal pra alguém da equipe responder.
                </p>
              )}
            </div>

            {/* ═════════════ JANELA + LIMITES ═════════════ */}
            <div className="border-t pt-4">
              <Label className="flex items-center gap-2 mb-2">
                <span className="inline-block w-1 h-4 bg-mh-teal-600 rounded-full" />
                Janela e ritmo de disparo
              </Label>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Envios por dia</Label>
                  <Input
                    type="number" min={1} max={500}
                    value={formCampanha.envios_por_dia}
                    onChange={(e) => setFormCampanha({ ...formCampanha, envios_por_dia: parseInt(e.target.value) || 120 })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Horário início</Label>
                  <Input
                    type="time"
                    value={formCampanha.horario_inicio}
                    onChange={(e) => setFormCampanha({ ...formCampanha, horario_inicio: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Horário fim</Label>
                  <Input
                    type="time"
                    value={formCampanha.horario_fim}
                    onChange={(e) => setFormCampanha({ ...formCampanha, horario_fim: e.target.value })}
                  />
                </div>
              </div>
              <div className="mt-3">
                <Label className="text-xs mb-1 block">Dias da semana</Label>
                <div className="flex gap-1">
                  {DIAS_SEMANA.map(d => {
                    const selected = formCampanha.dias_semana.includes(d.value);
                    return (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => setFormCampanha(prev => ({
                          ...prev,
                          dias_semana: selected ? prev.dias_semana.filter(x => x !== d.value) : [...prev.dias_semana, d.value],
                        }))}
                        className={`flex-1 py-1.5 text-xs font-medium rounded border transition-colors ${
                          selected
                            ? "bg-mh-teal-600 text-white border-mh-teal-600"
                            : "bg-card border-border text-mh-ink-3"
                        }`}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="inline-flex items-center gap-2 mt-3 text-xs">
                <Checkbox
                  checked={formCampanha.spintax_ativo}
                  onCheckedChange={(c) => setFormCampanha({ ...formCampanha, spintax_ativo: !!c })}
                />
                <span>Ativar spintax na mensagem (variações aleatórias)</span>
              </label>
            </div>

            {/* Script de Atendimento IA */}
            {/* Filtro por perfil profissional */}
            <div>
              <Label>Filtrar por perfil profissional</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Só envia para leads cujo contato tenha esse perfil classificado
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: "medico", label: "Médico" },
                  { value: "cirurgiao_cardiaco", label: "Cirurgião Cardíaco" },
                  { value: "anestesista", label: "Anestesista" },
                  { value: "enfermeiro", label: "Enfermeiro" },
                  { value: "diretor_hospital", label: "Diretor Hospital" },
                  { value: "gestor_saude", label: "Gestor Saúde" },
                  { value: "paciente", label: "Paciente" },
                  { value: "paciente_pos_op", label: "Paciente Pós-op" },
                  { value: "patrocinador", label: "Patrocinador" },
                  { value: "fornecedor", label: "Fornecedor" },
                ].map(perfil => (
                  <Badge
                    key={perfil.value}
                    variant={formCampanha.filtro_perfil_profissional.includes(perfil.value) ? "default" : "outline"}
                    className="cursor-pointer transition-colors"
                    onClick={() => setFormCampanha(prev => ({
                      ...prev,
                      filtro_perfil_profissional: prev.filtro_perfil_profissional.includes(perfil.value)
                        ? prev.filtro_perfil_profissional.filter(p => p !== perfil.value)
                        : [...prev.filtro_perfil_profissional, perfil.value]
                    }))}
                  >
                    {perfil.label}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <Label>Script de Atendimento IA *</Label>
              <Select
                value={formCampanha.script_ia_id}
                onValueChange={(value) => setFormCampanha({ ...formCampanha, script_ia_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um script de atendimento..." />
                </SelectTrigger>
                <SelectContent>
                  {scriptsIA.map(script => (
                    <SelectItem key={script.id} value={script.id}>
                      {script.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Scripts são gerenciados na página Contexto IA
              </p>
            </div>

          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCampanhaDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveCampanha}>
              {editingCampanha ? "Salvar" : "Criar Campanha"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
