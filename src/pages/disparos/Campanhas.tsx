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

const tiposCampanha = [
  { value: "relacionamento", label: "Relacionamento", desc: "Manter contato com clientes existentes" },
  { value: "captacao", label: "Captação", desc: "Atrair novos leads e clientes" },
  { value: "reativacao", label: "Reativação", desc: "Recuperar leads inativos" },
  { value: "promocional", label: "Promocional", desc: "Divulgar ofertas e promoções" },
  { value: "informativo", label: "Informativo", desc: "Comunicados e informativos" },
  { value: "pesquisa", label: "Pesquisa", desc: "Pesquisas de satisfação" }
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
    filtro_tipo_lead: [] as string[],
    filtro_perfil_profissional: [] as string[],
    tipo_campanha: "relacionamento",
    script_ia_id: ""
  });

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
      fetchScriptsIA()
    ]);
    setLoading(false);
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
    if (!formCampanha.script_ia_id) {
      toast.error("Selecione um script de atendimento da IA");
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();

    if (editingCampanha) {
      const { error } = await supabase
        .from("campanhas_disparo")
        .update({
          nome: formCampanha.nome,
          descricao: formCampanha.descricao,
          mensagem: formCampanha.mensagem,
          tipo: formCampanha.tipo_campanha,
          instancia_id: formCampanha.instancia_id || null,
          filtro_tipo_lead: formCampanha.filtro_tipo_lead.length > 0 ? formCampanha.filtro_tipo_lead : null,
          filtro_perfil_profissional: formCampanha.filtro_perfil_profissional.length > 0 ? formCampanha.filtro_perfil_profissional : null,
          script_ia_id: formCampanha.script_ia_id || null
        })
        .eq("id", editingCampanha.id);

      if (error) {
        toast.error("Erro ao atualizar campanha");
        return;
      }
      toast.success("Campanha atualizada");
    } else {
      const { error } = await supabase
        .from("campanhas_disparo")
        .insert({
          nome: formCampanha.nome,
          descricao: formCampanha.descricao,
          mensagem: formCampanha.mensagem,
          tipo: formCampanha.tipo_campanha,
          instancia_id: formCampanha.instancia_id || null,
          filtro_tipo_lead: formCampanha.filtro_tipo_lead.length > 0 ? formCampanha.filtro_tipo_lead : null,
          filtro_perfil_profissional: formCampanha.filtro_perfil_profissional.length > 0 ? formCampanha.filtro_perfil_profissional : null,
          script_ia_id: formCampanha.script_ia_id || null,
          created_by: user?.id
        });

      if (error) {
        toast.error("Erro ao criar campanha");
        return;
      }
      toast.success("Campanha criada");
    }

    setCampanhaDialogOpen(false);
    setEditingCampanha(null);
    setFormCampanha({ nome: "", descricao: "", mensagem: "", instancia_id: "", filtro_tipo_lead: [], filtro_perfil_profissional: [], tipo_campanha: "relacionamento", script_ia_id: "" });
    fetchCampanhas();
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
    setFormCampanha({
      nome: campanha.nome,
      descricao: campanha.descricao || "",
      mensagem: campanha.mensagem,
      instancia_id: campanha.instancia_id || "",
      filtro_tipo_lead: campanha.filtro_tipo_lead || [],
      filtro_perfil_profissional: (campanha as any).filtro_perfil_profissional || [],
      tipo_campanha: campanha.tipo || "prospecção",
      script_ia_id: (campanha as any).script_ia_id || ""
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
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Campanhas</h1>
              <p className="text-muted-foreground mt-1">
                Crie e gerencie campanhas para disparos em massa
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
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditDialog(campanha)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
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
                placeholder="Digite a mensagem que será enviada..."
                rows={4}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Use {"{nome}"} para personalizar com o nome do lead
              </p>
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
