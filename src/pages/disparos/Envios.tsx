import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { 
  Plus, 
  Send, 
  Users, 
  Calendar,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  CalendarClock,
  Rocket,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  MessageCircle,
  Phone,
  ToggleLeft,
  ToggleRight,
  Filter,
  Bug,
  Trash2,
  Pause,
  Play,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  RotateCcw
} from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { format, addDays, setHours, setMinutes } from "date-fns";
import { ptBR } from "date-fns/locale";
import DisparoBreadcrumb from "@/components/DisparoBreadcrumb";
import DisparosTopNav from "@/components/DisparosTopNav";
import { formatBrazilianPhone } from "@/utils/brazilianPhoneUtils";

interface Lead {
  id: string;
  nome: string | null;
  telefone: string;
  tipo_lead: string | null;
  especialidade?: string | null;
  especialidade_id?: string | null;
}

interface Campanha {
  id: string;
  nome: string;
  mensagem: string;
  status: string;
}

interface Instancia {
  id: string;
  nome_instancia: string;
  connection_status: string | null;
  em_uso?: boolean; // Se está sendo usada em um disparo ativo
}

interface TipoLead {
  id: string;
  nome: string;
  cor: string;
}

interface Especialidade {
  id: string;
  nome: string;
  count?: number;
}

interface EnvioDisparo {
  id: string;
  campanha_id: string;
  instancia_id: string | null;
  status: string;
  total_leads: number;
  enviados: number;
  sucesso: number;
  falhas: number;
  agendado_para: string | null;
  iniciado_em: string | null;
  concluido_em: string | null;
  filtro_tipo_lead: string[] | null;
  ativo: boolean;
  campanhas_disparo?: { nome: string; mensagem: string } | null;
  instancias_whatsapp?: { nome_instancia: string } | null;
}

interface EnvioLead {
  id: string;
  lead_id: string;
  telefone: string;
  status: string | null;
  enviado_em: string | null;
  leads?: { nome: string | null } | null;
}

type EnvioLeadStatus = "enviar" | "reenviar" | "NoZap" | "enviado" | "tratando" | "contatado";

const ENVIOS_POR_DIA = 70;
const MAX_LEADS_POR_ENVIO = 350; // Limite máximo de leads por envio
const HORARIO_INICIO = 8;
const HORARIO_FIM = 18;
const INTERVALO_MIN = 10;
const INTERVALO_MAX = 15;

