import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { User, Phone, Mail, CheckCircle, Clock, XCircle, Megaphone, Paperclip, Send, FileText, Image, X, MessageSquare, History, AlertCircle, RotateCcw, Search, ChevronsUpDown, Check } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

interface LeadComment {
  id: string;
  texto: string;
  autor_id: string | null;
  created_at: string;
  autor?: { nome: string } | null;
  attachments?: LeadCommentAttachment[];
}

interface LeadCommentAttachment {
  id: string;
  file_name: string;
  file_url: string;
  file_type: string | null;
  file_size: number | null;
}

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
  lead_especialidades_secundarias?: { especialidade_id: string; especialidades: { nome: string } }[];
}

interface CampanhaHistorico {
  id: string;
  campanha_id: string;
  status: string;
  enviado_em: string | null;
  created_at: string;
  campanhas_disparo?: { nome: string } | null;
}

interface DisparoHistorico {
  id: string;
  campanha_id: string;
  envio_id: string | null;
  status: string;
  enviado_em: string | null;
  created_at: string;
  telefone: string;
  erro: string | null;
  campanhas_disparo: { nome: string; tipo: string | null } | null;
}

interface LeadDetailDialogProps {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLeadUpdated: () => void;
}

const tiposLeadBase = [
  "medico", "estudante_medicina", "empresario", "negocios",
  "hospital", "paciente", "secretaria", "fornecedor",
  "parceiro", "novo", "qualificado", "interessado",
  "convertido", "perdido"
];

