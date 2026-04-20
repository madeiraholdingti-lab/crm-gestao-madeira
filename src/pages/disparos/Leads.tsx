import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "sonner";
import { 
  Plus, 
  Upload, 
  Users, 
  Trash2,
  Edit,
  Search,
  Filter,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Eye,
  AlertCircle,
  CheckCircle2,
  X,
  Download,
  ChevronsUpDown,
  Check,
  User,
  ArrowUpDown,
  SlidersHorizontal,
  Loader2
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import LeadDetailDialog from "@/components/LeadDetailDialog";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import DisparoBreadcrumb from "@/components/DisparoBreadcrumb";
import DisparosTopNav from "@/components/DisparosTopNav";
import { parseCSVContent, ParsedLead, parseLeadName, parseXLSXContent } from "@/utils/parseLeadImport";
import { Progress } from "@/components/ui/progress";
import { formatBrazilianPhone } from "@/utils/brazilianPhoneUtils";


interface Lead {
  id: string;
  nome: string | null;
  telefone: string;
  email: string | null;
  tipo_lead: string | null;
  especialidade: string | null;
  especialidade_id: string | null;
  origem: string | null;
  tags: string[];
  ativo: boolean;
  anotacoes: string | null;
  created_at: string;
  especialidades?: { nome: string } | null;
  especialidades_secundarias?: { especialidade_id: string; especialidades: { nome: string } }[];
}

const tiposLeadBase = [
  "medico",
  "estudante_medicina",
  "empresario",
  "negocios",
  "hospital",
  "paciente",
  "secretaria",
  "fornecedor",
  "parceiro",
  "novo",
  "qualificado",
  "interessado",
  "convertido",
  "perdido"
];

const ITEMS_PER_PAGE = 50;

export default function LeadsPage() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalLeads, setTotalLeads] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [especialidadesFromDB, setEspecialidadesFromDB] = useState<{id: string; nome: string; count: number}[]>([]);
  const [tiposLeadFromDB, setTiposLeadFromDB] = useState<{nome: string; cor: string}[]>([]);
  
  // Dialog states
  const [leadDialogOpen, setLeadDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  
  // Form states
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  
  // Filters
  const [searchLeads, setSearchLeads] = useState("");
  const [filterTipoLead, setFilterTipoLead] = useState<string>("todos");
  const [filterEspecialidades, setFilterEspecialidades] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState<string>("recentes");

  // Fetch especialidades com contagem de leads (paginado para superar limite de 1000)
  const fetchEspecialidades = useCallback(async () => {
    const { data: esps } = await supabase
      .from("especialidades")
      .select("id, nome")
      .order("nome");
    
    if (!esps) { setEspecialidadesFromDB([]); return; }

    // Contar leads por especialidade usando count agrupado via múltiplas queries
    const countMap = new Map<string, number>();
    
    // Buscar contagens em lotes paginados para superar limite de 1000 rows
    let offset = 0;
    const batchSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
      const { data: batch } = await supabase
        .from("leads")
        .select("especialidade_id")
        .eq("ativo", true)
        .not("especialidade_id", "is", null)
        .range(offset, offset + batchSize - 1);
      
      if (!batch || batch.length === 0) {
        hasMore = false;
        break;
      }
      
      for (const row of batch) {
        if (row.especialidade_id) {
          countMap.set(row.especialidade_id, (countMap.get(row.especialidade_id) || 0) + 1);
        }
      }
      
      if (batch.length < batchSize) {
        hasMore = false;
      } else {
        offset += batchSize;
      }
    }

    const espsComLeads = esps
      .map(e => ({ ...e, count: countMap.get(e.id) || 0 }))
      .filter(e => e.count > 0)
      .sort((a, b) => a.nome.localeCompare(b.nome));

    setEspecialidadesFromDB(espsComLeads);
  }, []);

  // Fetch tipos de lead do banco
  const fetchTiposLead = useCallback(async () => {
    const { data } = await supabase
      .from("tipos_lead")
      .select("nome, cor")
      .order("nome");
    if (data) {
      setTiposLeadFromDB(data);
    }
  }, []);
  
  // Form fields
  const [formLead, setFormLead] = useState({
    nome: "",
    telefone: "",
    email: "",
    tipo_lead: "novo",
    especialidade_id: "" as string,
    especialidades_secundarias_ids: [] as string[],
    origem: "",
    anotacoes: ""
  });

  // Import states
  const [parsedLeads, setParsedLeads] = useState<ParsedLead[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importDuplicates, setImportDuplicates] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importFileName, setImportFileName] = useState("");
  const [importTipoLead, setImportTipoLead] = useState("novo");
  const [importEspecialidadeId, setImportEspecialidadeId] = useState("");
  const [parsingImport, setParsingImport] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [parseCounts, setParseCounts] = useState({ processed: 0, total: 0 });
  
  // Import result dialog
  const [importResultDialogOpen, setImportResultDialogOpen] = useState(false);
  const [importResultData, setImportResultData] = useState({ imported: 0, duplicadosBanco: 0, duplicadosArquivo: 0, invalidos: 0, erros: 0, total: 0 });
  
  // Import history
  const [importHistory, setImportHistory] = useState<any[]>([]);
  const [showImportHistory, setShowImportHistory] = useState(false);
  
  // Reprocess states
  const [reprocessDialogOpen, setReprocessDialogOpen] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessProgress, setReprocessProgress] = useState(0);
  const [reprocessStats, setReprocessStats] = useState({ total: 0, updated: 0, skipped: 0 });
  
  // Delete all states
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [deleteAllProgress, setDeleteAllProgress] = useState(0);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    
    // Build count query with same filters
    let countQuery = supabase
      .from("leads")
      .select("*", { count: "exact", head: true });
    
    if (filterTipoLead !== "todos") {
      countQuery = countQuery.eq("tipo_lead", filterTipoLead);
    }
    if (filterEspecialidades.length > 0) {
      countQuery = countQuery.in("especialidade_id", filterEspecialidades);
    }
    if (searchLeads) {
      countQuery = countQuery.or(`nome.ilike.%${searchLeads}%,telefone.ilike.%${searchLeads}%,email.ilike.%${searchLeads}%`);
    }
    
    const { count } = await countQuery;
    setTotalLeads(count || 0);
    
    // Fetch current page with filters
    let query = supabase
      .from("leads")
      .select("*, especialidades(nome), lead_especialidades_secundarias(especialidade_id, especialidades(nome))");
    
    if (filterTipoLead !== "todos") {
      query = query.eq("tipo_lead", filterTipoLead);
    }
    if (filterEspecialidades.length > 0) {
      query = query.in("especialidade_id", filterEspecialidades);
    }
    if (searchLeads) {
      query = query.or(`nome.ilike.%${searchLeads}%,telefone.ilike.%${searchLeads}%,email.ilike.%${searchLeads}%`);
    }
    
    // Apply sort
    if (sortOrder === "az") {
      query = query.order("nome", { ascending: true, nullsFirst: false });
    } else if (sortOrder === "za") {
      query = query.order("nome", { ascending: false, nullsFirst: false });
    } else {
      query = query.order("created_at", { ascending: false });
    }
    
    query = query.range((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE - 1);
    
    const { data, error } = await query;
    
    if (error) {
      toast.error("Erro ao carregar leads");
      setLoading(false);
      return;
    }
    setLeads(data || []);
    setLoading(false);
  }, [currentPage, filterTipoLead, filterEspecialidades, searchLeads, sortOrder]);

  const fetchImportHistory = useCallback(async () => {
    const { data } = await supabase
      .from("lead_importacoes" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setImportHistory(data as any[]);
  }, []);

  useEffect(() => {
    fetchLeads();
    fetchEspecialidades();
    fetchTiposLead();
    fetchImportHistory();
  }, [fetchLeads, fetchEspecialidades, fetchTiposLead, fetchImportHistory]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setCurrentPage(1);
      fetchLeads();
    }, 500);
    return () => clearTimeout(timer);
  }, [searchLeads]);

  const totalPages = Math.ceil(totalLeads / ITEMS_PER_PAGE);

  // Download CSV template
  const handleDownloadTemplate = () => {
    const headers = ["nome", "telefone", "email", "anotacoes"];
    const exampleRows = [
      ["João da Silva", "5511999887766", "joao@email.com", "Lead interessado"],
      ["Maria Santos", "5521988776655", "maria@email.com", ""],
      ["Dr. Carlos Oliveira", "5531977665544", "", "Especialista em cirurgia cardiovascular"]
    ];
    
    const csvContent = [
      headers.join(";"),
      ...exampleRows.map(row => row.join(";"))
    ].join("\n");
    
    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "modelo_leads.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("Modelo baixado com sucesso!");
  };

  const handleSaveLead = async () => {
    if (!formLead.telefone) {
      toast.error("Telefone é obrigatório");
      return;
    }

    // Validar e formatar número brasileiro
    const phoneResult = formatBrazilianPhone(formLead.telefone);
    if (!phoneResult.isValid) {
      toast.error(`Número inválido: ${phoneResult.error}`);
      return;
    }

    const telefoneFormatado = phoneResult.formatted;
    let leadId = editingLead?.id;

    if (editingLead) {
      const { error } = await supabase
        .from("leads")
        .update({
          nome: formLead.nome || null,
          telefone: telefoneFormatado,
          email: formLead.email || null,
          tipo_lead: formLead.tipo_lead,
          especialidade_id: formLead.especialidade_id || null,
          origem: formLead.origem || null,
          anotacoes: formLead.anotacoes || null
        })
        .eq("id", editingLead.id);

      if (error) {
        toast.error("Erro ao atualizar lead");
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("leads")
        .insert({
          nome: formLead.nome || null,
          telefone: telefoneFormatado,
          email: formLead.email || null,
          tipo_lead: formLead.tipo_lead,
          especialidade_id: formLead.especialidade_id || null,
          origem: formLead.origem || null,
          anotacoes: formLead.anotacoes || null
        })
        .select("id")
        .single();

      if (error) {
        toast.error("Erro ao criar lead");
        return;
      }
      leadId = data?.id;
    }

    // Save secondary specialties
    if (leadId) {
      // Delete existing
      await supabase.from("lead_especialidades_secundarias" as any).delete().eq("lead_id", leadId);
      // Insert new
      if (formLead.especialidades_secundarias_ids.length > 0) {
        await supabase.from("lead_especialidades_secundarias" as any).insert(
          formLead.especialidades_secundarias_ids.map(espId => ({
            lead_id: leadId,
            especialidade_id: espId
          }))
        );
      }
    }

    toast.success(editingLead ? "Lead atualizado" : "Lead criado");
    setLeadDialogOpen(false);
    setEditingLead(null);
    setFormLead({ nome: "", telefone: "", email: "", tipo_lead: "novo", especialidade_id: "", especialidades_secundarias_ids: [], origem: "", anotacoes: "" });
    fetchLeads();
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    setImportFileName(file.name);
    const isXLSX = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        let result: { leads: ParsedLead[]; errors: string[]; duplicates: string[] };
        
        setParsingImport(true);
        setParseProgress(0);
        setParseCounts({ processed: 0, total: 0 });

        if (isXLSX) {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          if (!arrayBuffer || arrayBuffer.byteLength === 0) {
            toast.error("Arquivo vazio ou corrompido");
            return;
          }

          result = await parseXLSXContent(arrayBuffer, (processed, total) => {
            setParseCounts({ processed, total });
            setParseProgress(total > 0 ? Math.round((processed / total) * 100) : 0);
          });
        } else {
          const text = e.target?.result as string;
          result = parseCSVContent(text);
          setParseCounts({ processed: result.leads.length, total: result.leads.length });
          setParseProgress(100);
        }
        
        if (result.leads.length === 0 && result.errors.length === 0) {
          toast.error("Nenhum lead encontrado no arquivo. Verifique se as colunas 'nome' e 'telefone' existem.");
          return;
        }
        
        setParsedLeads(result.leads);
        setImportErrors(result.errors);
        setImportDuplicates(result.duplicates);
        setImportDialogOpen(false);
        setPreviewDialogOpen(true);
      } catch (err) {
        console.error("Erro ao processar arquivo de importação:", err);
        toast.error("Erro ao processar o arquivo. Verifique o formato e tente novamente.");
      } finally {
        setParsingImport(false);
      }
    };
    
    if (isXLSX) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  };

  // Filtrar leads válidos para importação
  const validLeadsForImport = useMemo(() => {
    return parsedLeads.filter(lead => lead.telefone_valido);
  }, [parsedLeads]);

  const invalidLeadsForImport = useMemo(() => {
    return parsedLeads.filter(lead => !lead.telefone_valido);
  }, [parsedLeads]);

  const handleConfirmImport = async (fileName: string = "arquivo.csv") => {
    if (validLeadsForImport.length === 0) {
      toast.error("Nenhum lead válido para importar");
      return;
    }

    setImporting(true);
    setImportProgress(0);

    // 1. Buscar telefones existentes no banco para evitar duplicatas
    const phonesToCheck = validLeadsForImport.map(l => l.telefone_formatado);
    const existingPhones = new Set<string>();
    
    // Buscar em lotes de 500
    for (let i = 0; i < phonesToCheck.length; i += 500) {
      const batch = phonesToCheck.slice(i, i + 500);
      const { data: existing } = await supabase
        .from("leads")
        .select("telefone")
        .in("telefone", batch);
      if (existing) {
        existing.forEach(e => existingPhones.add(e.telefone));
      }
    }

    // 2. Separar leads novos dos já existentes
    const leadsNovos = validLeadsForImport.filter(l => !existingPhones.has(l.telefone_formatado));
    const leadsDuplicadosDB = validLeadsForImport.filter(l => existingPhones.has(l.telefone_formatado));

    // 3. Importar apenas leads novos
    const BATCH_SIZE = 100;
    let imported = 0;
    let failed = 0;

    if (leadsNovos.length > 0) {
      const batches = Math.ceil(leadsNovos.length / BATCH_SIZE);
      for (let i = 0; i < batches; i++) {
        const batch = leadsNovos.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
        
        const leadsToInsert = batch.map(lead => ({
          nome: lead.nome || null,
          telefone: lead.telefone_formatado,
          tipo_lead: importTipoLead || "novo",
          especialidade_id: importEspecialidadeId || null,
          origem: "importacao",
          anotacoes: lead.observacoes || null
        }));

        const { error } = await supabase.from("leads").insert(leadsToInsert);
        
        if (error) {
          failed += batch.length;
        } else {
          imported += batch.length;
        }

        setImportProgress(Math.round(((i + 1) / batches) * 100));
      }
    } else {
      setImportProgress(100);
    }

    // 5. Registrar histórico da importação
    const { data: userData } = await supabase.auth.getUser();
    await (supabase as any).from("lead_importacoes").insert({
      created_by: userData?.user?.id || null,
      nome_arquivo: fileName,
      total_linhas: parsedLeads.length,
      leads_adicionados: imported,
      leads_duplicados: leadsDuplicadosDB.length + importDuplicates.length,
      leads_invalidos: invalidLeadsForImport.length,
      leads_erro: failed,
      detalhes: {
        duplicados_arquivo: importDuplicates.length,
        duplicados_banco: leadsDuplicadosDB.length,
        invalidos: invalidLeadsForImport.length,
        erros_insercao: failed
      }
    });

    setImporting(false);
    setPreviewDialogOpen(false);
    
    // Show import result dialog
    setImportResultData({
      imported,
      duplicadosBanco: leadsDuplicadosDB.length,
      duplicadosArquivo: importDuplicates.length,
      invalidos: invalidLeadsForImport.length,
      erros: failed,
      total: parsedLeads.length
    });
    setImportResultDialogOpen(true);

    setParsedLeads([]);
    setImportErrors([]);
    setImportDuplicates([]);

    fetchLeads();
    fetchEspecialidades();
    fetchImportHistory();
  };

  const handleReprocessLeads = async () => {
    setReprocessing(true);
    setReprocessProgress(0);
    setReprocessStats({ total: 0, updated: 0, skipped: 0 });

    // Fetch all leads that need reprocessing (those with origem = 'importacao' or tipo_lead = 'novo')
    const { data: allLeads, error: fetchError } = await supabase
      .from("leads")
      .select("id, nome, tipo_lead, anotacoes")
      .or("origem.eq.importacao,tipo_lead.eq.novo");

    if (fetchError || !allLeads) {
      toast.error("Erro ao buscar leads para reprocessar");
      setReprocessing(false);
      return;
    }

    const total = allLeads.length;
    let updated = 0;
    let skipped = 0;

    const BATCH_SIZE = 50;
    const batches = Math.ceil(allLeads.length / BATCH_SIZE);

    for (let i = 0; i < batches; i++) {
      const batch = allLeads.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
      
      for (const lead of batch) {
        if (!lead.nome) {
          skipped++;
          continue;
        }

        const parsed = parseLeadName(lead.nome);
        
        // Only update if something changed
        const hasChanges = 
          parsed.nome !== lead.nome ||
          parsed.tipo_lead !== lead.tipo_lead ||
          (parsed.observacoes && parsed.observacoes !== lead.anotacoes);

        if (hasChanges) {
          const { error: updateError } = await supabase
            .from("leads")
            .update({
              nome: parsed.nome,
              tipo_lead: parsed.tipo_lead,
              anotacoes: parsed.observacoes || lead.anotacoes
            })
            .eq("id", lead.id);

          if (!updateError) {
            updated++;
          }
        } else {
          skipped++;
        }
      }

      setReprocessProgress(Math.round(((i + 1) / batches) * 100));
      setReprocessStats({ total, updated, skipped: skipped });
    }

    setReprocessing(false);
    toast.success(`Reprocessamento concluído: ${updated} leads atualizados`);
    fetchLeads();
  };

  const handleDeleteAllLeads = async () => {
    setDeletingAll(true);
    setDeleteAllProgress(0);
    
    try {
      // Delete in batches to avoid timeout
      const batchSize = 500;
      let deleted = 0;
      
      while (true) {
        // Get a batch of lead IDs
        const { data: batch, error: fetchError } = await supabase
          .from("leads")
          .select("id")
          .limit(batchSize);
        
        if (fetchError) throw fetchError;
        if (!batch || batch.length === 0) break;
        
        const ids = batch.map(l => l.id);
        
        const { error: deleteError } = await supabase
          .from("leads")
          .delete()
          .in("id", ids);
        
        if (deleteError) throw deleteError;
        
        deleted += batch.length;
        setDeleteAllProgress(Math.min(95, (deleted / totalLeads) * 100));
      }
      
      setDeleteAllProgress(100);
      toast.success(`${deleted} leads removidos com sucesso`);
      setDeleteAllDialogOpen(false);
      setCurrentPage(1);
      fetchLeads();
    } catch (error) {
      console.error(error);
      toast.error("Erro ao deletar leads");
    } finally {
      setDeletingAll(false);
      setDeleteAllProgress(0);
    }
  };

  const handleDeleteLead = async (id: string) => {
    const { error } = await supabase.from("leads").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao deletar lead");
      return;
    }
    toast.success("Lead removido");
    fetchLeads();
  };

  const handleViewLead = (lead: Lead) => {
    setSelectedLead(lead);
    setDetailDialogOpen(true);
  };

  const openEditDialog = (lead: Lead) => {
    setEditingLead(lead);
    setFormLead({
      nome: lead.nome || "",
      telefone: lead.telefone,
      email: lead.email || "",
      tipo_lead: lead.tipo_lead || "novo",
      especialidade_id: lead.especialidade_id || "",
      especialidades_secundarias_ids: (lead as any).lead_especialidades_secundarias?.map((s: any) => s.especialidade_id) || [],
      origem: lead.origem || "",
      anotacoes: lead.anotacoes || ""
    });
    setLeadDialogOpen(true);
  };

  const getTipoLeadBadge = (tipo: string | null) => {
    // First try to find color from database
    const tipoFromDB = tiposLeadFromDB.find(t => t.nome === tipo);
    if (tipoFromDB) {
      return (
        <Badge style={{ backgroundColor: tipoFromDB.cor }} className="text-white">
          {tipo}
        </Badge>
      );
    }
    
    // Fallback to default colors
    const tipoConfig: Record<string, { color: string }> = {
      medico: { color: "bg-teal-500" },
      estudante_medicina: { color: "bg-violet-500" },
      empresario: { color: "bg-amber-500" },
      negocios: { color: "bg-blue-500" },
      hospital: { color: "bg-pink-500" },
      paciente: { color: "bg-cyan-500" },
      secretaria: { color: "bg-purple-500" },
      fornecedor: { color: "bg-indigo-500" },
      parceiro: { color: "bg-pink-400" },
      novo: { color: "bg-blue-500" },
      qualificado: { color: "bg-green-500" },
      interessado: { color: "bg-yellow-500" },
      convertido: { color: "bg-emerald-500" },
      perdido: { color: "bg-red-500" }
    };
    const config = tipoConfig[tipo || "novo"] || { color: "bg-gray-500" };
    return (
      <Badge className={`${config.color} text-white`}>
        {tipo || "novo"}
      </Badge>
    );
  };

  return (
    <div className="p-4 md:p-6">
      <DisparosTopNav />
      <div className="space-y-6">
          <DisparoBreadcrumb 
            items={[
              { label: "Disparos em Massa", href: "/disparos-em-massa" },
              { label: "Leads" }
            ]} 
          />
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mh-gold-600">
                Disparos · Base
              </div>
              <h1 className="font-serif-display text-2xl md:text-3xl font-medium text-mh-ink leading-tight mt-1">
                Leads
              </h1>
              <p className="text-sm text-mh-ink-3 mt-1">
                Base de contatos, importação CSV e histórico por campanha.
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => setShowImportHistory(true)}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Histórico
              </Button>
              <Button variant="outline" onClick={handleDownloadTemplate}>
                <Download className="mr-2 h-4 w-4" />
                Modelo CSV
              </Button>
              <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                Importar CSV
              </Button>
              <Button onClick={() => {
                setEditingLead(null);
                setFormLead({ nome: "", telefone: "", email: "", tipo_lead: "novo", especialidade_id: "", especialidades_secundarias_ids: [], origem: "", anotacoes: "" });
                setLeadDialogOpen(true);
              }}>
                <Plus className="mr-2 h-4 w-4" />
                Novo Lead
              </Button>
            </div>
          </div>

          {/* Stats — tokens Madeira Holding */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="border-mh-navy-700/20">
              <CardContent className="pt-4 pb-4 flex items-start gap-3">
                <div className="bg-mh-navy-100 rounded-lg p-2 flex-shrink-0">
                  <Users className="h-4 w-4 text-mh-navy-700" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mh-ink-3">Total de Leads</div>
                  <div className="font-serif-display text-2xl font-medium text-mh-navy-700 tabular-nums mt-0.5">
                    {totalLeads.toLocaleString("pt-BR")}
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-mh-teal-500/20">
              <CardContent className="pt-4 pb-4 flex items-start gap-3">
                <div className="bg-mh-teal-500/10 rounded-lg p-2 flex-shrink-0">
                  <Users className="h-4 w-4 text-mh-teal-700" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mh-ink-3">Médicos (página)</div>
                  <div className="font-serif-display text-2xl font-medium text-mh-teal-700 tabular-nums mt-0.5">
                    {leads.filter(l => l.tipo_lead === "medico").length}
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-mh-gold-500/30">
              <CardContent className="pt-4 pb-4 flex items-start gap-3">
                <div className="bg-mh-gold-100 rounded-lg p-2 flex-shrink-0">
                  <Users className="h-4 w-4 text-mh-gold-700" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mh-ink-3">Pacientes (página)</div>
                  <div className="font-serif-display text-2xl font-medium text-mh-gold-700 tabular-nums mt-0.5">
                    {leads.filter(l => l.tipo_lead === "paciente").length}
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/60">
              <CardContent className="pt-4 pb-4 flex items-start gap-3">
                <div className="bg-muted rounded-lg p-2 flex-shrink-0">
                  <Users className="h-4 w-4 text-mh-ink-3" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mh-ink-3">Novos (página)</div>
                  <div className="font-serif-display text-2xl font-medium text-mh-ink-2 tabular-nums mt-0.5">
                    {leads.filter(l => l.tipo_lead === "novo").length}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-3 items-stretch">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, telefone ou email..."
              value={searchLeads}
              onChange={(e) => setSearchLeads(e.target.value)}
              className="pl-10 h-10 rounded-xl border-border/60 bg-background shadow-sm"
            />
          </div>

          {/* Filter chips row */}
          <div className="flex gap-2 flex-wrap">
            {/* Tipo */}
            <Select value={filterTipoLead} onValueChange={(value) => { setFilterTipoLead(value); setCurrentPage(1); }}>
              <SelectTrigger className={`h-10 w-auto min-w-[130px] rounded-xl shadow-sm ${filterTipoLead !== "todos" ? "border-primary bg-primary/5 text-primary" : "border-border/60"}`}>
                <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="todos">Todos os tipos</SelectItem>
                {tiposLeadBase.map(tipo => (
                  <SelectItem key={tipo} value={tipo}>{tipo}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Especialidade */}
            <Popover>
              <PopoverTrigger asChild>
                <Button 
                  variant="outline" 
                  className={`h-10 rounded-xl shadow-sm justify-between gap-2 min-w-[160px] ${filterEspecialidades.length > 0 ? "border-primary bg-primary/5 text-primary hover:bg-primary/10" : "border-border/60"}`}
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <Filter className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate text-sm">
                      {filterEspecialidades.length === 0 
                        ? "Especialidade" 
                        : filterEspecialidades.length === 1 
                          ? especialidadesFromDB.find(e => e.id === filterEspecialidades[0])?.nome || "1 esp."
                          : `${filterEspecialidades.length} esp.`}
                    </span>
                  </div>
                  {filterEspecialidades.length > 0 ? (
                    <X className="h-3.5 w-3.5 shrink-0 hover:text-destructive" onClick={(e) => { e.stopPropagation(); setFilterEspecialidades([]); setCurrentPage(1); }} />
                  ) : (
                    <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-40" />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[300px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Buscar especialidade..." />
                  <CommandList>
                    <CommandEmpty>Nenhuma encontrada.</CommandEmpty>
                    <CommandGroup>
                      {especialidadesFromDB.map(esp => (
                        <CommandItem
                          key={esp.id}
                          value={esp.nome}
                          onSelect={() => {
                            setFilterEspecialidades(prev => 
                              prev.includes(esp.id) 
                                ? prev.filter(e => e !== esp.id)
                                : [...prev, esp.id]
                            );
                            setCurrentPage(1);
                          }}
                        >
                          <Checkbox checked={filterEspecialidades.includes(esp.id)} className="mr-2" />
                          <span className="flex-1 truncate">{esp.nome}</span>
                          <Badge variant="secondary" className="ml-auto text-xs font-mono">
                            {esp.count.toLocaleString()}
                          </Badge>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {/* Ordenação */}
            <Select value={sortOrder} onValueChange={(value) => { setSortOrder(value); setCurrentPage(1); }}>
              <SelectTrigger className={`h-10 w-auto min-w-[140px] rounded-xl shadow-sm ${sortOrder !== "recentes" ? "border-primary bg-primary/5 text-primary" : "border-border/60"}`}>
                <ArrowUpDown className="h-3.5 w-3.5 mr-1.5" />
                <SelectValue placeholder="Ordenar" />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="recentes">Mais recentes</SelectItem>
                <SelectItem value="az">Nome A → Z</SelectItem>
                <SelectItem value="za">Nome Z → A</SelectItem>
              </SelectContent>
            </Select>

            {/* Clear filters */}
            {(filterTipoLead !== "todos" || filterEspecialidades.length > 0 || sortOrder !== "recentes" || searchLeads) && (
              <Button 
                variant="ghost" 
                size="sm"
                className="h-10 rounded-xl text-xs text-muted-foreground hover:text-destructive"
                onClick={() => {
                  setFilterTipoLead("todos");
                  setFilterEspecialidades([]);
                  setSortOrder("recentes");
                  setSearchLeads("");
                  setCurrentPage(1);
                }}
              >
                <X className="h-3.5 w-3.5 mr-1" />
                Limpar
              </Button>
            )}
          </div>
        </div>

        {/* Active filter badges */}
        {(filterEspecialidades.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {filterEspecialidades.map(id => {
              const esp = especialidadesFromDB.find(e => e.id === id);
              return esp ? (
                <Badge key={id} variant="secondary" className="text-xs gap-1 px-2.5 py-1 rounded-lg">
                  {esp.nome}
                  <X className="h-3 w-3 cursor-pointer hover:text-destructive" onClick={() => {
                    setFilterEspecialidades(prev => prev.filter(e => e !== id));
                    setCurrentPage(1);
                  }} />
                </Badge>
              ) : null;
            })}
          </div>
        )}

        {/* Leads Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Leads ({leads.length} de {totalLeads.toLocaleString()})
              </CardTitle>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                Página {currentPage} de {totalPages || 1}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0 md:p-6">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Especialidade</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Criado em</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">
                        Carregando...
                      </TableCell>
                    </TableRow>
                  ) : leads.map(lead => (
                    <TableRow 
                      key={lead.id} 
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleViewLead(lead)}
                    >
                      <TableCell className="font-medium">{lead.nome || "-"}</TableCell>
                      <TableCell>{lead.telefone}</TableCell>
                      <TableCell>{getTipoLeadBadge(lead.tipo_lead)}</TableCell>
                      <TableCell>
                        <div>
                          <span>{(lead as any).especialidades?.nome || lead.especialidade || "-"}</span>
                          {(lead as any).lead_especialidades_secundarias?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {(lead as any).lead_especialidades_secundarias.map((s: any) => (
                                <Badge key={s.especialidade_id} variant="secondary" className="text-[10px] px-1.5 py-0">
                                  {s.especialidades?.nome}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{lead.origem || "-"}</TableCell>
                      <TableCell>
                        {format(new Date(lead.created_at), "dd/MM/yyyy", { locale: ptBR })}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditDialog(lead);
                            }}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteLead(lead.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && leads.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        Nenhum lead encontrado
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-4 py-4 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </Button>
                <div className="flex items-center gap-1">
                  {[...Array(Math.min(5, totalPages))].map((_, i) => {
                    let pageNum: number;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                    
                    return (
                      <Button
                        key={pageNum}
                        variant={currentPage === pageNum ? "default" : "outline"}
                        size="sm"
                        onClick={() => setCurrentPage(pageNum)}
                        className="w-10"
                      >
                        {pageNum}
                      </Button>
                    );
                  })}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  Próximo
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Lead Dialog */}
      <Dialog open={leadDialogOpen} onOpenChange={setLeadDialogOpen}>
        <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden rounded-xl">
          {/* Header moderno */}
          <DialogHeader className="px-6 pt-5 pb-4 bg-gradient-to-r from-primary/5 via-primary/3 to-transparent border-b">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <User className="h-5 w-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-lg font-semibold">
                  {editingLead ? "Editar Lead" : "Novo Lead"}
                </DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {editingLead ? "Atualize as informações do lead" : "Preencha os dados para criar um novo lead"}
                </p>
              </div>
            </div>
          </DialogHeader>

          <ScrollArea className="max-h-[65vh]">
            <div className="p-6 space-y-5">
              {/* Informações Básicas */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Informações Básicas</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Nome</Label>
                    <Input value={formLead.nome} onChange={(e) => setFormLead({ ...formLead, nome: e.target.value })} placeholder="Nome do lead" className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Telefone *</Label>
                    <Input value={formLead.telefone} onChange={(e) => setFormLead({ ...formLead, telefone: e.target.value })} placeholder="5511999999999" className="h-9" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Email</Label>
                    <Input type="email" value={formLead.email} onChange={(e) => setFormLead({ ...formLead, email: e.target.value })} placeholder="email@exemplo.com" className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Origem</Label>
                    <Input value={formLead.origem} onChange={(e) => setFormLead({ ...formLead, origem: e.target.value })} placeholder="Ex: site, indicação" className="h-9" />
                  </div>
                </div>
              </div>

              <div className="h-px bg-border" />

              {/* Classificação */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Classificação</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Tipo de Lead</Label>
                    <Select value={formLead.tipo_lead} onValueChange={(value) => setFormLead({ ...formLead, tipo_lead: value })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent position="popper">
                        {tiposLeadBase.map(tipo => (<SelectItem key={tipo} value={tipo}>{tipo}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Especialidade</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" role="combobox" className="w-full justify-between font-normal h-9">
                          {formLead.especialidade_id
                            ? especialidadesFromDB.find(e => e.id === formLead.especialidade_id)?.nome || "Selecione..."
                            : "Nenhuma"}
                          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[300px] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Buscar especialidade..." />
                          <CommandList>
                            <CommandEmpty>Nenhuma encontrada.</CommandEmpty>
                            <CommandGroup>
                              <CommandItem value="__none__" onSelect={() => setFormLead({ ...formLead, especialidade_id: "" })}>
                                Nenhuma
                              </CommandItem>
                              {especialidadesFromDB.map(esp => (
                                <CommandItem key={esp.id} value={esp.nome} onSelect={() => setFormLead({ ...formLead, especialidade_id: esp.id })}>
                                  <Check className={`mr-2 h-3 w-3 ${formLead.especialidade_id === esp.id ? "opacity-100" : "opacity-0"}`} />
                                  {esp.nome}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                {/* Especialidades Secundárias */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Especialidades Secundárias</Label>
                  <div className="flex items-start gap-3">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="justify-between font-normal h-9 min-w-[200px]">
                          {formLead.especialidades_secundarias_ids.length === 0
                            ? "Nenhuma selecionada"
                            : `${formLead.especialidades_secundarias_ids.length} selecionada(s)`}
                          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[300px] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Buscar especialidade..." />
                          <CommandList>
                            <CommandEmpty>Nenhuma encontrada.</CommandEmpty>
                            <CommandGroup>
                              {especialidadesFromDB
                                .filter(esp => esp.id !== formLead.especialidade_id)
                                .map(esp => (
                                <CommandItem
                                  key={esp.id}
                                  value={esp.nome}
                                  onSelect={() => {
                                    setFormLead(prev => ({
                                      ...prev,
                                      especialidades_secundarias_ids: prev.especialidades_secundarias_ids.includes(esp.id)
                                        ? prev.especialidades_secundarias_ids.filter(e => e !== esp.id)
                                        : [...prev.especialidades_secundarias_ids, esp.id]
                                    }));
                                  }}
                                >
                                  <Checkbox checked={formLead.especialidades_secundarias_ids.includes(esp.id)} className="mr-2" />
                                  {esp.nome}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {formLead.especialidades_secundarias_ids.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 flex-1">
                        {formLead.especialidades_secundarias_ids.map(id => {
                          const esp = especialidadesFromDB.find(e => e.id === id);
                          return esp ? (
                            <Badge key={id} variant="secondary" className="text-[11px] gap-1 px-2 py-0.5">
                              {esp.nome}
                              <X className="h-3 w-3 cursor-pointer hover:text-destructive transition-colors" onClick={() => setFormLead(prev => ({
                                ...prev,
                                especialidades_secundarias_ids: prev.especialidades_secundarias_ids.filter(e => e !== id)
                              }))} />
                            </Badge>
                          ) : null;
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="h-px bg-border" />

              {/* Observações */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Observações</h3>
                <Textarea value={formLead.anotacoes} onChange={(e) => setFormLead({ ...formLead, anotacoes: e.target.value })} placeholder="Observações sobre o lead..." rows={3} className="resize-none" />
              </div>
            </div>
          </ScrollArea>

          <div className="flex justify-end gap-2 px-6 py-4 border-t bg-muted/30">
            <Button variant="outline" onClick={() => setLeadDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveLead} className="px-6">{editingLead ? "Salvar" : "Criar Lead"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={(open) => {
        if (parsingImport) return;
        setImportDialogOpen(open);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar Leads</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-4 bg-muted rounded-lg">
              <h4 className="font-medium mb-2">Formato obrigatório:</h4>
              <p className="text-sm text-muted-foreground mb-2">
                O telefone deve ter exatamente <strong>13 dígitos</strong> no formato <strong>55 + DDD + 9 + 8 dígitos</strong>.
              </p>
              <p className="text-sm text-muted-foreground mb-2">Exemplo: <code className="bg-muted-foreground/10 px-1 rounded">5511999887766</code></p>
              <p className="text-sm text-destructive text-xs mb-2">⚠️ Números com formato diferente serão rejeitados.</p>
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                <li>A planilha deve conter: <strong>nome, telefone, email, anotacoes</strong></li>
                <li>Tipo de lead e especialidade serão escolhidos na próxima etapa</li>
                <li>Leads duplicados são ignorados automaticamente</li>
              </ul>
            </div>

            {parsingImport ? (
              <div className="border rounded-lg p-6 space-y-4 bg-muted/30">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Processando planilha</p>
                    <p className="text-sm text-muted-foreground truncate max-w-[320px]">{importFileName}</p>
                  </div>
                </div>

                <Progress value={parseProgress} className="h-2" />

                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {parseCounts.processed.toLocaleString("pt-BR")} de {parseCounts.total.toLocaleString("pt-BR")} linhas
                  </span>
                  <span className="font-medium">{parseProgress}%</span>
                </div>

                <p className="text-xs text-muted-foreground">
                  Estamos lendo a planilha em blocos para evitar travamentos do navegador.
                </p>
              </div>
            ) : (
              <div className="border-2 border-dashed rounded-lg p-8 text-center">
                <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-sm text-muted-foreground mb-4">
                  CSV, TXT ou arquivo com contatos separados por vírgula, ponto-e-vírgula ou tab
                </p>
                <Input
                  type="file"
                  accept=".csv,.txt,.xlsx,.xls"
                  onChange={handleFileSelect}
                  className="max-w-xs mx-auto"
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview Import Dialog */}
      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Prévia da Importação
            </DialogTitle>
          </DialogHeader>
          
          <div className="flex-1 overflow-auto space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              <Card className="bg-green-500/10 border-green-500/30">
                <CardContent className="pt-4 flex items-center gap-3">
                  <CheckCircle2 className="h-8 w-8 text-green-500" />
                  <div>
                    <p className="text-2xl font-bold text-green-600">{validLeadsForImport.length}</p>
                    <p className="text-sm text-muted-foreground">Leads válidos</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-yellow-500/10 border-yellow-500/30">
                <CardContent className="pt-4 flex items-center gap-3">
                  <AlertCircle className="h-8 w-8 text-yellow-500" />
                  <div>
                    <p className="text-2xl font-bold text-yellow-600">{importDuplicates.length}</p>
                    <p className="text-sm text-muted-foreground">Duplicados</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-red-500/10 border-red-500/30">
                <CardContent className="pt-4 flex items-center gap-3">
                  <AlertCircle className="h-8 w-8 text-red-500" />
                  <div>
                    <p className="text-2xl font-bold text-red-600">{invalidLeadsForImport.length + importErrors.length}</p>
                    <p className="text-sm text-muted-foreground">Erros</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Tipo e Especialidade para toda a importação */}
            <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
              <div>
                <Label className="text-sm font-medium">Tipo de Lead (para todos)</Label>
                <Select value={importTipoLead} onValueChange={setImportTipoLead}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Selecione o tipo..." />
                  </SelectTrigger>
                  <SelectContent position="popper" className="z-[9999]">
                    {tiposLeadFromDB.map(tipo => (
                      <SelectItem key={tipo.nome} value={tipo.nome}>{tipo.nome}</SelectItem>
                    ))}
                    {tiposLeadBase.filter(t => !tiposLeadFromDB.find(db => db.nome === t)).map(tipo => (
                      <SelectItem key={tipo} value={tipo}>{tipo}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">Especialidade (para todos)</Label>
                <Select value={importEspecialidadeId || "none"} onValueChange={(v) => setImportEspecialidadeId(v === "none" ? "" : v)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent position="popper" className="z-[9999]">
                    <SelectItem value="none">Nenhuma</SelectItem>
                    {especialidadesFromDB.map(esp => (
                      <SelectItem key={esp.id} value={esp.id}>{esp.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Preview Table */}
            <div className="border rounded-lg overflow-hidden">
              <ScrollArea className="h-[300px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>Telefone Formatado</TableHead>
                      <TableHead>Erro</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedLeads.slice(0, 50).map((lead, idx) => (
                      <TableRow key={idx} className={!lead.telefone_valido ? "bg-red-500/5" : ""}>
                        <TableCell>
                          {lead.telefone_valido ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : (
                            <AlertCircle className="h-4 w-4 text-red-500" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{lead.nome}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {lead.telefone_valido ? lead.telefone_formatado : lead.telefone}
                        </TableCell>
                        <TableCell className="text-xs text-red-500">
                          {lead.telefone_erro || "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {parsedLeads.length > 50 && (
                  <p className="text-center py-4 text-sm text-muted-foreground">
                    Mostrando 50 de {parsedLeads.length} leads...
                  </p>
                )}
              </ScrollArea>
            </div>

            {/* Invalid Leads (telefone inválido) */}
            {invalidLeadsForImport.length > 0 && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg space-y-2">
                <p className="font-medium text-red-600">
                  Leads com erro: {invalidLeadsForImport.length}
                </p>
                <ScrollArea className="h-[120px]">
                  <ul className="text-sm text-red-500 space-y-1">
                    {invalidLeadsForImport.map((lead, idx) => (
                      <li key={`invalid-${idx}`}>
                        {lead.nome || "Sem nome"}: {lead.telefone_erro || "Telefone inválido"} - Tel: {lead.telefone || "vazio"}
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </div>
            )}

            {importing && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Importando leads...</p>
                <Progress value={importProgress} />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewDialogOpen(false)} disabled={importing}>
              Cancelar
            </Button>
            <Button onClick={() => handleConfirmImport(importFileName)} disabled={importing || validLeadsForImport.length === 0}>
              {importing ? "Importando..." : `Importar ${validLeadsForImport.length} Leads`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reprocess Dialog */}
      <Dialog open={reprocessDialogOpen} onOpenChange={setReprocessDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Reprocessar Leads
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="p-4 bg-muted rounded-lg">
              <h4 className="font-medium mb-2">O que será feito:</h4>
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                <li>Analisar nome de cada lead importado</li>
                <li>Extrair e separar: Dr./Dra., Paciente, etc.</li>
                <li>Identificar tipo: Médico, Paciente, Fornecedor</li>
                <li>Detectar especialidades médicas</li>
                <li>Extrair convênios e clínicas para observações</li>
                <li>Limpar nome removendo informações extras</li>
              </ul>
            </div>

            <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <p className="text-sm text-yellow-600">
                <strong>Atenção:</strong> Serão processados leads com origem "importacao" ou tipo "novo". 
                Total estimado: {totalLeads.toLocaleString()} leads.
              </p>
            </div>

            {reprocessing && (
              <div className="space-y-3">
                <Progress value={reprocessProgress} />
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold">{reprocessStats.total}</p>
                    <p className="text-xs text-muted-foreground">Total</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-green-600">{reprocessStats.updated}</p>
                    <p className="text-xs text-muted-foreground">Atualizados</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-500">{reprocessStats.skipped}</p>
                    <p className="text-xs text-muted-foreground">Ignorados</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReprocessDialogOpen(false)} disabled={reprocessing}>
              Cancelar
            </Button>
            <Button onClick={handleReprocessLeads} disabled={reprocessing}>
              {reprocessing ? "Reprocessando..." : "Iniciar Reprocessamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete All Dialog */}
      <Dialog open={deleteAllDialogOpen} onOpenChange={setDeleteAllDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Limpar Todos os Leads
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
              <p className="text-sm text-destructive">
                <strong>Atenção:</strong> Esta ação irá remover permanentemente todos os {totalLeads.toLocaleString()} leads. 
                Esta ação não pode ser desfeita!
              </p>
            </div>

            {deletingAll && (
              <div className="space-y-3">
                <Progress value={deleteAllProgress} className="h-2" />
                <p className="text-sm text-center text-muted-foreground">
                  Deletando leads... {Math.round(deleteAllProgress)}%
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteAllDialogOpen(false)} disabled={deletingAll}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDeleteAllLeads} disabled={deletingAll}>
              {deletingAll ? "Deletando..." : "Confirmar Exclusão"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Result Dialog */}
      <Dialog open={importResultDialogOpen} onOpenChange={setImportResultDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              Resultado da Importação
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-green-500/10 rounded-lg text-center">
                <p className="text-2xl font-bold text-green-600">{importResultData.imported}</p>
                <p className="text-xs text-muted-foreground">Adicionados</p>
              </div>
              <div className="p-3 bg-yellow-500/10 rounded-lg text-center">
                <p className="text-2xl font-bold text-yellow-600">{importResultData.duplicadosBanco + importResultData.duplicadosArquivo}</p>
                <p className="text-xs text-muted-foreground">Duplicados</p>
              </div>
              <div className="p-3 bg-red-500/10 rounded-lg text-center">
                <p className="text-2xl font-bold text-red-600">{importResultData.invalidos}</p>
                <p className="text-xs text-muted-foreground">Inválidos (não tem 13 dígitos)</p>
              </div>
              <div className="p-3 bg-muted rounded-lg text-center">
                <p className="text-2xl font-bold">{importResultData.total}</p>
                <p className="text-xs text-muted-foreground">Total no arquivo</p>
              </div>
            </div>
            {importResultData.duplicadosBanco > 0 && (
              <p className="text-xs text-muted-foreground">
                {importResultData.duplicadosBanco} leads já existiam no banco e foram ignorados.
                {importResultData.duplicadosArquivo > 0 && ` ${importResultData.duplicadosArquivo} duplicados dentro do próprio arquivo.`}
              </p>
            )}
            {importResultData.invalidos > 0 && (
              <p className="text-xs text-muted-foreground">
                Números inválidos: o telefone deve ter exatamente 13 dígitos (55 + DDD + 9 + 8 dígitos).
              </p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setImportResultDialogOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import History Dialog */}
      <Dialog open={showImportHistory} onOpenChange={setShowImportHistory}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Histórico de Importações
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1">
            {importHistory.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">Nenhuma importação realizada ainda.</p>
            ) : (
              <div className="space-y-3 pr-4">
                {importHistory.map((item: any) => (
                  <div key={item.id} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-sm truncate">{item.nome_arquivo}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(item.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                      </p>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs gap-1">
                        Total: {item.total_linhas}
                      </Badge>
                      <Badge className="bg-green-500 text-white text-xs gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        {item.leads_adicionados} adicionados
                      </Badge>
                      {item.leads_duplicados > 0 && (
                        <Badge variant="secondary" className="text-xs gap-1">
                          {item.leads_duplicados} duplicados
                        </Badge>
                      )}
                      {item.leads_invalidos > 0 && (
                        <Badge variant="destructive" className="text-xs gap-1">
                          {item.leads_invalidos} inválidos
                        </Badge>
                      )}
                      {item.leads_erro > 0 && (
                        <Badge variant="destructive" className="text-xs gap-1">
                          {item.leads_erro} erros
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

        {/* Lead Detail Dialog */}
        <LeadDetailDialog
          lead={selectedLead}
          open={detailDialogOpen}
          onOpenChange={setDetailDialogOpen}
          onLeadUpdated={fetchLeads}
        />
    </div>
  );
}