export default function EnviosPage() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [instancias, setInstancias] = useState<Instancia[]>([]);
  const [tiposLead, setTiposLead] = useState<TipoLead[]>([]);
  const [especialidades, setEspecialidades] = useState<Especialidade[]>([]);
  const [especialidadesCatalogo, setEspecialidadesCatalogo] = useState<Especialidade[]>([]);
  const [envios, setEnvios] = useState<EnvioDisparo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingLeadsDialog, setLoadingLeadsDialog] = useState(false);
  const [availableLeadsTotal, setAvailableLeadsTotal] = useState(0);
  
  // Dialog states
  const [novoEnvioOpen, setNovoEnvioOpen] = useState(false);
  const [agendarDialogOpen, setAgendarDialogOpen] = useState(false);
  const [detalhesOpen, setDetalhesOpen] = useState(false);
  const [configurarLeadsOpen, setConfigurarLeadsOpen] = useState(false);
  const [testeDialogOpen, setTesteDialogOpen] = useState(false);
  
  // Expanded rows state
  const [expandedEnvios, setExpandedEnvios] = useState<Set<string>>(new Set());
  const [envioLeads, setEnvioLeads] = useState<Record<string, EnvioLead[]>>({});
  const [loadingEnvioLeads, setLoadingEnvioLeads] = useState<Set<string>>(new Set());
  const [envioLeadsStatusFilter, setEnvioLeadsStatusFilter] = useState<Record<string, string>>({});
  const [envioLeadsSearchFilter, setEnvioLeadsSearchFilter] = useState<Record<string, string>>({});
  const [envioLeadsSort, setEnvioLeadsSort] = useState<Record<string, { field: string; dir: 'asc' | 'desc' }>>({});
  
  // Filter state
  const [mostrarInativos, setMostrarInativos] = useState(false);
  
  // Teste state
  const [testePayload, setTestePayload] = useState<any>(null);
  const [testando, setTestando] = useState(false);
  
  // Form states
  const [selectedCampanha, setSelectedCampanha] = useState<string>("");
  const [selectedInstancia, setSelectedInstancia] = useState<string>("");
  const [filterTipoLead, setFilterTipoLead] = useState<string>("");
  const [filterEspecialidade, setFilterEspecialidade] = useState<string>("");
  const [filterBusca, setFilterBusca] = useState<string>("");
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [agendamentoData, setAgendamentoData] = useState<string>("");
  const [agendamentoHora, setAgendamentoHora] = useState<string>("08:00");
  const [selectedEnvio, setSelectedEnvio] = useState<EnvioDisparo | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  // Realtime subscription for campanha_envios updates
  useEffect(() => {
    const channel = supabase
      .channel('campanha-envios-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'campanha_envios'
        },
        (payload) => {
          console.log('[REALTIME] campanha_envios:', payload.eventType, payload);
          const record = payload.new as any;
          
          if (payload.eventType === 'UPDATE') {
            setEnvioLeads(prev => {
              const updated = { ...prev };
              for (const envioId in updated) {
                updated[envioId] = updated[envioId].map(lead =>
                  lead.id === record.id 
                    ? { ...lead, status: record.status }
                    : lead
                );
              }
              return updated;
            });
          } else if (payload.eventType === 'DELETE') {
            const deleted = payload.old as any;
            setEnvioLeads(prev => {
              const updated = { ...prev };
              for (const envioId in updated) {
                updated[envioId] = updated[envioId].filter(lead => lead.id !== deleted.id);
              }
              return updated;
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Realtime subscription for envios_disparo updates
  useEffect(() => {
    const channel = supabase
      .channel('envios-disparo-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'envios_disparo'
        },
        (payload) => {
          console.log('[REALTIME] envios_disparo:', payload.eventType, payload);
          
          if (payload.eventType === 'INSERT') {
            const newEnvio = payload.new as EnvioDisparo;
            // Need to fetch with relations
            fetchEnvios();
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as EnvioDisparo;
            setEnvios(prev => prev.map(e => e.id === updated.id ? { ...e, ...updated } : e));
          } else if (payload.eventType === 'DELETE') {
            const deleted = payload.old as EnvioDisparo;
            setEnvios(prev => prev.filter(e => e.id !== deleted.id));
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
      fetchInstancias(),
      fetchEnvios(),
      fetchTiposLead(),
      fetchEspecialidades()
    ]);
    setLoading(false);
  };

  // Paginação de leads
  const LEADS_PER_PAGE = 500;
  const [leadsPage, setLeadsPage] = useState(1);

  const resolveEspecialidadeId = useCallback((value?: string | null) => {
    const normalizedValue = value?.trim();

    if (!normalizedValue) return "";

    const todasEspecialidades = [...especialidadesCatalogo, ...especialidades];

    const matchById = todasEspecialidades.find((esp) => esp.id === normalizedValue);
    if (matchById) return matchById.id;

    const matchByNome = todasEspecialidades.find(
      (esp) => esp.nome.localeCompare(normalizedValue, "pt-BR", { sensitivity: "base" }) === 0,
    );

    return matchByNome?.id || "";
  }, [especialidadesCatalogo, especialidades]);

  const normalizedFilterEspecialidade = useMemo(
    () => resolveEspecialidadeId(filterEspecialidade),
    [filterEspecialidade, resolveEspecialidadeId],
  );

  const especialidadesOptions = useMemo(
    () => (especialidades.length > 0 ? especialidades : especialidadesCatalogo),
    [especialidades, especialidadesCatalogo],
  );

  const fetchLeads = useCallback(async (campanhaId?: string, currentEnvioId?: string) => {
    if (!campanhaId) {
      setLeads([]);
      setEspecialidades(especialidadesCatalogo);
      setAvailableLeadsTotal(0);
      return;
    }

    try {
      const { data, error } = await supabase.rpc("listar_leads_disponiveis_disparo", {
        p_campanha_id: campanhaId,
        p_current_envio_id: currentEnvioId ?? null,
        p_filter_tipo_lead: filterTipoLead || null,
        p_filter_especialidade: normalizedFilterEspecialidade || null,
        p_filter_busca: filterBusca?.trim() || null,
        p_page: leadsPage,
        p_per_page: LEADS_PER_PAGE,
      });

      if (error) throw error;

      const result = data as {
        leads?: Lead[];
        total?: number;
        especialidades?: Especialidade[];
      } | null;

      setLeads(result?.leads || []);
      setEspecialidades((result?.especialidades?.length ? result.especialidades : especialidadesCatalogo) || []);
      setAvailableLeadsTotal(result?.total || 0);
    } catch (err) {
      console.error("Erro ao carregar leads:", err);
      setLeads([]);
      setEspecialidades(especialidadesCatalogo);
      setAvailableLeadsTotal(0);
    }
  }, [filterTipoLead, normalizedFilterEspecialidade, filterBusca, leadsPage, especialidadesCatalogo]);

  const fetchTiposLead = async () => {
    const { data } = await supabase
      .from("tipos_lead")
      .select("id, nome, cor")
      .order("nome");
    setTiposLead(data || []);
  };

  const fetchEspecialidades = async () => {
    const { data, error } = await supabase
      .from("especialidades")
      .select("id, nome")
      .order("nome");
    
    if (error) {
      console.error("Erro ao carregar especialidades:", error);
      setEspecialidadesCatalogo([]);
      setEspecialidades([]);
      return;
    }
    
    setEspecialidadesCatalogo(data || []);
    setEspecialidades(data || []);
  };

  const fetchCampanhas = async () => {
    // Buscar todas as campanhas (não apenas rascunho) - uma campanha pode ter vários envios
    const { data } = await supabase
      .from("campanhas_disparo")
      .select("id, nome, mensagem, status")
      .order("created_at", { ascending: false });
    setCampanhas(data || []);
  };

  const fetchInstancias = async () => {
    const { data, error } = await supabase
      .from("instancias_whatsapp")
      .select("id, nome_instancia, connection_status")
      .neq("status", "deletada")
      .order("nome_instancia");

    if (error) {
      console.error("Erro ao carregar instâncias:", error);
      setInstancias([]);
      return;
    }

    // Buscar instâncias que estão em disparos ativos (não concluídos e ativos)
    const { data: enviosAtivos } = await supabase
      .from("envios_disparo")
      .select("instancia_id")
      .eq("ativo", true)
      .not("status", "in", '("concluido","cancelado","pausado")');

    const instanciasEmUso = new Set(
      (enviosAtivos || []).map(e => e.instancia_id).filter(Boolean)
    );

    // Marcar instâncias em uso
    const instanciasComStatus = (data || []).map(inst => ({
      ...inst,
      em_uso: instanciasEmUso.has(inst.id)
    }));

    setInstancias(instanciasComStatus);
  };

  const fetchEnvios = async () => {
    const { data, error } = await supabase
      .from("envios_disparo")
      .select("*, campanhas_disparo(nome, mensagem), instancias_whatsapp(nome_instancia)")
      .order("created_at", { ascending: false });
    
    if (error) {
      console.error("Erro ao carregar envios:", error);
      setEnvios([]);
      return;
    }

    setEnvios(data || []);
  };

  // Fetch leads for a specific envio
  const fetchEnvioLeads = async (envioId: string, forceRefresh = false) => {
    if (envioLeads[envioId] && !forceRefresh) return; // Already loaded
    
    setLoadingEnvioLeads(prev => new Set(prev).add(envioId));
    
    const { data, error } = await supabase
      .from("campanha_envios")
      .select("id, lead_id, telefone, status, enviado_em, leads(nome)")
      .eq("envio_id", envioId);
    
    if (error) {
      console.error("Erro ao carregar leads do envio:", error);
    } else {
      const leads = data || [];
      setEnvioLeads(prev => ({ ...prev, [envioId]: leads }));
      
      // Sync total_leads with actual count in database and local state
      const actualCount = leads.length;
      const currentEnvio = envios.find(e => e.id === envioId);
      
      if (currentEnvio && currentEnvio.total_leads !== actualCount) {
        // Update database
        await supabase
          .from("envios_disparo")
          .update({ total_leads: actualCount })
          .eq("id", envioId);
        
        // Update local state
        setEnvios(prev => prev.map(e => 
          e.id === envioId ? { ...e, total_leads: actualCount } : e
        ));
      }
    }
    
    setLoadingEnvioLeads(prev => {
      const next = new Set(prev);
      next.delete(envioId);
      return next;
    });
  };

  // Toggle row expansion
  const toggleEnvioExpanded = async (envioId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const isExpanded = expandedEnvios.has(envioId);
    
    if (!isExpanded) {
      await fetchEnvioLeads(envioId);
    }
    
    setExpandedEnvios(prev => {
      const next = new Set(prev);
      if (isExpanded) {
        next.delete(envioId);
      } else {
        next.add(envioId);
      }
      return next;
    });
  };

  // Update lead status
  const handleUpdateLeadStatus = async (envioLeadId: string, newStatus: EnvioLeadStatus, envioId: string) => {
    const { error } = await supabase
      .from("campanha_envios")
      .update({ status: newStatus })
      .eq("id", envioLeadId);
    
    if (error) {
      toast.error("Erro ao atualizar status");
      return;
    }
    
    // Update local state
    setEnvioLeads(prev => ({
      ...prev,
      [envioId]: prev[envioId]?.map(l => 
        l.id === envioLeadId ? { ...l, status: newStatus } : l
      ) || []
    }));
    
    toast.success("Status atualizado");
  };

  // Remove lead from envio
  const handleRemoveLeadFromEnvio = async (envioLeadId: string, envioId: string) => {
    const { error } = await supabase
      .from("campanha_envios")
      .delete()
      .eq("id", envioLeadId);
    
    if (error) {
      toast.error("Erro ao remover lead");
      return;
    }
    
    // Update local envioLeads state
    const updatedLeads = (envioLeads[envioId] || []).filter(l => l.id !== envioLeadId);
    setEnvioLeads(prev => ({
      ...prev,
      [envioId]: updatedLeads
    }));

    // Calculate new total from actual leads count
    const newTotal = updatedLeads.length;
    
    // Update envio total_leads count in database
    const { error: updateError } = await supabase
      .from("envios_disparo")
      .update({ total_leads: newTotal })
      .eq("id", envioId);
    
    if (updateError) {
      console.error("Erro ao atualizar total_leads:", updateError);
    }
    
    // Update local envios state immediately
    setEnvios(prev => prev.map(e =>
      e.id === envioId ? { ...e, total_leads: newTotal } : e
    ));

    // Atualiza lista de leads disponíveis para novos disparos
    if ((novoEnvioOpen && selectedCampanha) || (configurarLeadsOpen && selectedEnvio?.campanha_id)) {
      await fetchLeads(configurarLeadsOpen ? selectedEnvio?.campanha_id : selectedCampanha, configurarLeadsOpen ? selectedEnvio?.id : undefined);
    }

    toast.success("Lead removido do disparo");
  };

  // Get status badge for envio lead
  const getEnvioLeadStatusBadge = (status: string | null) => {
    const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className?: string; animated?: boolean }> = {
      enviar: { label: "Enviar", variant: "outline", className: "border-blue-500 text-blue-500" },
      reenviar: { label: "Reenviar", variant: "outline", className: "border-orange-500 text-orange-500" },
      tratando: { label: "Tratando", variant: "secondary", className: "bg-purple-100 text-purple-700 border-purple-300", animated: true },
      NoZap: { label: "No Zap", variant: "destructive" },
      enviado: { label: "Enviado", variant: "default", className: "bg-green-500" },
      contatado: { label: "Contatado", variant: "default", className: "bg-teal-500 text-white" },
      erro: { label: "Erro", variant: "destructive" },
      cancelado: { label: "Cancelado", variant: "secondary", className: "text-muted-foreground" },
      bloqueado: { label: "Bloqueado", variant: "destructive", className: "bg-orange-600" }
    };
    const config = statusConfig[status || "enviar"] || statusConfig.enviar;
    return (
      <Badge variant={config.variant} className={`${config.className || ""} ${config.animated ? "animate-pulse" : ""}`}>
        {config.animated && <RefreshCw className="h-3 w-3 mr-1 animate-spin" />}
        {config.label}
      </Badge>
    );
  };

  const tiposLeadComLeads = useMemo(() => tiposLead, [tiposLead]);

  const filteredLeads = leads;

  const totalLeadPages = useMemo(() => Math.max(1, Math.ceil(availableLeadsTotal / LEADS_PER_PAGE)), [availableLeadsTotal]);
  const visibleLeads = useMemo(() => leads, [leads]);

  // Reset page when filters change
  useEffect(() => { setLeadsPage(1); }, [filterTipoLead, filterEspecialidade, filterBusca]);

  useEffect(() => {
    if (!filterEspecialidade) return;
    if (normalizedFilterEspecialidade !== filterEspecialidade) {
      setFilterEspecialidade(normalizedFilterEspecialidade);
    }
  }, [filterEspecialidade, normalizedFilterEspecialidade]);

  useEffect(() => {
    const campanhaAtiva = configurarLeadsOpen ? selectedEnvio?.campanha_id : selectedCampanha;
    const envioAtual = configurarLeadsOpen ? selectedEnvio?.id : undefined;
    const dialogAberto = novoEnvioOpen || configurarLeadsOpen;

    if (!dialogAberto || !campanhaAtiva) return;

    setLoadingLeadsDialog(true);
    fetchLeads(campanhaAtiva, envioAtual).finally(() => setLoadingLeadsDialog(false));
  }, [novoEnvioOpen, configurarLeadsOpen, selectedCampanha, selectedEnvio?.id, selectedEnvio?.campanha_id, fetchLeads]);

  // Toggle lead selection (respeitando limite)
  const handleToggleLead = (leadId: string) => {
    setSelectedLeadIds(prev => {
      if (prev.includes(leadId)) {
        return prev.filter(id => id !== leadId);
      }
      if (prev.length >= MAX_LEADS_POR_ENVIO) {
        toast.warning(`Limite máximo de ${MAX_LEADS_POR_ENVIO} leads por envio atingido`);
        return prev;
      }
      return [...prev, leadId];
    });
  };

  // Select all filtered leads (até o limite)
  const handleSelectAllFiltered = () => {
    const filteredIds = filteredLeads.map(l => l.id);
    const allSelected = filteredIds.length > 0 && filteredIds.slice(0, MAX_LEADS_POR_ENVIO).every(id => selectedLeadIds.includes(id));
    
    if (allSelected) {
      // Deselect all filtered
      setSelectedLeadIds(prev => prev.filter(id => !filteredIds.includes(id)));
    } else {
      // Select até o limite
      const idsParaAdicionar = filteredIds.filter(id => !selectedLeadIds.includes(id));
      const espacoDisponivel = MAX_LEADS_POR_ENVIO - selectedLeadIds.length;
      const idsAAdicionar = idsParaAdicionar.slice(0, espacoDisponivel);
      
      if (idsAAdicionar.length < idsParaAdicionar.length) {
        toast.warning(`Apenas ${idsAAdicionar.length} leads selecionados. Limite de ${MAX_LEADS_POR_ENVIO} por envio.`);
      }
      
      setSelectedLeadIds(prev => [...prev, ...idsAAdicionar]);
    }
  };

  // Calculate days needed for sending
  const calcularDiasNecessarios = (totalLeads: number): number => {
    return Math.ceil(totalLeads / ENVIOS_POR_DIA);
  };

  // Calculate end date (only weekdays)
  const calcularDataFim = (dataInicio: Date, diasNecessarios: number): Date => {
    let diasContados = 0;
    let dataAtual = new Date(dataInicio);
    
    while (diasContados < diasNecessarios) {
      const diaSemana = dataAtual.getDay();
      if (diaSemana !== 0 && diaSemana !== 6) {
        diasContados++;
      }
      if (diasContados < diasNecessarios) {
        dataAtual = addDays(dataAtual, 1);
      }
    }
    
    return dataAtual;
  };

  // Criar envio na nova tabela envios_disparo
  const handleCriarDisparo = async () => {
    if (!selectedCampanha || !selectedInstancia) {
      toast.error("Selecione uma campanha e uma instância");
      return;
    }

    if (selectedLeadIds.length === 0) {
      toast.error("Selecione pelo menos um lead");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();

    // Criar novo envio na tabela envios_disparo
    const { data: envioData, error } = await supabase
      .from("envios_disparo")
      .insert({
        campanha_id: selectedCampanha,
        instancia_id: selectedInstancia,
        status: "agendada",
        total_leads: selectedLeadIds.length,
        envios_por_dia: ENVIOS_POR_DIA,
        intervalo_min_minutos: INTERVALO_MIN,
        intervalo_max_minutos: INTERVALO_MAX,
        horario_inicio: `${String(HORARIO_INICIO).padStart(2, "0")}:00:00`,
        horario_fim: `${String(HORARIO_FIM).padStart(2, "0")}:00:00`,
        dias_semana: [1, 2, 3, 4, 5],
        created_by: userData?.user?.id || null
      })
      .select()
      .single();

    if (error || !envioData) {
      console.error("Erro ao criar envio:", error);
      toast.error("Erro ao criar disparo");
      return;
    }

    // Filtrar apenas leads com números válidos
    const leadsParaEnviar = leads.filter(l => selectedLeadIds.includes(l.id));
    const leadsValidos = leadsParaEnviar.filter(lead => {
      const result = formatBrazilianPhone(lead.telefone);
      return result.isValid;
    });
    const leadsInvalidos = leadsParaEnviar.length - leadsValidos.length;

    if (leadsValidos.length === 0) {
      toast.error("Nenhum lead selecionado possui número válido");
      return;
    }

    const enviosParaInserir = leadsValidos.map(lead => {
      const phoneResult = formatBrazilianPhone(lead.telefone);
      return {
        campanha_id: selectedCampanha,
        envio_id: envioData.id,
        lead_id: lead.id,
        telefone: phoneResult.formatted, // Número já formatado
        status: "enviar"
      };
    });

    const { error: enviosError } = await supabase
      .from("campanha_envios")
      .upsert(enviosParaInserir, { onConflict: "lead_id,campanha_id", ignoreDuplicates: true });

    if (enviosError) {
      console.error("Erro ao criar envios:", enviosError);
    }

    // Contar leads realmente inseridos para este envio (ignoreDuplicates pode ter ignorado alguns)
    const { count: realCount } = await supabase
      .from("campanha_envios")
      .select("id", { count: "exact", head: true })
      .eq("envio_id", envioData.id);

    const totalReal = realCount || 0;

    // Atualizar total_leads com o número real de leads inseridos
    await supabase
      .from("envios_disparo")
      .update({ total_leads: totalReal })
      .eq("id", envioData.id);

    const duplicadosIgnorados = leadsValidos.length - totalReal;

    if (totalReal === 0) {
      toast.error("Nenhum lead novo foi adicionado — todos já participam desta campanha.");
    } else if (leadsInvalidos > 0 || duplicadosIgnorados > 0) {
      const msgs: string[] = [`Disparo criado com ${totalReal} leads`];
      if (leadsInvalidos > 0) msgs.push(`${leadsInvalidos} ignorados por número inválido`);
      if (duplicadosIgnorados > 0) msgs.push(`${duplicadosIgnorados} ignorados por já estarem na campanha`);
      toast.warning(msgs.join(". ") + ".");
    } else {
      toast.success(`Disparo criado com ${totalReal} leads!`);
    }
    setNovoEnvioOpen(false);
    resetForm();
    await Promise.all([fetchEnvios(), fetchInstancias()]);
  };

  // Agendar envio
  const handleAgendarEnvio = async () => {
    if (!selectedEnvio || !agendamentoData) {
      toast.error("Selecione uma data de início");
      return;
    }

    const [hora, minuto] = agendamentoHora.split(":").map(Number);
    const dataInicio = new Date(agendamentoData + "T00:00:00-03:00");
    const dataInicioCompleta = setMinutes(setHours(dataInicio, hora), minuto);

    // Verificar se há leads no envio
    const { count } = await supabase
      .from("campanha_envios")
      .select("*", { count: "exact", head: true })
      .eq("envio_id", selectedEnvio.id);

    if (!count || count === 0) {
      toast.error("Configure os leads antes de agendar");
      return;
    }

    // Atualizar envio com status agendada
    const { error: envioError } = await supabase
      .from("envios_disparo")
      .update({
        status: "agendada",
        agendado_para: dataInicioCompleta.toISOString()
      })
      .eq("id", selectedEnvio.id);

    if (envioError) {
      toast.error("Erro ao agendar envio");
      return;
    }

    toast.success(`Envio agendado para ${count} leads`);
    setAgendarDialogOpen(false);
    setSelectedEnvio(null);
    setAgendamentoData("");
    setAgendamentoHora("08:00");
    fetchEnvios();
  };

  // Guard para evitar duplo-clique no envio
  const [enviandoIds, setEnviandoIds] = useState<Set<string>>(new Set());

  // Enviar agora - chama a edge function
  const handleEnviarAgora = async (envio: EnvioDisparo) => {
    // Guard: evitar duplo-clique - setar ANTES de qualquer operação async
    if (enviandoIds.has(envio.id)) {
      toast.warning("Envio já em andamento, aguarde...");
      return;
    }
    setEnviandoIds(prev => new Set(prev).add(envio.id));

    // Verificar se há leads no envio
    const { count } = await supabase
      .from("campanha_envios")
      .select("*", { count: "exact", head: true })
      .eq("envio_id", envio.id)
      .in("status", ["enviar", "reenviar"]);

    if (!count || count === 0) {
      toast.error("Nenhum lead pendente para enviar");
      setEnviandoIds(prev => {
        const next = new Set(prev);
        next.delete(envio.id);
        return next;
      });
      return;
    }

    toast.info(`Enviando lote de até 70 leads para o n8n...`);

    try {
      const { data, error } = await supabase.functions.invoke("processar-envios-massa", {
        body: {
          envio_id: envio.id,
          test_mode: false
        }
      });

      if (error) {
        console.error("Erro ao chamar edge function:", error);
        toast.error("Erro ao processar envio");
        return;
      }

      console.log("[ENVIAR] Resposta da edge function:", data);

      if (data?.success) {
        toast.success(data.message || `Lote enviado com sucesso!`);
      } else {
        toast.error(data?.error || "Erro ao processar envio");
      }

      fetchEnvios();
      
      // Recarregar leads do envio se estiver expandido
      if (expandedEnvios.has(envio.id)) {
        setEnvioLeads(prev => {
          const updated = { ...prev };
          delete updated[envio.id];
          return updated;
        });
        await fetchEnvioLeads(envio.id);
      }
    } catch (err) {
      console.error("Erro:", err);
      toast.error("Erro ao processar envio");
    } finally {
      setEnviandoIds(prev => {
        const next = new Set(prev);
        next.delete(envio.id);
        return next;
      });
    }
  };


  // Atualizar leads do envio
  const handleAtualizarLeads = async () => {
    if (!selectedEnvio) return;

    if (!selectedInstancia) {
      toast.error("Selecione uma instância de envio");
      return;
    }

    if (selectedLeadIds.length === 0) {
      toast.error("Selecione pelo menos um lead");
      return;
    }

    // Deletar envios antigos
    await supabase
      .from("campanha_envios")
      .delete()
      .eq("envio_id", selectedEnvio.id);

    // Filtrar apenas leads com números válidos
    const leadsParaEnviar = leads.filter(l => selectedLeadIds.includes(l.id));
    const leadsValidos = leadsParaEnviar.filter(lead => {
      const result = formatBrazilianPhone(lead.telefone);
      return result.isValid;
    });
    const leadsInvalidos = leadsParaEnviar.length - leadsValidos.length;

    if (leadsValidos.length === 0) {
      toast.error("Nenhum lead selecionado possui número válido");
      return;
    }

    const enviosParaInserir = leadsValidos.map(lead => {
      const phoneResult = formatBrazilianPhone(lead.telefone);
      return {
        campanha_id: selectedEnvio.campanha_id,
        envio_id: selectedEnvio.id,
        lead_id: lead.id,
        telefone: phoneResult.formatted, // Número já formatado
        status: "enviar"
      };
    });

    await supabase
      .from("campanha_envios")
      .upsert(enviosParaInserir, { onConflict: "lead_id,campanha_id", ignoreDuplicates: true });

    // Atualizar total e instância
    await supabase
      .from("envios_disparo")
      .update({ 
        total_leads: leadsValidos.length,
        instancia_id: selectedInstancia 
      })
      .eq("id", selectedEnvio.id);

    if (leadsInvalidos > 0) {
      toast.warning(`Leads atualizados: ${leadsValidos.length} válidos, ${leadsInvalidos} ignorados por número inválido.`);
    } else {
      toast.success(`Leads atualizados: ${leadsValidos.length}`);
    }

    setConfigurarLeadsOpen(false);
    setSelectedLeadIds([]);
    setSelectedInstancia("");
    fetchEnvios();
  };

  // Toggle ativo/inativo
  const handleToggleAtivo = async (envio: EnvioDisparo) => {
    const novoStatus = !envio.ativo;
    
   // Se estiver desativando, cancelar leads pendentes (enviar/reenviar/tratando)
    // IMPORTANTE: Não deletar, apenas mudar status para "cancelado"
    // Isso preserva o UNIQUE constraint (lead_id, campanha_id) e evita reenvios duplicados
    if (!novoStatus) {
      const { error: cancelError, count } = await supabase
        .from("campanha_envios")
        .update({ status: "cancelado", erro: "Disparo desativado pelo usuário" })
        .eq("envio_id", envio.id)
        .in("status", ["enviar", "reenviar", "tratando"]);
      
      if (cancelError) {
        console.error("Erro ao cancelar leads pendentes:", cancelError);
        toast.error("Erro ao cancelar leads pendentes");
        return;
      }
      
      if (count && count > 0) {
        console.log(`[TOGGLE] Cancelados ${count} leads pendentes do disparo ${envio.id}`);
      }
      
      // Atualizar envio: desativar e mudar status para cancelado
      await supabase
        .from("envios_disparo")
        .update({ ativo: novoStatus, status: "cancelado" })
        .eq("id", envio.id);
      
      // Limpar cache local dos leads deste envio
      setEnvioLeads(prev => {
        const updated = { ...prev };
        delete updated[envio.id];
        return updated;
      });
      
      toast.success(`Disparo desativado. ${count || 0} leads cancelados.`);
    } else {
      const { error } = await supabase
        .from("envios_disparo")
        .update({ ativo: novoStatus })
        .eq("id", envio.id);
      
      if (error) {
        toast.error("Erro ao atualizar status");
        return;
      }
      
      toast.success("Disparo ativado");
    }
    
    fetchEnvios();
    if ((novoEnvioOpen && selectedCampanha) || (configurarLeadsOpen && selectedEnvio?.campanha_id)) {
      fetchLeads(configurarLeadsOpen ? selectedEnvio?.campanha_id : selectedCampanha, configurarLeadsOpen ? selectedEnvio?.id : undefined);
    }
  };

  // Pausar/Retomar envio
  const handlePausarEnvio = async (envio: EnvioDisparo) => {
    const isPausado = envio.status === "pausado";
    const novoStatus = isPausado ? "agendada" : "pausado";
    
    const { error } = await supabase
      .from("envios_disparo")
      .update({ status: novoStatus })
      .eq("id", envio.id);
    
    if (error) {
      toast.error("Erro ao atualizar status do envio");
      return;
    }
    
    toast.success(isPausado ? "Envio retomado" : "Envio pausado");
    fetchEnvios();
  };

  // Trocar instância do envio
  const handleTrocarInstancia = async (envioId: string, novaInstanciaId: string) => {
    const { error } = await supabase
      .from("envios_disparo")
      .update({ instancia_id: novaInstanciaId })
      .eq("id", envioId);
    
    if (error) {
      toast.error("Erro ao trocar instância");
      return;
    }
    
    // Atualizar estado local
    setEnvios(prev => prev.map(e => 
      e.id === envioId 
        ? { 
            ...e, 
            instancia_id: novaInstanciaId,
            instancias_whatsapp: instancias.find(i => i.id === novaInstanciaId) 
              ? { nome_instancia: instancias.find(i => i.id === novaInstanciaId)!.nome_instancia }
              : null
          } 
        : e
    ));
    
    toast.success("Instância atualizada");
    await fetchInstancias(); // Atualizar lista de instâncias em uso
  };

  // Filter envios by ativo status
  const enviosFiltrados = useMemo(() => {
    if (mostrarInativos) {
      return envios;
    }
    return envios.filter(e => e.ativo);
  }, [envios, mostrarInativos]);

  // Testar envio (modo teste - só mostra o payload)
  const handleTestarEnvio = async (envio: EnvioDisparo) => {
    setTestando(true);
    setTestePayload(null);
    
    try {
      const { data, error } = await supabase.functions.invoke("processar-envios-massa", {
        body: {
          envio_id: envio.id,
          test_mode: true,
          limit: 3 // Limitar a 3 leads para teste
        }
      });

      if (error) {
        toast.error("Erro ao testar envio");
        console.error(error);
        return;
      }

      setTestePayload(data);
      setTesteDialogOpen(true);
    } catch (err) {
      console.error(err);
      toast.error("Erro ao testar envio");
    } finally {
      setTestando(false);
    }
  };

  const resetForm = () => {
    setSelectedCampanha("");
    setSelectedInstancia("");
    setSelectedLeadIds([]);
    setFilterTipoLead("");
    setFilterEspecialidade("");
    setFilterBusca("");
    setLeads([]);
    setEspecialidades(especialidadesCatalogo);
    setAvailableLeadsTotal(0);
    setLeadsPage(1);
    setAgendamentoData("");
    setAgendamentoHora("08:00");
  };

  const getStatusBadge = (status: string) => {
    const config: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
      agendada: { label: "Agendada", variant: "secondary", icon: <CalendarClock className="h-3 w-3 mr-1" /> },
      em_andamento: { label: "Em Andamento", variant: "default", icon: <Rocket className="h-3 w-3 mr-1" /> },
      processando: { label: "Processando", variant: "default", icon: <RefreshCw className="h-3 w-3 mr-1" /> },
      pausado: { label: "Pausado", variant: "outline", icon: <Clock className="h-3 w-3 mr-1" /> },
      concluido: { label: "Concluído", variant: "outline", icon: <CheckCircle className="h-3 w-3 mr-1" /> },
      concluida: { label: "Concluída", variant: "outline", icon: <CheckCircle className="h-3 w-3 mr-1" /> },
      cancelada: { label: "Cancelada", variant: "destructive", icon: <XCircle className="h-3 w-3 mr-1" /> }
    };
    const c = config[status] || { label: status, variant: "secondary" as const, icon: null };
    return (
      <Badge variant={c.variant} className="flex items-center">
        {c.icon}
        {c.label}
      </Badge>
    );
  };

  const openAgendarDialog = (envio: EnvioDisparo) => {
    setSelectedEnvio(envio);
    setAgendarDialogOpen(true);
  };

  const openConfigurarLeads = async (envio: EnvioDisparo) => {
    setSelectedEnvio(envio);
    setLoadingLeadsDialog(true);
    // Definir a instância atual do envio
    setSelectedInstancia(envio.instancia_id || "");
    setConfigurarLeadsOpen(true);
    
    // Carregar leads (excluindo os da mesma campanha), instâncias e leads já selecionados
    const [, , selectedRes] = await Promise.all([
      fetchLeads(envio.campanha_id, envio.id),
      fetchInstancias(),
      supabase
        .from("campanha_envios")
        .select("lead_id")
        .eq("envio_id", envio.id)
    ]);
    
    setSelectedLeadIds(selectedRes.data?.map(d => d.lead_id) || []);
    setLoadingLeadsDialog(false);
  };

  const diasNecessarios = selectedEnvio 
    ? calcularDiasNecessarios(selectedEnvio.total_leads || filteredLeads.length)
    : calcularDiasNecessarios(filteredLeads.length);
  
  const dataFimEstimada = agendamentoData 
    ? calcularDataFim(new Date(agendamentoData), diasNecessarios)
    : null;

  return (
    <div className="p-4 md:p-6">
      <DisparosTopNav />
      <div className="space-y-6">
          <DisparoBreadcrumb 
            items={[
              { label: "Disparos em Massa", href: "/disparos-em-massa" },
              { label: "Envios" }
            ]} 
          />
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Envios</h1>
              <p className="text-muted-foreground mt-1">
                Configure e agende disparos em massa
              </p>
            </div>
          <Button
            onClick={() => {
              setNovoEnvioOpen(true);
              setLeadsPage(1);
              fetchInstancias();
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Novo Envio
          </Button>
        </div>

        {/* Info Card */}
        <Card className="bg-muted/50 border-dashed">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <AlertTriangle className="h-6 w-6 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p className="font-medium">Regras de Envio</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• <strong>{ENVIOS_POR_DIA} disparos por dia</strong> por instância (limite para evitar bloqueios)</li>
                  <li>• Horário de envio: <strong>{HORARIO_INICIO}:00 às {HORARIO_FIM}:00</strong> (horário de Brasília)</li>
                  <li>• Intervalo entre mensagens: <strong>{INTERVALO_MIN} a {INTERVALO_MAX} minutos</strong> (aleatório)</li>
                  <li>• Envios apenas de <strong>segunda a sexta-feira</strong></li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <Send className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-2xl font-bold">{envios.length}</p>
                  <p className="text-sm text-muted-foreground">Total de Envios</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <Clock className="h-8 w-8 text-orange-500" />
                <div>
                  <p className="text-2xl font-bold">
                    {envios.filter(e => e.status === "pausado" && e.ativo).length}
                  </p>
                  <p className="text-sm text-muted-foreground">Pausados</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <CalendarClock className="h-8 w-8 text-yellow-500" />
                <div>
                  <p className="text-2xl font-bold">
                    {envios.filter(e => e.status === "agendada" && e.ativo).length}
                  </p>
                  <p className="text-sm text-muted-foreground">Agendados</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <CheckCircle className="h-8 w-8 text-green-500" />
                <div>
                  <p className="text-2xl font-bold">
                    {envios.reduce((acc, e) => acc + e.sucesso, 0)}
                  </p>
                  <p className="text-sm text-muted-foreground">Enviados com Sucesso</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Envios Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Histórico de Envios</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant={mostrarInativos ? "secondary" : "outline"}
                size="sm"
                onClick={() => setMostrarInativos(!mostrarInativos)}
              >
                <Filter className="h-4 w-4 mr-1" />
                {mostrarInativos ? "Mostrando todos" : "Apenas ativos"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-4 md:p-6">
            <div className="space-y-4">
              {enviosFiltrados.map((envio, index) => {
                const isExpanded = expandedEnvios.has(envio.id);
                const isLoadingLeads = loadingEnvioLeads.has(envio.id);
                const leadsDoEnvio = envioLeads[envio.id] || [];
                
                // Generate a color based on index for visual distinction
                const borderColors = [
                  "border-l-blue-500",
                  "border-l-emerald-500",
                  "border-l-violet-500",
                  "border-l-amber-500",
                  "border-l-rose-500",
                  "border-l-cyan-500",
                  "border-l-orange-500",
                  "border-l-teal-500",
                ];
                const colorIndex = index % borderColors.length;
                const borderColor = borderColors[colorIndex];
                
                return (
                  <div 
                    key={envio.id}
                    className={`border rounded-lg border-l-4 ${borderColor} bg-card ${!envio.ativo ? "opacity-50" : ""}`}
                  >
                    {/* Main row */}
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10"></TableHead>
                            <TableHead>Campanha</TableHead>
                            <TableHead>Instância</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Leads</TableHead>
                            <TableHead>Progresso</TableHead>
                            <TableHead>Agendado para</TableHead>
                            <TableHead className="text-right">Ações</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <TableRow 
                            className="cursor-pointer hover:bg-muted/50 border-0"
                          >
                            <TableCell onClick={(e) => toggleEnvioExpanded(envio.id, e)}>
                              <Button variant="ghost" size="icon" className="h-6 w-6">
                                {isLoadingLeads ? (
                                  <RefreshCw className="h-4 w-4 animate-spin" />
                                ) : isExpanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </Button>
                            </TableCell>
                            <TableCell className="font-medium" onClick={(e) => toggleEnvioExpanded(envio.id, e)}>
                              {envio.campanhas_disparo?.nome || "-"}
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              {["agendada", "pausado", "pendente"].includes(envio.status) ? (
                                <Select 
                                  value={envio.instancia_id || ""} 
                                  onValueChange={(val) => handleTrocarInstancia(envio.id, val)}
                                >
                                  <SelectTrigger className="h-8 w-40">
                                    <SelectValue placeholder="Selecionar instância">
                                      {envio.instancias_whatsapp?.nome_instancia || "Selecionar..."}
                                    </SelectValue>
                                  </SelectTrigger>
                                  <SelectContent>
                                    {instancias.map(inst => (
                                      <SelectItem key={inst.id} value={inst.id}>
                                        {inst.nome_instancia}
                                        {inst.connection_status !== "connected" && " (desc.)"}
                                        {inst.em_uso && inst.id !== envio.instancia_id && " (em uso)"}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <span onClick={(e) => { e.stopPropagation(); toggleEnvioExpanded(envio.id, e); }}>
                                  {envio.instancias_whatsapp?.nome_instancia || "-"}
                                </span>
                              )}
                            </TableCell>
                            <TableCell onClick={(e) => toggleEnvioExpanded(envio.id, e)}>{getStatusBadge(envio.status)}</TableCell>
                            <TableCell onClick={(e) => toggleEnvioExpanded(envio.id, e)}>{envio.total_leads}</TableCell>
                            <TableCell className="w-40" onClick={(e) => toggleEnvioExpanded(envio.id, e)}>
                              <div className="space-y-1">
                                <Progress 
                                  value={envio.total_leads > 0 ? (envio.enviados / envio.total_leads) * 100 : 0} 
                                />
                                <p className="text-xs text-muted-foreground">
                                  {envio.enviados}/{envio.total_leads} ({envio.sucesso} ✓ / {envio.falhas} ✗)
                                </p>
                              </div>
                            </TableCell>
                            <TableCell onClick={(e) => toggleEnvioExpanded(envio.id, e)}>
                              {envio.agendado_para 
                                ? format(new Date(envio.agendado_para), "dd/MM/yyyy HH:mm", { locale: ptBR })
                                : "-"
                              }
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                {["agendada", "em_andamento", "processando", "pausado"].includes(envio.status) && (
                                  <>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => openConfigurarLeads(envio)}
                                    >
                                      <Users className="h-4 w-4 mr-1" />
                                      Leads
                                    </Button>
                                    <Button
                                      variant={envio.status === "pausado" ? "default" : "secondary"}
                                      size="sm"
                                      onClick={() => handlePausarEnvio(envio)}
                                      disabled={envio.status === "processando"}
                                      title={envio.status === "pausado" ? "Retomar envios" : "Pausar envios"}
                                    >
                                      {envio.status === "pausado" ? (
                                        <Play className="h-4 w-4 mr-1" />
                                      ) : (
                                        <Pause className="h-4 w-4 mr-1" />
                                      )}
                                      {envio.status === "pausado" ? "Retomar" : "Pausar"}
                                    </Button>
                                    <Button
                                      size="sm"
                                      onClick={() => handleEnviarAgora(envio)}
                                      disabled={envio.status === "processando"}
                                    >
                                      {envio.status === "processando" ? (
                                        <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                                      ) : (
                                        <Rocket className="h-4 w-4 mr-1" />
                                      )}
                                      {envio.status === "processando" ? "Processando..." : "Enviar"}
                                    </Button>
                                  </>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleToggleAtivo(envio)}
                                  title={envio.ativo ? "Desativar" : "Ativar"}
                                >
                                  {envio.ativo ? (
                                    <ToggleRight className="h-4 w-4 text-green-500" />
                                  ) : (
                                    <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                                  )}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                    
                    {/* Expanded section with leads */}
                    {isExpanded && (() => {
                      const currentFilter = envioLeadsStatusFilter[envio.id] || "todos";
                      
                      // Count leads by status
                      const statusCounts = leadsDoEnvio.reduce((acc, lead) => {
                        const status = lead.status || "enviar";
                        acc[status] = (acc[status] || 0) + 1;
                        return acc;
                      }, {} as Record<string, number>);
                      
                      // Filter leads based on selected status and search
                      const searchTerm = (envioLeadsSearchFilter[envio.id] || "").toLowerCase();
                      const filteredEnvioLeads = leadsDoEnvio.filter(lead => {
                        const matchesStatus = currentFilter === "todos" || (lead.status || "enviar") === currentFilter;
                        const searchDigits = searchTerm.replace(/\D/g, "");
                        const matchesSearch = !searchTerm || 
                          (lead.leads?.nome || "").toLowerCase().includes(searchTerm) ||
                          (searchDigits && lead.telefone.includes(searchDigits));
                        return matchesStatus && matchesSearch;
                      });

                      // Sort
                      const sortConfig = envioLeadsSort[envio.id];
                      if (sortConfig) {
                        filteredEnvioLeads.sort((a, b) => {
                          let valA: string, valB: string;
                          switch (sortConfig.field) {
                            case 'nome':
                              valA = (a.leads?.nome || "").toLowerCase();
                              valB = (b.leads?.nome || "").toLowerCase();
                              break;
                            case 'telefone':
                              valA = a.telefone;
                              valB = b.telefone;
                              break;
                            case 'status':
                              valA = a.status || "enviar";
                              valB = b.status || "enviar";
                              break;
                            case 'enviado_em':
                              valA = a.enviado_em || "";
                              valB = b.enviado_em || "";
                              break;
                            default:
                              return 0;
                          }
                          if (valA < valB) return sortConfig.dir === 'asc' ? -1 : 1;
                          if (valA > valB) return sortConfig.dir === 'asc' ? 1 : -1;
                          return 0;
                        });
                      }

                      // Available statuses for filter
                      const statusOptions = [
                        { value: "todos", label: "Todos", count: leadsDoEnvio.length },
                        { value: "enviar", label: "Enviar", count: statusCounts["enviar"] || 0 },
                        { value: "reenviar", label: "Reenviar", count: statusCounts["reenviar"] || 0 },
                        { value: "tratando", label: "Tratando", count: statusCounts["tratando"] || 0 },
                        { value: "enviado", label: "Enviado", count: statusCounts["enviado"] || 0 },
                        { value: "NoZap", label: "No Zap", count: statusCounts["NoZap"] || 0 },
                        { value: "erro", label: "Erro", count: statusCounts["erro"] || 0 },
                        { value: "bloqueado", label: "Bloqueado", count: statusCounts["bloqueado"] || 0 },
                      ].filter(opt => opt.value === "todos" || opt.count > 0);
                      
                      return (
                      <div className="border-t bg-muted/30 p-4">
                        <div className="flex flex-col gap-3 mb-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <Users className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm font-medium">
                                Leads do Envio ({filteredEnvioLeads.length}{currentFilter !== "todos" || searchTerm ? ` de ${leadsDoEnvio.length}` : ""})
                              </span>
                            </div>
                          
                            {/* Status filter pills */}
                            <div className="flex flex-wrap items-center gap-2">
                              {statusOptions.map(opt => (
                                <Button
                                  key={opt.value}
                                  variant={currentFilter === opt.value ? "default" : "outline"}
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => setEnvioLeadsStatusFilter(prev => ({ ...prev, [envio.id]: opt.value }))}
                                >
                                  {opt.label}
                                  <Badge 
                                    variant={currentFilter === opt.value ? "secondary" : "outline"} 
                                    className="ml-1.5 h-5 px-1.5 text-xs"
                                  >
                                    {opt.count}
                                  </Badge>
                                </Button>
                              ))}
                              {(statusCounts["tratando"] || 0) > 0 && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs border-orange-400 text-orange-600 hover:bg-orange-50"
                                  onClick={async () => {
                                    const tratandoLeads = leadsDoEnvio.filter(l => l.status === 'tratando');
                                    if (tratandoLeads.length === 0) return;
                                    const ids = tratandoLeads.map(l => l.id);
                                    const { error } = await supabase
                                      .from('campanha_envios')
                                      .update({ status: 'reenviar' })
                                      .in('id', ids);
                                    if (error) {
                                      toast.error("Erro ao limpar status: " + error.message);
                                    } else {
                                      toast.success(`${ids.length} lead(s) alterado(s) de tratando → reenviar`);
                                      setEnvioLeads(prev => ({
                                        ...prev,
                                        [envio.id]: prev[envio.id].map(l => 
                                          l.status === 'tratando' ? { ...l, status: 'reenviar' } : l
                                        )
                                      }));
                                    }
                                  }}
                                >
                                  <RotateCcw className="h-3 w-3 mr-1" />
                                  Limpar tratando ({statusCounts["tratando"]})
                                </Button>
                              )}
                            </div>
                          </div>
                          
                          {/* Search input */}
                          <Input
                            placeholder="Buscar por nome ou telefone..."
                            value={envioLeadsSearchFilter[envio.id] || ""}
                            onChange={(e) => setEnvioLeadsSearchFilter(prev => ({ ...prev, [envio.id]: e.target.value }))}
                            className="max-w-sm h-8 text-sm"
                          />
                        </div>
                        
                        {filteredEnvioLeads.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            {leadsDoEnvio.length === 0 ? "Nenhum lead configurado" : "Nenhum lead com esse status"}
                          </p>
                        ) : (
                          <div className="border rounded-md bg-background overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  {(['nome', 'telefone', 'status', 'enviado_em'] as const).map(field => {
                                    const labels = { nome: 'Nome', telefone: 'Telefone', status: 'Status', enviado_em: 'Enviado em' };
                                    const sort = envioLeadsSort[envio.id];
                                    const isActive = sort?.field === field;
                                    return (
                                      <TableHead 
                                        key={field}
                                        className="cursor-pointer select-none hover:bg-muted/50 transition-colors"
                                        onClick={() => {
                                          setEnvioLeadsSort(prev => ({
                                            ...prev,
                                            [envio.id]: isActive && sort.dir === 'asc' 
                                              ? { field, dir: 'desc' } 
                                              : isActive && sort.dir === 'desc'
                                                ? undefined as any
                                                : { field, dir: 'asc' }
                                          }));
                                        }}
                                      >
                                        <div className="flex items-center gap-1">
                                          {labels[field]}
                                          {isActive ? (
                                            sort.dir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
                                          ) : (
                                            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/50" />
                                          )}
                                        </div>
                                      </TableHead>
                                    );
                                  })}
                                  <TableHead className="text-right">Ações</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {filteredEnvioLeads.map(lead => (
                                  <TableRow key={lead.id}>
                                    <TableCell>{lead.leads?.nome || "-"}</TableCell>
                                    <TableCell className="font-mono text-sm">{lead.telefone}</TableCell>
                                    <TableCell>{getEnvioLeadStatusBadge(lead.status)}</TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                      {lead.enviado_em 
                                        ? new Date(lead.enviado_em).toLocaleString('pt-BR', { 
                                            day: '2-digit', 
                                            month: '2-digit', 
                                            year: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit'
                                          })
                                        : "-"}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <div className="flex items-center justify-end gap-2">
                                        <Select 
                                          value={lead.status || "enviar"} 
                                          onValueChange={(val) => handleUpdateLeadStatus(lead.id, val as EnvioLeadStatus, envio.id)}
                                        >
                                          <SelectTrigger className="h-8 w-32">
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="enviar">Enviar</SelectItem>
                                            <SelectItem value="reenviar">Reenviar</SelectItem>
                                            <SelectItem value="tratando">Tratando</SelectItem>
                                            <SelectItem value="NoZap">No Zap</SelectItem>
                                            <SelectItem value="enviado">Enviado</SelectItem>
                                            <SelectItem value="contatado">Contatado</SelectItem>
                                          </SelectContent>
                                        </Select>
                                        <AlertDialog>
                                          <AlertDialogTrigger asChild>
                                            <Button 
                                              variant="ghost" 
                                              size="icon" 
                                              className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                            >
                                              <Trash2 className="h-4 w-4" />
                                            </Button>
                                          </AlertDialogTrigger>
                                          <AlertDialogContent>
                                            <AlertDialogHeader>
                                              <AlertDialogTitle>Remover lead do disparo?</AlertDialogTitle>
                                              <AlertDialogDescription>
                                                Tem certeza que deseja remover "{lead.leads?.nome || lead.telefone}" deste disparo? Esta ação não pode ser desfeita.
                                              </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                              <AlertDialogAction 
                                                onClick={() => handleRemoveLeadFromEnvio(lead.id, envio.id)}
                                                className="bg-destructive hover:bg-destructive/90"
                                              >
                                                Remover
                                              </AlertDialogAction>
                                            </AlertDialogFooter>
                                          </AlertDialogContent>
                                        </AlertDialog>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </div>
                    );
                    })()}
                  </div>
                );
              })}
              
              {enviosFiltrados.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  {mostrarInativos ? "Nenhum envio configurado ainda" : "Nenhum envio ativo"}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Novo Envio Dialog */}
      <Dialog open={novoEnvioOpen} onOpenChange={setNovoEnvioOpen}>
        <DialogContent className="w-[80vw] max-w-[80vw] h-[80vh] max-h-[80vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Criar Novo Envio</DialogTitle>
            <DialogDescription>
              Selecione a campanha, instância e os tipos de leads. Uma campanha pode ter vários envios.
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 flex flex-col min-h-0 space-y-6 overflow-hidden">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Campanha *</Label>
              <Select value={selectedCampanha} onValueChange={(val) => {
                  setSelectedCampanha(val);
                  setSelectedLeadIds([]);
                  setLeadsPage(1);
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma campanha" />
                  </SelectTrigger>
                  <SelectContent>
                    {campanhas.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {campanhas.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Crie uma campanha primeiro em "Campanhas"
                  </p>
                )}
              </div>
              <div>
                <Label>Instância de Envio *</Label>
                <Select value={selectedInstancia} onValueChange={setSelectedInstancia}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma instância" />
                  </SelectTrigger>
                  <SelectContent>
                    {instancias
                      .filter(inst => !inst.em_uso)
                      .map(inst => (
                        <SelectItem key={inst.id} value={inst.id}>
                          {inst.nome_instancia}
                          {inst.connection_status !== "connected" && " (desconectada)"}
                        </SelectItem>
                      ))}
                    {instancias.filter(inst => !inst.em_uso).length === 0 && (
                      <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                        Todas as instâncias estão em uso
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Filtros */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Buscar</Label>
                <Input
                  placeholder="Nome ou telefone..."
                  value={filterBusca}
                  onChange={(e) => setFilterBusca(e.target.value)}
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs">Tipo de Lead</Label>
                <Select value={filterTipoLead || "__all__"} onValueChange={(val) => setFilterTipoLead(val === "__all__" ? "" : val)}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos</SelectItem>
                    {tiposLeadComLeads.map(tipo => (
                      <SelectItem key={tipo.id} value={tipo.nome}>
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tipo.cor }} />
                          {tipo.nome}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Especialidade</Label>
                <Select value={normalizedFilterEspecialidade || "__all__"} onValueChange={(val) => setFilterEspecialidade(val === "__all__" ? "" : val)}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todas</SelectItem>
                    {especialidadesOptions.map(esp => (
                      <SelectItem key={esp.id} value={esp.id}>
                        {esp.nome} {typeof esp.count === "number" ? `(${esp.count.toLocaleString()})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Lista de Leads */}
            <div className="flex-1 flex flex-col min-h-0 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  Selecionar Leads
                  {loadingLeadsDialog ? (
                    <Badge variant="outline" className="font-normal animate-pulse">
                      <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                      Carregando...
                    </Badge>
                  ) : !selectedCampanha ? (
                    <Badge variant="outline" className="font-normal text-muted-foreground">
                      Selecione uma campanha para carregar
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="font-normal">
                      {availableLeadsTotal.toLocaleString()} disponíveis
                    </Badge>
                  )}
                </Label>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={handleSelectAllFiltered} disabled={loadingLeadsDialog}>
                    {filteredLeads.length > 0 && filteredLeads.slice(0, MAX_LEADS_POR_ENVIO).every(l => selectedLeadIds.includes(l.id)) 
                      ? "Desmarcar todos" 
                      : `Selecionar até ${MAX_LEADS_POR_ENVIO}`}
                  </Button>
                  <Badge variant={selectedLeadIds.length >= MAX_LEADS_POR_ENVIO ? "destructive" : "secondary"}>
                    {selectedLeadIds.length}/{MAX_LEADS_POR_ENVIO}
                  </Badge>
                </div>
              </div>
              
              <div className="border rounded-md flex-1 min-h-0 overflow-y-auto">
                {loadingLeadsDialog ? (
                  <div className="flex items-center justify-center py-12">
                    <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-muted-foreground">Carregando leads...</span>
                  </div>
                ) : !selectedCampanha ? (
                  <div className="flex items-center justify-center py-12 text-center text-sm text-muted-foreground">
                    Selecione uma campanha para visualizar os leads disponíveis.
                  </div>
                ) : filteredLeads.length === 0 ? (
                  <p className="text-center py-4 text-muted-foreground text-sm">
                    Nenhum lead encontrado
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10"></TableHead>
                        <TableHead>Nome</TableHead>
                        <TableHead>Telefone</TableHead>
                        <TableHead>Tipo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleLeads.map(lead => (
                        <TableRow 
                          key={lead.id} 
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handleToggleLead(lead.id)}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedLeadIds.includes(lead.id)}
                              onCheckedChange={() => handleToggleLead(lead.id)}
                            />
                          </TableCell>
                          <TableCell>{lead.nome || "-"}</TableCell>
                          <TableCell className="font-mono text-sm">{lead.telefone}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {lead.tipo_lead || "novo"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              {/* Paginação */}
              {totalLeadPages > 1 && (
                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="text-xs text-muted-foreground">
                    Página {leadsPage} de {totalLeadPages} ({availableLeadsTotal.toLocaleString()} leads)
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={leadsPage <= 1}
                      onClick={() => setLeadsPage(p => p - 1)}
                    >
                      Anterior
                    </Button>
                    {Array.from({ length: Math.min(totalLeadPages, 5) }, (_, i) => {
                      let page: number;
                      if (totalLeadPages <= 5) {
                        page = i + 1;
                      } else if (leadsPage <= 3) {
                        page = i + 1;
                      } else if (leadsPage >= totalLeadPages - 2) {
                        page = totalLeadPages - 4 + i;
                      } else {
                        page = leadsPage - 2 + i;
                      }
                      return (
                        <Button
                          key={page}
                          variant={page === leadsPage ? "default" : "outline"}
                          size="sm"
                          className="w-8 h-8 p-0"
                          onClick={() => setLeadsPage(page)}
                        >
                          {page}
                        </Button>
                      );
                    })}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={leadsPage >= totalLeadPages}
                      onClick={() => setLeadsPage(p => p + 1)}
                    >
                      Próximo
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setNovoEnvioOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCriarDisparo}>
              Criar Disparo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Agendar Dialog */}
      <Dialog open={agendarDialogOpen} onOpenChange={setAgendarDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Agendar Envio</DialogTitle>
            <DialogDescription>
              Defina a data e hora para iniciar os disparos
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6">
            {/* Resumo */}
            <Card className="bg-muted/50">
              <CardContent className="pt-6 space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Campanha:</span>
                  <span className="font-bold">{selectedEnvio?.campanhas_disparo?.nome}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total de Leads:</span>
                  <span className="font-bold">{selectedEnvio?.total_leads || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Dias necessários:</span>
                  <span className="font-bold">{diasNecessarios} dias úteis</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Envios por dia:</span>
                  <span className="font-bold">{ENVIOS_POR_DIA}</span>
                </div>
              </CardContent>
            </Card>

            {/* Agendamento */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Data de Início *</Label>
                <Input
                  type="date"
                  value={agendamentoData}
                  onChange={(e) => setAgendamentoData(e.target.value)}
                  min={format(new Date(), "yyyy-MM-dd")}
                />
              </div>
              <div>
                <Label>Hora de Início *</Label>
                <Input
                  type="time"
                  value={agendamentoHora}
                  onChange={(e) => setAgendamentoHora(e.target.value)}
                  min="08:00"
                  max="17:00"
                />
              </div>
            </div>

            {agendamentoData && dataFimEstimada && (
              <Card className="border-primary/50 bg-primary/5">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <Calendar className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">Previsão de Conclusão</p>
                      <p className="text-sm text-muted-foreground">
                        {format(dataFimEstimada, "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex items-start gap-2 text-sm text-muted-foreground bg-yellow-500/10 p-3 rounded-md">
              <AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" />
              <p>
                Os disparos serão realizados de segunda a sexta, das {HORARIO_INICIO}h às {HORARIO_FIM}h, 
                com intervalos aleatórios entre {INTERVALO_MIN} e {INTERVALO_MAX} minutos.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAgendarDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleAgendarEnvio} disabled={!agendamentoData}>
              <CalendarClock className="mr-2 h-4 w-4" />
              Agendar Envio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Configurar Leads Dialog */}
      <Dialog open={configurarLeadsOpen} onOpenChange={setConfigurarLeadsOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configurar Leads</DialogTitle>
            <DialogDescription>
              Selecione os leads que receberão a mensagem
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Instância de Envio */}
            <div>
              <Label>Instância de Envio *</Label>
              <Select value={selectedInstancia} onValueChange={setSelectedInstancia}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma instância" />
                </SelectTrigger>
                <SelectContent>
                  {instancias
                    .filter(inst => !inst.em_uso || inst.id === selectedInstancia)
                    .map(inst => (
                      <SelectItem key={inst.id} value={inst.id}>
                        {inst.nome_instancia}
                        {inst.connection_status !== "connected" && " (desconectada)"}
                      </SelectItem>
                    ))}
                  {instancias.filter(inst => !inst.em_uso || inst.id === selectedInstancia).length === 0 && (
                    <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                      Todas as instâncias estão em uso
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Filtros */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Buscar</Label>
                <Input
                  placeholder="Nome ou telefone..."
                  value={filterBusca}
                  onChange={(e) => setFilterBusca(e.target.value)}
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs">Tipo de Lead</Label>
                <Select value={filterTipoLead || "__all__"} onValueChange={(val) => setFilterTipoLead(val === "__all__" ? "" : val)}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos</SelectItem>
                    {tiposLeadComLeads.map(tipo => (
                      <SelectItem key={tipo.id} value={tipo.nome}>
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tipo.cor }} />
                          {tipo.nome}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Especialidade</Label>
                <Select value={normalizedFilterEspecialidade || "__all__"} onValueChange={(val) => setFilterEspecialidade(val === "__all__" ? "" : val)}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todas</SelectItem>
                    {especialidadesOptions.map(esp => (
                      <SelectItem key={esp.id} value={esp.id}>
                        {esp.nome} {typeof esp.count === "number" ? `(${esp.count.toLocaleString()})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Lista de Leads */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  Selecionar Leads
                  <Badge variant="outline" className="font-normal">
                    {availableLeadsTotal.toLocaleString()} disponíveis
                  </Badge>
                </Label>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={handleSelectAllFiltered}>
                    {filteredLeads.every(l => selectedLeadIds.includes(l.id)) 
                      ? "Desmarcar todos" 
                      : "Selecionar todos"}
                  </Button>
                  <Badge variant="secondary">
                    {selectedLeadIds.length} selecionados
                  </Badge>
                </div>
              </div>
              
              <div className="border rounded-md max-h-60 overflow-y-auto">
                {filteredLeads.length === 0 ? (
                  <p className="text-center py-4 text-muted-foreground text-sm">
                    Nenhum lead encontrado
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10"></TableHead>
                        <TableHead>Nome</TableHead>
                        <TableHead>Telefone</TableHead>
                        <TableHead>Tipo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleLeads.map(lead => (
                        <TableRow 
                          key={lead.id} 
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handleToggleLead(lead.id)}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedLeadIds.includes(lead.id)}
                              onCheckedChange={() => handleToggleLead(lead.id)}
                            />
                          </TableCell>
                          <TableCell>{lead.nome || "-"}</TableCell>
                          <TableCell className="font-mono text-sm">{lead.telefone}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {lead.tipo_lead || "novo"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              {/* Paginação */}
              {totalLeadPages > 1 && (
                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="text-xs text-muted-foreground">
                    Página {leadsPage} de {totalLeadPages} ({availableLeadsTotal.toLocaleString()} leads)
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={leadsPage <= 1}
                      onClick={() => setLeadsPage(p => p - 1)}
                    >
                      Anterior
                    </Button>
                    {Array.from({ length: Math.min(totalLeadPages, 5) }, (_, i) => {
                      let page: number;
                      if (totalLeadPages <= 5) {
                        page = i + 1;
                      } else if (leadsPage <= 3) {
                        page = i + 1;
                      } else if (leadsPage >= totalLeadPages - 2) {
                        page = totalLeadPages - 4 + i;
                      } else {
                        page = leadsPage - 2 + i;
                      }
                      return (
                        <Button
                          key={page}
                          variant={page === leadsPage ? "default" : "outline"}
                          size="sm"
                          className="w-8 h-8 p-0"
                          onClick={() => setLeadsPage(page)}
                        >
                          {page}
                        </Button>
                      );
                    })}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={leadsPage >= totalLeadPages}
                      onClick={() => setLeadsPage(p => p + 1)}
                    >
                      Próximo
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigurarLeadsOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleAtualizarLeads}>
              Salvar Configuração
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detalhes Dialog */}
      <Dialog open={detalhesOpen} onOpenChange={setDetalhesOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Detalhes do Envio</DialogTitle>
          </DialogHeader>
          
          {selectedEnvio && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground text-xs">Campanha</Label>
                  <p className="font-medium">{selectedEnvio.campanhas_disparo?.nome}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Instância</Label>
                  <p className="font-medium">{selectedEnvio.instancias_whatsapp?.nome_instancia}</p>
                </div>
              </div>
              
              <div>
                <Label className="text-muted-foreground text-xs">Status</Label>
                <div className="mt-1">{getStatusBadge(selectedEnvio.status)}</div>
              </div>

              {selectedEnvio.filtro_tipo_lead && selectedEnvio.filtro_tipo_lead.length > 0 && (
                <div>
                  <Label className="text-muted-foreground text-xs">Filtros de Lead</Label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selectedEnvio.filtro_tipo_lead.map(tipo => (
                      <Badge key={tipo} variant="secondary">{tipo}</Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground text-xs">Total de Leads</Label>
                  <p className="font-medium">{selectedEnvio.total_leads}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Enviados</Label>
                  <p className="font-medium">{selectedEnvio.enviados}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Sucesso</Label>
                  <p className="font-medium text-green-600">{selectedEnvio.sucesso}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Falhas</Label>
                  <p className="font-medium text-red-600">{selectedEnvio.falhas}</p>
                </div>
              </div>

              {selectedEnvio.agendado_para && (
                <div>
                  <Label className="text-muted-foreground text-xs">Agendado para</Label>
                  <p className="font-medium">
                    {format(new Date(selectedEnvio.agendado_para), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </p>
                </div>
              )}

              {selectedEnvio.iniciado_em && (
                <div>
                  <Label className="text-muted-foreground text-xs">Iniciado em</Label>
                  <p className="font-medium">
                    {format(new Date(selectedEnvio.iniciado_em), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </p>
                </div>
              )}

              {selectedEnvio.concluido_em && (
                <div>
                  <Label className="text-muted-foreground text-xs">Concluído em</Label>
                  <p className="font-medium">
                    {format(new Date(selectedEnvio.concluido_em), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </p>
                </div>
              )}

              {selectedEnvio.campanhas_disparo?.mensagem && (
                <div>
                  <Label className="text-muted-foreground text-xs">Mensagem</Label>
                  <div className="mt-1 p-3 bg-muted rounded-md text-sm whitespace-pre-wrap">
                    {selectedEnvio.campanhas_disparo.mensagem}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetalhesOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de Teste de Payload */}
      <Dialog open={testeDialogOpen} onOpenChange={setTesteDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bug className="h-5 w-5 text-amber-500" />
              Teste de Payload do Webhook
            </DialogTitle>
            <DialogDescription>
              Visualize o que será enviado para o webhook configurado. Nenhum envio real foi feito.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[60vh]">
            {testePayload ? (
              <div className="space-y-4">
                <div className="flex items-center gap-4 text-sm">
                  <Badge variant={testePayload.success ? "default" : "destructive"}>
                    {testePayload.success ? "Sucesso" : "Erro"}
                  </Badge>
                  <span className="text-muted-foreground">{testePayload.message}</span>
                </div>

                {testePayload.webhook_url && (
                  <div>
                    <Label className="text-muted-foreground text-xs">Webhook URL</Label>
                    <p className="font-mono text-sm bg-muted p-2 rounded mt-1 break-all">
                      {testePayload.webhook_url}
                    </p>
                  </div>
                )}

                {testePayload.results && testePayload.results.length > 0 && (
                  <div>
                    <Label className="text-muted-foreground text-xs mb-2 block">
                      Payloads gerados ({testePayload.results.length} lead(s))
                    </Label>
                    
                    {testePayload.results.map((result: any, idx: number) => (
                      <div key={idx} className="mb-4 border rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant={result.success ? "outline" : "destructive"} className="text-xs">
                            {result.success ? "Válido" : "Inválido"}
                          </Badge>
                          <span className="font-mono text-sm">
                            {result.telefone_formatado || result.telefone}
                          </span>
                          {result.telefone_original && result.telefone_formatado !== result.telefone_original && (
                            <span className="text-xs text-muted-foreground">
                              (original: {result.telefone_original})
                            </span>
                          )}
                        </div>

                        {result.error && (
                          <p className="text-sm text-destructive mb-2">{result.error}</p>
                        )}

                        {result.payload && (
                          <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap">
                            {JSON.stringify(result.payload, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {testePayload.error && (
                  <div className="p-3 bg-destructive/10 text-destructive rounded-lg">
                    <p className="font-medium">Erro:</p>
                    <p className="text-sm">{testePayload.error}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTesteDialogOpen(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </div>
  );
}