export default function LeadDetailDialog({ lead, open, onOpenChange, onLeadUpdated }: LeadDetailDialogProps) {
  const [campanhas, setCampanhas] = useState<CampanhaHistorico[]>([]);
  const [disparos, setDisparos] = useState<DisparoHistorico[]>([]);
  const [comments, setComments] = useState<LeadComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showCustomEspecialidade, setShowCustomEspecialidade] = useState(false);
  const [showCustomTipoLead, setShowCustomTipoLead] = useState(false);
  const [especialidades, setEspecialidades] = useState<{id: string; nome: string}[]>([]);
  const [activeTab, setActiveTab] = useState("dados");
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [formData, setFormData] = useState({
    nome: "", telefone: "", email: "",
    tipo_lead: "novo", especialidade_id: "" as string,
    especialidades_secundarias_ids: [] as string[],
    origem: "", anotacoes: ""
  });

  const fetchEspecialidades = async () => {
    const { data } = await supabase.from("especialidades").select("id, nome").order("nome");
    if (data) setEspecialidades(data);
  };

  useEffect(() => {
    if (lead && open) {
      fetchCampanhas();
      fetchDisparos();
      fetchComments();
      fetchEspecialidades();
      setFormData({
        nome: lead.nome || "", telefone: lead.telefone,
        email: lead.email || "", tipo_lead: lead.tipo_lead || "novo",
        especialidade_id: lead.especialidade_id || "",
        especialidades_secundarias_ids: lead.lead_especialidades_secundarias?.map(s => s.especialidade_id) || [],
        origem: lead.origem || "",
        anotacoes: lead.anotacoes || ""
      });
      setShowCustomEspecialidade(false);
      setNewComment("");
      setPendingFiles([]);
    }
  }, [lead, open]);

  useEffect(() => {
    if (especialidades.length > 0 && formData.especialidade_id && !especialidades.find(e => e.id === formData.especialidade_id)) {
      setShowCustomEspecialidade(true);
    }
  }, [especialidades, formData.especialidade_id]);

  const fetchCampanhas = async () => {
    if (!lead) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("lead_campanha_historico")
      .select("*, campanhas_disparo(nome)")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: false });
    if (!error) setCampanhas(data || []);
    setLoading(false);
  };

  const fetchDisparos = async () => {
    if (!lead) return;
    const { data, error } = await supabase
      .from("campanha_envios")
      .select("id, campanha_id, envio_id, status, enviado_em, created_at, telefone, erro, campanhas_disparo(nome, tipo)")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: false });
    if (!error) setDisparos((data || []) as DisparoHistorico[]);
  };

  const fetchComments = async () => {
    if (!lead) return;
    const { data, error } = await supabase
      .from("lead_comments")
      .select("*, autor:profiles(nome)")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: false });
    if (error) return;
    const commentsWithAttachments = await Promise.all(
      (data || []).map(async (comment: any) => {
        const { data: attachments } = await supabase
          .from("lead_comment_attachments").select("*").eq("comment_id", comment.id);
        return { ...comment, attachments: attachments || [] };
      })
    );
    setComments(commentsWithAttachments);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setPendingFiles(prev => [...prev, ...files]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removePendingFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddComment = async () => {
    if (!lead || (!newComment.trim() && pendingFiles.length === 0)) return;
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: commentData, error: commentError } = await supabase
        .from("lead_comments")
        .insert({ lead_id: lead.id, texto: newComment.trim() || "(Anexo)", autor_id: user?.id || null })
        .select().single();
      if (commentError) throw commentError;
      for (const file of pendingFiles) {
        const fileExt = file.name.split('.').pop();
        const filePath = `${lead.id}/${commentData.id}/${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from("lead-attachments").upload(filePath, file);
        if (uploadError) continue;
        const { data: { publicUrl } } = supabase.storage.from("lead-attachments").getPublicUrl(filePath);
        await supabase.from("lead_comment_attachments").insert({
          comment_id: commentData.id, file_name: file.name,
          file_url: publicUrl, file_type: file.type, file_size: file.size
        });
      }
      setNewComment(""); setPendingFiles([]); fetchComments();
      toast.success("Comentário adicionado");
    } catch (error) {
      console.error(error); toast.error("Erro ao adicionar comentário");
    } finally { setUploading(false); }
  };

  const getFileIcon = (fileType: string | null) => {
    if (fileType?.startsWith("image/")) return <Image className="h-3.5 w-3.5" />;
    return <FileText className="h-3.5 w-3.5" />;
  };

  const handleSave = async () => {
    if (!lead) return;
    if (!formData.telefone) { toast.error("Telefone é obrigatório"); return; }
    if (showCustomTipoLead && formData.tipo_lead && !tiposLeadBase.includes(formData.tipo_lead)) {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from("tipos_lead").upsert({ nome: formData.tipo_lead, cor: '#6366F1', created_by: user?.id }, { onConflict: 'nome' });
    }
    
    // Se especialidade customizada, criar e obter o id
    let finalEspecialidadeId = formData.especialidade_id || null;
    if (showCustomEspecialidade && formData.especialidade_id) {
      // especialidade_id neste caso contém o nome digitado
      const nomeEsp = formData.especialidade_id;
      const { data: { user } } = await supabase.auth.getUser();
      const { data: upserted } = await supabase.from("especialidades").upsert({ nome: nomeEsp, created_by: user?.id }, { onConflict: 'nome' }).select("id").single();
      finalEspecialidadeId = upserted?.id || null;
    }
    
    const { error } = await supabase.from("leads").update({
      nome: formData.nome || null, telefone: formData.telefone,
      email: formData.email || null, tipo_lead: formData.tipo_lead,
      especialidade_id: finalEspecialidadeId, origem: formData.origem || null,
      anotacoes: formData.anotacoes || null
    }).eq("id", lead.id);
    if (error) { toast.error("Erro ao atualizar lead"); return; }

    // Save secondary specialties
    await supabase.from("lead_especialidades_secundarias" as any).delete().eq("lead_id", lead.id);
    if (formData.especialidades_secundarias_ids.length > 0) {
      await supabase.from("lead_especialidades_secundarias" as any).insert(
        formData.especialidades_secundarias_ids.map(espId => ({
          lead_id: lead.id,
          especialidade_id: espId
        }))
      );
    }

    toast.success("Lead atualizado"); onLeadUpdated();
  };

  const getTipoLeadColor = (tipo: string | null) => {
    const colors: Record<string, string> = {
      novo: "bg-blue-500", qualificado: "bg-green-500", interessado: "bg-yellow-500",
      negociando: "bg-purple-500", convertido: "bg-emerald-500", perdido: "bg-red-500",
      recontato: "bg-orange-500", paciente: "bg-cyan-500", medico: "bg-teal-500",
      fornecedor: "bg-indigo-500", parceiro: "bg-pink-500"
    };
    return colors[tipo || "novo"] || "bg-gray-500";
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "enviado":
        return <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50 text-[10px] px-1.5 py-0"><CheckCircle className="h-3 w-3 mr-0.5" />Enviado</Badge>;
      case "erro":
        return <Badge variant="outline" className="text-red-600 border-red-300 bg-red-50 text-[10px] px-1.5 py-0"><XCircle className="h-3 w-3 mr-0.5" />Erro</Badge>;
      case "NoZap":
        return <Badge variant="outline" className="text-orange-600 border-orange-300 bg-orange-50 text-[10px] px-1.5 py-0"><AlertCircle className="h-3 w-3 mr-0.5" />NoZap</Badge>;
      case "reenviar":
        return <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 text-[10px] px-1.5 py-0"><RotateCcw className="h-3 w-3 mr-0.5" />Reenviar</Badge>;
      case "tratando":
        return <Badge variant="outline" className="text-purple-600 border-purple-300 bg-purple-50 text-[10px] px-1.5 py-0"><Clock className="h-3 w-3 mr-0.5" />Tratando</Badge>;
      case "pendente":
      case "enviar":
        return <Badge variant="outline" className="text-blue-600 border-blue-300 bg-blue-50 text-[10px] px-1.5 py-0"><Clock className="h-3 w-3 mr-0.5" />Pendente</Badge>;
      default:
        return <Badge variant="outline" className="text-muted-foreground text-[10px] px-1.5 py-0">{status}</Badge>;
    }
  };

  const disparoStats = {
    total: disparos.length,
    enviados: disparos.filter(d => d.status === "enviado").length,
    erros: disparos.filter(d => d.status === "erro" || d.status === "NoZap").length,
    pendentes: disparos.filter(d => ["enviar", "reenviar", "tratando", "pendente"].includes(d.status)).length,
  };

  if (!lead) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] p-0 gap-0 overflow-hidden rounded-xl">
        {/* Header moderno com gradiente */}
        <DialogHeader className="relative px-6 pt-5 pb-4 bg-gradient-to-r from-primary/5 via-primary/3 to-transparent border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-sm ${getTipoLeadColor(formData.tipo_lead)}`}>
                <User className="h-6 w-6 text-white" />
              </div>
              <div>
                <DialogTitle className="text-lg font-semibold tracking-tight">
                  {formData.nome || "Lead sem nome"}
                </DialogTitle>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full">
                    <Phone className="h-3 w-3" />
                    {formData.telefone}
                  </div>
                  {formData.email && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full">
                      <Mail className="h-3 w-3" />
                      {formData.email}
                    </div>
                  )}
                  {formData.tipo_lead && (
                    <Badge variant="secondary" className="text-[10px] font-medium">
                      {formData.tipo_lead}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <Button size="sm" onClick={handleSave} className="shadow-sm px-5">
              Salvar
            </Button>
          </div>
        </DialogHeader>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="w-full justify-start rounded-none border-b bg-transparent h-10 px-6 gap-1">
            <TabsTrigger value="dados" className="text-xs font-medium data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4">
              Dados
            </TabsTrigger>
            <TabsTrigger value="historico" className="text-xs font-medium data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4">
              <History className="h-3.5 w-3.5 mr-1.5" />
              Histórico ({disparoStats.total})
            </TabsTrigger>
            <TabsTrigger value="comentarios" className="text-xs font-medium data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4">
              <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
              Comentários ({comments.length})
            </TabsTrigger>
          </TabsList>

          {/* Tab Dados */}
          <TabsContent value="dados" className="flex-1 m-0 min-h-0">
            <ScrollArea className="h-[calc(90vh-160px)]">
              <div className="p-6 space-y-5">
                {/* Informações Básicas */}
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Informações Básicas</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Nome</Label>
                      <Input value={formData.nome} onChange={(e) => setFormData({ ...formData, nome: e.target.value })} placeholder="Nome do lead" className="h-9" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Telefone *</Label>
                      <Input value={formData.telefone} onChange={(e) => setFormData({ ...formData, telefone: e.target.value })} placeholder="5511999999999" className="h-9" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Email</Label>
                      <Input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="email@exemplo.com" className="h-9" />
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Classificação */}
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Classificação</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Tipo de Lead</Label>
                      {showCustomTipoLead ? (
                        <div className="flex gap-1">
                          <Input value={formData.tipo_lead} onChange={(e) => setFormData({ ...formData, tipo_lead: e.target.value })} placeholder="Digite o tipo..." className="flex-1 h-9" />
                          <Button type="button" variant="outline" size="icon" className="h-9 w-9" onClick={() => { setShowCustomTipoLead(false); setFormData({ ...formData, tipo_lead: "novo" }); }}>×</Button>
                        </div>
                      ) : (
                        <Select value={formData.tipo_lead || "novo"} onValueChange={(value) => {
                          if (value === "outro_tipo") { setShowCustomTipoLead(true); setFormData({ ...formData, tipo_lead: "" }); }
                          else setFormData({ ...formData, tipo_lead: value });
                        }}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent position="popper">
                            <SelectItem value="outro_tipo">+ Outro tipo</SelectItem>
                            {tiposLeadBase.map(tipo => (<SelectItem key={tipo} value={tipo}>{tipo}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Especialidade</Label>
                      {showCustomEspecialidade ? (
                        <div className="flex gap-1">
                          <Input value={formData.especialidade_id} onChange={(e) => setFormData({ ...formData, especialidade_id: e.target.value })} placeholder="Digite a especialidade..." className="flex-1 h-9" />
                          <Button type="button" variant="outline" size="icon" className="h-9 w-9" onClick={() => { setShowCustomEspecialidade(false); setFormData({ ...formData, especialidade_id: "" }); }}>×</Button>
                        </div>
                      ) : (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" role="combobox" className="w-full justify-between font-normal h-9">
                              {formData.especialidade_id
                                ? especialidades.find(e => e.id === formData.especialidade_id)?.nome || "Selecione..."
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
                                  <CommandItem value="__outro__" onSelect={() => { setShowCustomEspecialidade(true); setFormData({ ...formData, especialidade_id: "" }); }}>
                                    + Outra especialidade
                                  </CommandItem>
                                  <CommandItem value="__none__" onSelect={() => setFormData({ ...formData, especialidade_id: "" })}>
                                    Nenhuma
                                  </CommandItem>
                                  {especialidades.map(esp => (
                                    <CommandItem key={esp.id} value={esp.nome} onSelect={() => setFormData({ ...formData, especialidade_id: esp.id })}>
                                      <Check className={`mr-2 h-3 w-3 ${formData.especialidade_id === esp.id ? "opacity-100" : "opacity-0"}`} />
                                      {esp.nome}
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Origem</Label>
                      <Input value={formData.origem} onChange={(e) => setFormData({ ...formData, origem: e.target.value })} placeholder="Ex: site, indicação" className="h-9" />
                    </div>
                  </div>
                </div>

                {/* Especialidades Secundárias */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Especialidades Secundárias</Label>
                  <div className="flex items-start gap-3">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="justify-between font-normal h-9 min-w-[220px]">
                          {formData.especialidades_secundarias_ids.length === 0
                            ? "Nenhuma selecionada"
                            : `${formData.especialidades_secundarias_ids.length} selecionada(s)`}
                          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[300px] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Buscar especialidade..." />
                          <CommandList>
                            <CommandEmpty>Nenhuma encontrada.</CommandEmpty>
                            <CommandGroup>
                              {especialidades
                                .filter(esp => esp.id !== formData.especialidade_id)
                                .map(esp => (
                                <CommandItem
                                  key={esp.id}
                                  value={esp.nome}
                                  onSelect={() => {
                                    setFormData(prev => ({
                                      ...prev,
                                      especialidades_secundarias_ids: prev.especialidades_secundarias_ids.includes(esp.id)
                                        ? prev.especialidades_secundarias_ids.filter(e => e !== esp.id)
                                        : [...prev.especialidades_secundarias_ids, esp.id]
                                    }));
                                  }}
                                >
                                  <Checkbox checked={formData.especialidades_secundarias_ids.includes(esp.id)} className="mr-2" />
                                  {esp.nome}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {formData.especialidades_secundarias_ids.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 flex-1">
                        {formData.especialidades_secundarias_ids.map(id => {
                          const esp = especialidades.find(e => e.id === id);
                          return esp ? (
                            <Badge key={id} variant="secondary" className="text-[11px] gap-1 px-2 py-0.5">
                              {esp.nome}
                              <X className="h-3 w-3 cursor-pointer hover:text-destructive transition-colors" onClick={() => setFormData(prev => ({
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

                <Separator />

                {/* Observações */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Observações</h3>
                  <Textarea value={formData.anotacoes} onChange={(e) => setFormData({ ...formData, anotacoes: e.target.value })} placeholder="Observações sobre o lead..." rows={3} className="resize-none" />
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Tab Histórico */}
          <TabsContent value="historico" className="flex-1 m-0 min-h-0">
            <ScrollArea className="h-[calc(90vh-160px)]">
              <div className="p-6 space-y-4">
                {disparoStats.total > 0 && (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-green-50 dark:bg-green-950/30 rounded-xl p-3 text-center border border-green-100 dark:border-green-900/50">
                      <p className="text-xl font-bold text-green-700 dark:text-green-400">{disparoStats.enviados}</p>
                      <p className="text-[11px] text-green-600 dark:text-green-500 font-medium">Enviados</p>
                    </div>
                    <div className="bg-red-50 dark:bg-red-950/30 rounded-xl p-3 text-center border border-red-100 dark:border-red-900/50">
                      <p className="text-xl font-bold text-red-700 dark:text-red-400">{disparoStats.erros}</p>
                      <p className="text-[11px] text-red-600 dark:text-red-500 font-medium">Erros/NoZap</p>
                    </div>
                    <div className="bg-blue-50 dark:bg-blue-950/30 rounded-xl p-3 text-center border border-blue-100 dark:border-blue-900/50">
                      <p className="text-xl font-bold text-blue-700 dark:text-blue-400">{disparoStats.pendentes}</p>
                      <p className="text-[11px] text-blue-600 dark:text-blue-500 font-medium">Pendentes</p>
                    </div>
                  </div>
                )}

                {disparos.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground text-sm">
                    <History className="h-10 w-10 mx-auto mb-3 opacity-20" />
                    <p>Este lead ainda não participou de nenhum disparo</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {disparos.map(d => (
                      <div key={d.id} className="flex items-center justify-between p-3 rounded-xl border bg-card hover:bg-accent/30 transition-all duration-150">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Megaphone className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="text-sm font-medium truncate">
                              {d.campanhas_disparo?.nome || "Campanha"}
                            </span>
                            {d.campanhas_disparo?.tipo && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                                {d.campanhas_disparo.tipo}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                            {d.enviado_em ? (
                              <span>Enviado em {format(new Date(d.enviado_em), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
                            ) : (
                              <span>Adicionado em {format(new Date(d.created_at), "dd/MM/yyyy", { locale: ptBR })}</span>
                            )}
                            {d.erro && (
                              <span className="text-red-500 truncate max-w-[250px]">• {d.erro}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex-shrink-0 ml-3">
                          {getStatusBadge(d.status)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Tab Comentários */}
          <TabsContent value="comentarios" className="flex-1 m-0 min-h-0">
            <ScrollArea className="h-[calc(90vh-160px)]">
              <div className="p-6 space-y-4">
                <div className="space-y-2 bg-muted/30 rounded-xl p-4 border">
                  <Textarea value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="Adicionar comentário..." rows={2} className="resize-none bg-background" />
                  {pendingFiles.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {pendingFiles.map((file, index) => (
                        <div key={index} className="flex items-center gap-1 bg-background border px-2 py-0.5 rounded-md text-xs">
                          {getFileIcon(file.type)}
                          <span className="max-w-[100px] truncate">{file.name}</span>
                          <button onClick={() => removePendingFile(index)} className="hover:text-destructive"><X className="h-3 w-3" /></button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" multiple />
                    <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => fileInputRef.current?.click()}>
                      <Paperclip className="h-3.5 w-3.5 mr-1" />Anexar
                    </Button>
                    <Button size="sm" className="h-8 text-xs" onClick={handleAddComment} disabled={uploading || (!newComment.trim() && pendingFiles.length === 0)}>
                      {uploading ? "Enviando..." : <><Send className="h-3.5 w-3.5 mr-1" />Enviar</>}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  {comments.map((comment) => (
                    <div key={comment.id} className="bg-muted/40 rounded-xl p-3 space-y-1.5 border border-transparent hover:border-border transition-colors">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold">{comment.autor?.nome || "Sistema"}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {format(new Date(comment.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{comment.texto}</p>
                      {comment.attachments && comment.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {comment.attachments.map((att) => (
                            <a key={att.id} href={att.file_url} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 bg-background border px-2 py-1 rounded-md text-[11px] hover:bg-accent transition-colors">
                              {getFileIcon(att.file_type)}
                              <span className="max-w-[80px] truncate">{att.file_name}</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {comments.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-8">Nenhum comentário ainda</p>
                  )}
                </div>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
