import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TaskFlowTask } from "./TaskFlowBoard";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import {
  Paperclip,
  Plus,
  Send,
  CalendarIcon,
  History,
  MessageSquare,
  FileText,
  CheckSquare,
  Upload,
  Download,
  Eye,
  Trash2,
  FileImage,
  FileVideo,
  FileAudio,
  File,
  FileArchive,
  FileSpreadsheet,
  User,
  Play,
  Volume2,
  X,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

interface TaskFlowProfile {
  id: string;
  nome: string;
  avatar_url: string | null;
  cor: string;
}

// Interface para autor de comentários/histórico (usa profiles do sistema)
interface SystemUser {
  id: string;
  nome: string;
  cor_perfil: string;
}

interface Attachment {
  id: string;
  file_name: string;
  file_url: string;
  file_type: string | null;
  file_size: number | null;
  created_at: string;
}

interface Comment {
  id: string;
  texto: string;
  tipo: string;
  created_at: string;
  autor?: SystemUser | null;
  attachment_id?: string | null;
}

interface HistoryItem {
  id: string;
  tipo: string;
  descricao: string;
  valor_anterior: string | null;
  valor_novo: string | null;
  created_at: string;
  autor?: SystemUser | null;
}

interface ChecklistItem {
  id: string;
  texto: string;
  concluido: boolean;
  ordem: number;
}

interface TaskTag {
  id: string;
  nome: string;
  cor: string;
}

interface TaskFlowCardModalProps {
  task: TaskFlowTask;
  open: boolean;
  onClose: () => void;
  selectedProfile: TaskFlowProfile;
  allProfiles: TaskFlowProfile[];
  onUpdate: () => void;
  onDelete?: () => void;
}

// Helper para obter informações visuais do arquivo baseado no tipo
const getFileTypeInfo = (mimeType: string | null, fileName: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  
  // PDF
  if (mimeType?.includes('pdf') || ext === 'pdf') {
    return { icon: FileText, color: '#DC2626', bgColor: '#FEE2E2', label: 'PDF' };
  }
  
  // Imagens
  if (mimeType?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
    return { icon: FileImage, color: '#059669', bgColor: '#D1FAE5', label: 'IMG' };
  }
  
  // Vídeos
  if (mimeType?.startsWith('video/') || ['mp4', 'avi', 'mov', 'webm', 'mkv'].includes(ext)) {
    return { icon: FileVideo, color: '#7C3AED', bgColor: '#EDE9FE', label: 'VID' };
  }
  
  // Áudio
  if (mimeType?.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'aac'].includes(ext)) {
    return { icon: FileAudio, color: '#EA580C', bgColor: '#FFEDD5', label: 'AUD' };
  }
  
  // Arquivos compactados
  if (mimeType?.includes('zip') || mimeType?.includes('rar') || ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return { icon: FileArchive, color: '#CA8A04', bgColor: '#FEF3C7', label: 'ZIP' };
  }
  
  // Planilhas
  if (mimeType?.includes('spreadsheet') || mimeType?.includes('excel') || ['xls', 'xlsx', 'csv'].includes(ext)) {
    return { icon: FileSpreadsheet, color: '#16A34A', bgColor: '#DCFCE7', label: 'XLS' };
  }
  
  // Documentos Word
  if (mimeType?.includes('word') || ['doc', 'docx'].includes(ext)) {
    return { icon: FileText, color: '#2563EB', bgColor: '#DBEAFE', label: 'DOC' };
  }
  
  // PowerPoint
  if (mimeType?.includes('presentation') || ['ppt', 'pptx'].includes(ext)) {
    return { icon: FileText, color: '#EA580C', bgColor: '#FFEDD5', label: 'PPT' };
  }
  
  // Texto simples
  if (mimeType?.includes('text') || ['txt', 'md', 'json', 'xml'].includes(ext)) {
    return { icon: FileText, color: '#6B7280', bgColor: '#F3F4F6', label: 'TXT' };
  }
  
  // Arquivo genérico
  return { icon: File, color: '#6B7280', bgColor: '#F3F4F6', label: ext.toUpperCase() || 'FILE' };
};

// Helper para formatar tamanho do arquivo
const formatFileSize = (bytes: number | null) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Helper para verificar se é imagem
const isImageFile = (mimeType: string | null, fileName: string) => {
  if (mimeType?.startsWith('image/')) return true;
  const ext = fileName.split('.').pop()?.toLowerCase();
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext || '');
};

// Helper para verificar se pode abrir preview no navegador
const canPreviewInBrowser = (mimeType: string | null, fileName: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (mimeType?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return true;
  if (mimeType?.includes('pdf') || ext === 'pdf') return true;
  if (mimeType?.startsWith('video/') || ['mp4', 'webm'].includes(ext)) return true;
  if (mimeType?.startsWith('audio/') || ['mp3', 'wav', 'ogg'].includes(ext)) return true;
  return false;
};

export function TaskFlowCardModal({
  task,
  open,
  onClose,
  selectedProfile,
  allProfiles,
  onUpdate,
  onDelete,
}: TaskFlowCardModalProps) {
  const [titulo, setTitulo] = useState(task.titulo);
  const [descricao, setDescricao] = useState(task.descricao || "");
  const [resumo, setResumo] = useState(task.resumo || "");
  const [responsavelId, setResponsavelId] = useState(task.responsavel_id || "");
  const [prazo, setPrazo] = useState<Date | undefined>(
    task.prazo ? new Date(task.prazo) : undefined
  );
  const [dataRetorno, setDataRetorno] = useState<Date | undefined>(
    task.data_retorno ? new Date(task.data_retorno) : undefined
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [checklists, setChecklists] = useState<ChecklistItem[]>([]);
  const [taskTags, setTaskTags] = useState<TaskTag[]>([]);
  const [allTags, setAllTags] = useState<TaskTag[]>([]);
  const [newComment, setNewComment] = useState("");
  const [newChecklistItem, setNewChecklistItem] = useState("");
  const [editingChecklistId, setEditingChecklistId] = useState<string | null>(null);
  const [editingChecklistText, setEditingChecklistText] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<TaskFlowProfile | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Buscar usuário logado do sistema
  useEffect(() => {
    const fetchCurrentUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Buscar perfil do sistema (profiles table)
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, nome, cor_perfil")
          .eq("id", user.id)
          .single();
        
        if (profile) {
          setCurrentUserProfile({
            id: profile.id,
            nome: profile.nome,
            avatar_url: null,
            cor: profile.cor_perfil || "#3B82F6",
          });
        }
      } catch (error) {
        console.error("Erro ao buscar usuário:", error);
      }
    };
    
    fetchCurrentUser();
  }, []);

  // Sincronizar estado quando a tarefa muda
  useEffect(() => {
    setTitulo(task.titulo);
    setDescricao(task.descricao || "");
    setResumo(task.resumo || "");
    setResponsavelId(task.responsavel_id || "");
    setPrazo(task.prazo ? new Date(task.prazo) : undefined);
    setDataRetorno(task.data_retorno ? new Date(task.data_retorno) : undefined);
  }, [task]);

  useEffect(() => {
    if (open) {
      fetchTaskDetails();
    }
  }, [open, task.id]);

  // Paste handler para screenshots
  useEffect(() => {
    if (!open) return;

    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            await uploadFile(file);
          }
          break;
        }
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [open, task.id]);

  const fetchTaskDetails = async () => {
    try {
      const { data: attachmentsData } = await supabase
        .from("task_flow_attachments")
        .select("*")
        .eq("task_id", task.id)
        .order("created_at", { ascending: false });

      const { data: commentsData } = await supabase
        .from("task_flow_comments")
        .select(`*, autor:profiles!task_flow_comments_autor_id_fkey(id, nome, cor_perfil)`)
        .eq("task_id", task.id)
        .order("created_at", { ascending: false });

      const { data: historyData } = await supabase
        .from("task_flow_history")
        .select(`*, autor:profiles!task_flow_history_autor_id_fkey(id, nome, cor_perfil)`)
        .eq("task_id", task.id)
        .order("created_at", { ascending: false });

      const { data: checklistsData } = await supabase
        .from("task_flow_checklists")
        .select("*")
        .eq("task_id", task.id)
        .order("ordem");

      const { data: taskTagsData } = await supabase
        .from("task_flow_task_tags")
        .select(`tag:task_flow_tags(id, nome, cor)`)
        .eq("task_id", task.id);

      const { data: allTagsData } = await supabase
        .from("task_flow_tags")
        .select("*")
        .order("nome");

      setAttachments(attachmentsData || []);
      setComments(commentsData || []);
      setHistory(historyData || []);
      setChecklists(checklistsData || []);
      setTaskTags(taskTagsData?.map(t => t.tag).filter(Boolean) as TaskTag[] || []);
      setAllTags(allTagsData || []);
    } catch (error) {
      console.error("Erro ao carregar detalhes:", error);
    }
  };

  // Sanitiza nome do arquivo removendo acentos e caracteres especiais
  const sanitizeFileName = (name: string) => {
    return name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Remove acentos
      .replace(/[^a-zA-Z0-9._-]/g, "_"); // Substitui caracteres especiais por _
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const safeFileName = sanitizeFileName(file.name);
      const fileName = `${task.id}/${Date.now()}_${safeFileName}`;
      const { error: uploadError } = await supabase.storage
        .from("message-media")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("message-media")
        .getPublicUrl(fileName);

      await supabase.from("task_flow_attachments").insert({
        task_id: task.id,
        file_name: file.name,
        file_url: urlData.publicUrl,
        file_type: file.type,
        file_size: file.size,
        uploaded_by: selectedProfile.id,
      });

      await supabase.from("task_flow_history").insert({
        task_id: task.id,
        autor_id: currentUserProfile?.id || selectedProfile.id,
        tipo: "anexo",
        descricao: `Arquivo "${file.name}" anexado`,
      });

      await supabase.from("task_flow_comments").insert({
        task_id: task.id,
        autor_id: currentUserProfile?.id || selectedProfile.id,
        texto: `📎 Anexou: ${file.name}`,
        tipo: "anexo",
      });

      toast.success("Arquivo anexado!");
      fetchTaskDetails();
    } catch (error) {
      console.error("Erro ao fazer upload:", error);
      toast.error("Erro ao anexar arquivo");
    } finally {
      setUploading(false);
    }
  };

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      await uploadFile(file);
    }
  }, [task.id, selectedProfile.id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const oldPrazo = task.prazo
        ? format(new Date(task.prazo), "dd/MM/yyyy")
        : null;
      const newPrazo = prazo
        ? format(prazo, "dd/MM/yyyy")
        : null;

      const { error } = await supabase
        .from("task_flow_tasks")
        .update({
          titulo,
          descricao: descricao || null,
          resumo: resumo || null,
          responsavel_id: responsavelId || null,
          prazo: prazo ? prazo.toISOString() : null,
          data_retorno: dataRetorno ? dataRetorno.toISOString() : null,
        })
        .eq("id", task.id);

      if (error) throw error;

      // Registrar mudança de prazo
      if (oldPrazo !== newPrazo) {
        await supabase.from("task_flow_history").insert({
          task_id: task.id,
          autor_id: currentUserProfile?.id || selectedProfile.id,
          tipo: "prazo",
          descricao: `Prazo alterado`,
          valor_anterior: oldPrazo,
          valor_novo: newPrazo,
        });
      }

      // Registrar mudança de responsável
      if (task.responsavel_id !== responsavelId) {
        const oldResp = allProfiles.find(p => p.id === task.responsavel_id);
        const newResp = allProfiles.find(p => p.id === responsavelId);
        await supabase.from("task_flow_history").insert({
          task_id: task.id,
          autor_id: currentUserProfile?.id || selectedProfile.id,
          tipo: "responsavel",
          descricao: `Responsável alterado`,
          valor_anterior: oldResp?.nome || "Não definido",
          valor_novo: newResp?.nome || "Não definido",
        });
      }

      toast.success("Tarefa atualizada!");
      onUpdate();
    } catch (error) {
      console.error("Erro ao salvar:", error);
      toast.error("Erro ao salvar tarefa");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTask = async () => {
    setDeleting(true);
    try {
      const { error } = await supabase
        .from("task_flow_tasks")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: currentUserProfile?.id || null,
        })
        .eq("id", task.id);

      if (error) throw error;

      // Registrar no histórico
      await supabase.from("task_flow_history").insert({
        task_id: task.id,
        autor_id: currentUserProfile?.id || selectedProfile.id,
        tipo: "exclusao",
        descricao: `Tarefa "${task.titulo}" excluída`,
      });

      toast.success("Tarefa excluída! Ficará registrada por 30 dias.");
      setShowDeleteConfirm(false);
      onClose();
      onUpdate();
    } catch (error) {
      console.error("Erro ao excluir tarefa:", error);
      toast.error("Erro ao excluir tarefa");
    } finally {
      setDeleting(false);
    }
  };

  const canDeleteTask = currentUserProfile?.id === task.criado_por_id;

  const handleAddComment = async () => {
    if (!newComment.trim()) return;

    try {
      await supabase.from("task_flow_comments").insert({
        task_id: task.id,
        autor_id: currentUserProfile?.id || selectedProfile.id,
        texto: newComment.trim(),
        tipo: "nota",
      });

      setNewComment("");
      fetchTaskDetails();
    } catch (error) {
      console.error("Erro ao adicionar comentário:", error);
      toast.error("Erro ao adicionar comentário");
    }
  };

  const handleAddChecklistItem = async () => {
    if (!newChecklistItem.trim()) return;

    try {
      await supabase.from("task_flow_checklists").insert({
        task_id: task.id,
        texto: newChecklistItem.trim(),
        ordem: checklists.length,
      });

      setNewChecklistItem("");
      fetchTaskDetails();
    } catch (error) {
      console.error("Erro ao adicionar item:", error);
      toast.error("Erro ao adicionar item");
    }
  };

  const handleToggleChecklist = async (item: ChecklistItem) => {
    try {
      await supabase
        .from("task_flow_checklists")
        .update({ concluido: !item.concluido })
        .eq("id", item.id);

      fetchTaskDetails();
    } catch (error) {
      console.error("Erro ao atualizar checklist:", error);
    }
  };

  const handleSaveChecklistEdit = async (itemId: string) => {
    if (!editingChecklistText.trim()) {
      setEditingChecklistId(null);
      return;
    }
    try {
      await supabase
        .from("task_flow_checklists")
        .update({ texto: editingChecklistText.trim() })
        .eq("id", itemId);
      setEditingChecklistId(null);
      setEditingChecklistText("");
      fetchTaskDetails();
    } catch (error) {
      console.error("Erro ao editar checklist:", error);
    }
  };

  const handleDeleteChecklistItem = async (itemId: string) => {
    if (!confirm("Excluir este item do checklist?")) return;
    
    try {
      await supabase.from("task_flow_checklists").delete().eq("id", itemId);
      toast.success("Item removido!");
      fetchTaskDetails();
    } catch (error) {
      console.error("Erro ao excluir item:", error);
      toast.error("Erro ao excluir item");
    }
  };

  const handleDeleteAttachment = async (att: Attachment) => {
    if (!confirm("Excluir este arquivo?")) return;
    
    try {
      await supabase.from("task_flow_attachments").delete().eq("id", att.id);
      
      await supabase.from("task_flow_history").insert({
        task_id: task.id,
        autor_id: currentUserProfile?.id || selectedProfile.id,
        tipo: "anexo",
        descricao: `Arquivo "${att.file_name}" removido`,
      });

      toast.success("Arquivo removido!");
      fetchTaskDetails();
    } catch (error) {
      console.error("Erro ao excluir:", error);
      toast.error("Erro ao excluir arquivo");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      await uploadFile(file);
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleToggleTag = async (tag: TaskTag) => {
    const hasTag = taskTags.some(t => t.id === tag.id);

    try {
      if (hasTag) {
        await supabase
          .from("task_flow_task_tags")
          .delete()
          .eq("task_id", task.id)
          .eq("tag_id", tag.id);
      } else {
        await supabase.from("task_flow_task_tags").insert({
          task_id: task.id,
          tag_id: tag.id,
        });
      }
      fetchTaskDetails();
    } catch (error) {
      console.error("Erro ao atualizar tag:", error);
    }
  };

  const handleDownload = async (att: Attachment) => {
    try {
      const response = await fetch(att.file_url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.file_name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Erro ao baixar:", error);
      toast.error("Erro ao baixar arquivo");
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent 
          className="max-w-none w-[min(1200px,95vw)] max-h-[90vh] overflow-hidden flex flex-col"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Drop overlay */}
          {isDragging && (
            <div className="absolute inset-0 bg-primary/20 border-2 border-dashed border-primary rounded-lg z-50 flex items-center justify-center">
              <div className="text-center">
                <Upload className="h-12 w-12 mx-auto text-primary mb-2" />
                <p className="text-lg font-medium text-primary">Solte os arquivos aqui</p>
              </div>
            </div>
          )}

          <DialogHeader className="flex flex-row items-center justify-between pr-10 gap-4">
            <div className="flex items-center gap-2 flex-1">
              <FileText className="h-5 w-5 shrink-0" />
              <Input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Título da tarefa..."
                className="text-lg font-semibold border-0 shadow-none focus-visible:ring-0 px-0 h-auto"
              />
            </div>
            <DialogDescription className="sr-only">
              Edite os detalhes da tarefa
            </DialogDescription>
            <div className="flex items-center gap-2">
              {canDeleteTask && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  title="Excluir tarefa"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
              <Button onClick={handleSave} disabled={saving} size="sm">
                {saving ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 h-full">
              {/* Lado Esquerdo - Dados (3 colunas) */}
              <div className="md:col-span-3">
                <ScrollArea className="h-[65vh] pr-4">
                  <div className="space-y-4">
                    {/* Prazo + Responsável na mesma linha */}
                    <div className="grid grid-cols-2 gap-4">
                      {/* Prazo */}
                      <div className="space-y-2">
                        <Label className="flex items-center gap-2">
                          <CalendarIcon className="h-4 w-4" />
                          Prazo
                        </Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full justify-start text-left font-normal",
                                !prazo && "text-muted-foreground"
                              )}
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {prazo ? format(prazo, "dd/MM/yyyy", { locale: ptBR }) : "Selecionar..."}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={prazo}
                              onSelect={setPrazo}
                              initialFocus
                              locale={ptBR}
                              className="pointer-events-auto"
                            />
                          </PopoverContent>
                        </Popover>
                      </div>

                      {/* Responsável */}
                      <div className="space-y-2">
                        <Label className="flex items-center gap-2">
                          <User className="h-4 w-4" />
                          Responsável
                        </Label>
                        <Select value={responsavelId} onValueChange={setResponsavelId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecionar..." />
                          </SelectTrigger>
                          <SelectContent>
                            {allProfiles.map(profile => (
                              <SelectItem key={profile.id} value={profile.id}>
                                <div className="flex items-center gap-2">
                                  <Avatar className="h-5 w-5">
                                    <AvatarImage src={profile.avatar_url || undefined} />
                                    <AvatarFallback 
                                      className="text-[8px] text-white"
                                      style={{ backgroundColor: profile.cor }}
                                    >
                                      {profile.nome.charAt(0)}
                                    </AvatarFallback>
                                  </Avatar>
                                  {profile.nome}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Tags / Complexidade */}
                    <div className="space-y-2 border rounded-lg p-3">
                      <Label className="text-sm font-medium">Tags / Complexidade</Label>
                      <div className="flex flex-wrap gap-2">
                        {allTags.map(tag => {
                          const isSelected = taskTags.some(t => t.id === tag.id);
                          return (
                            <Badge
                              key={tag.id}
                              variant={isSelected ? "default" : "outline"}
                              className="cursor-pointer transition-all text-xs"
                              style={
                                isSelected
                                  ? { backgroundColor: tag.cor, color: "#fff", borderColor: tag.cor }
                                  : { borderColor: tag.cor, color: tag.cor }
                              }
                              onClick={() => handleToggleTag(tag)}
                            >
                              {tag.nome}
                            </Badge>
                          );
                        })}
                        {allTags.length === 0 && (
                          <p className="text-xs text-muted-foreground">Nenhuma tag cadastrada</p>
                        )}
                      </div>
                    </div>

                    {/* Áudio da automação */}
                    {task.audio_url && (
                      <div className="space-y-2 border rounded-lg p-3 bg-muted/30">
                        <Label className="flex items-center gap-2">
                          <Volume2 className="h-4 w-4" />
                          Áudio da Automação
                        </Label>
                        <audio 
                          controls 
                          className="w-full h-10"
                          src={task.audio_url}
                        >
                          Seu navegador não suporta o elemento de áudio.
                        </audio>
                      </div>
                    )}

                    {/* Descrição */}
                    <div className="space-y-2">
                      <Label>Descrição</Label>
                      <Textarea
                        value={descricao}
                        onChange={(e) => setDescricao(e.target.value)}
                        rows={6}
                        placeholder="Descrição detalhada..."
                        className="min-h-[120px]"
                      />
                    </div>

                    {/* Checklists */}
                    <div className="space-y-2 border rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-2">
                          <CheckSquare className="h-4 w-4" />
                          Check list
                        </Label>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleAddChecklistItem}>
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="space-y-1">
                        {checklists.map(item => (
                          <div
                            key={item.id}
                            className={`flex items-center gap-2 p-2 rounded group transition-colors ${
                              item.concluido 
                                ? "bg-green-600 dark:bg-green-700" 
                                : "bg-muted/50"
                            }`}
                          >
                            <Checkbox
                              checked={item.concluido}
                              onCheckedChange={() => handleToggleChecklist(item)}
                              className={item.concluido ? "border-white data-[state=checked]:bg-white data-[state=checked]:text-green-600" : ""}
                            />
                            {editingChecklistId === item.id ? (
                              <Input
                                autoFocus
                                className="h-7 text-sm flex-1"
                                value={editingChecklistText}
                                onChange={(e) => setEditingChecklistText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleSaveChecklistEdit(item.id);
                                  if (e.key === "Escape") setEditingChecklistId(null);
                                }}
                                onBlur={() => handleSaveChecklistEdit(item.id)}
                              />
                            ) : (
                              <span
                                className={`text-sm flex-1 cursor-pointer ${
                                  item.concluido ? "line-through text-white" : ""
                                }`}
                                onDoubleClick={() => {
                                  setEditingChecklistId(item.id);
                                  setEditingChecklistText(item.texto);
                                }}
                              >
                                {item.texto}
                              </span>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              className={`h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity ${
                                item.concluido 
                                  ? "text-white/70 hover:text-white hover:bg-green-500" 
                                  : "text-muted-foreground hover:text-destructive"
                              }`}
                              onClick={() => handleDeleteChecklistItem(item.id)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                        <div className="flex gap-2 mt-2">
                          <Input
                            placeholder="Novo item..."
                            value={newChecklistItem}
                            onChange={(e) => setNewChecklistItem(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleAddChecklistItem()}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Anexos */}
                    <div className="space-y-2 border rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-2">
                          <Paperclip className="h-4 w-4" />
                          Anexos ({attachments.length})
                        </Label>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploading}
                          className="h-7"
                        >
                          <Upload className="h-4 w-4 mr-1" />
                          {uploading ? "Enviando..." : "Adicionar"}
                        </Button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          className="hidden"
                          onChange={handleFileUpload}
                        />
                      </div>
                      
                      {/* Drop zone hint */}
                      <p className="text-xs text-muted-foreground">
                        💡 Arraste arquivos aqui ou cole prints (Ctrl+V)
                      </p>

                      {/* Grid de anexos */}
                      {attachments.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {attachments.map(att => {
                            const fileInfo = getFileTypeInfo(att.file_type, att.file_name);
                            const FileIcon = fileInfo.icon;
                            const isImage = isImageFile(att.file_type, att.file_name);
                            const canPreview = canPreviewInBrowser(att.file_type, att.file_name);
                            
                            return (
                              <div
                                key={att.id}
                                className="group relative bg-card border rounded-lg overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
                                onClick={() => canPreview ? setPreviewAttachment(att) : handleDownload(att)}
                              >
                                {/* Thumbnail ou ícone colorido */}
                                <div className="aspect-square flex items-center justify-center relative">
                                  {isImage ? (
                                    <img 
                                      src={att.file_url} 
                                      alt={att.file_name}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <div 
                                      className="w-full h-full flex flex-col items-center justify-center"
                                      style={{ backgroundColor: fileInfo.bgColor }}
                                    >
                                      <FileIcon 
                                        className="h-12 w-12 mb-1" 
                                        style={{ color: fileInfo.color }}
                                      />
                                      <span 
                                        className="text-xs font-bold"
                                        style={{ color: fileInfo.color }}
                                      >
                                        {fileInfo.label}
                                      </span>
                                    </div>
                                  )}
                                  
                                  {/* Overlay com ações */}
                                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                    {canPreview && (
                                      <Button
                                        size="icon"
                                        variant="secondary"
                                        className="h-9 w-9"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setPreviewAttachment(att);
                                        }}
                                        title="Visualizar"
                                      >
                                        <Eye className="h-4 w-4" />
                                      </Button>
                                    )}
                                    <Button
                                      size="icon"
                                      variant="secondary"
                                      className="h-9 w-9"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDownload(att);
                                      }}
                                      title="Download"
                                    >
                                      <Download className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="destructive"
                                      className="h-9 w-9"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteAttachment(att);
                                      }}
                                      title="Excluir"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </div>
                                
                                {/* Nome do arquivo */}
                                <div className="p-2 border-t bg-muted/30">
                                  <p className="text-xs font-medium truncate" title={att.file_name}>
                                    {att.file_name}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">
                                    {formatFileSize(att.file_size)}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </ScrollArea>
              </div>

              {/* Lado Direito - Timeline/Atividade (2 colunas) */}
              <div className="md:col-span-2 border-l pl-4">
                <Tabs defaultValue="chat" className="h-full flex flex-col">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="chat">
                      <MessageSquare className="h-4 w-4 mr-1" />
                      Anotações
                    </TabsTrigger>
                    <TabsTrigger value="history">
                      <History className="h-4 w-4 mr-1" />
                      Histórico
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="chat" className="flex-1 flex flex-col mt-2">
                    <ScrollArea className="flex-1 h-[50vh]">
                      <div className="space-y-2 pr-2">
                        {comments.length === 0 && (
                          <p className="text-center text-muted-foreground text-sm py-8">
                            Nenhuma anotação ainda
                          </p>
                        )}
                        {comments.map(comment => (
                          <div
                            key={comment.id}
                            className={`p-2 rounded text-sm ${
                              comment.tipo === "sistema" || comment.tipo === "anexo"
                                ? "bg-blue-500/10 text-blue-600"
                                : "bg-muted"
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              {comment.autor && (
                                <Avatar className="h-5 w-5">
                                  <AvatarFallback
                                    className="text-[8px] text-white"
                                    style={{ backgroundColor: comment.autor.cor_perfil }}
                                  >
                                    {comment.autor.nome.charAt(0)}
                                  </AvatarFallback>
                                </Avatar>
                              )}
                              <span className="font-medium text-xs">
                                {comment.autor?.nome || "Sistema"}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {format(new Date(comment.created_at), "dd/MM HH:mm", {
                                  locale: ptBR,
                                })}
                              </span>
                            </div>
                            <p className="whitespace-pre-wrap">{comment.texto}</p>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>

                    {/* Input de comentário */}
                    <div className="flex gap-2 mt-2 pt-2 border-t">
                      <Input
                        placeholder="Adicionar anotação..."
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleAddComment()}
                      />
                      <Button size="icon" onClick={handleAddComment}>
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                  </TabsContent>

                  <TabsContent value="history" className="flex-1 mt-2">
                    <ScrollArea className="h-[55vh]">
                      <div className="space-y-2 pr-2">
                        {history.length === 0 && (
                          <p className="text-center text-muted-foreground text-sm py-8">
                            Nenhum histórico ainda
                          </p>
                        )}
                        {history.map(item => (
                          <div key={item.id} className="p-2 bg-muted/50 rounded text-sm">
                            <div className="flex items-center gap-2 mb-1">
                              {item.autor && (
                                <Avatar className="h-5 w-5">
                                  <AvatarFallback
                                    className="text-[8px] text-white"
                                    style={{ backgroundColor: item.autor.cor_perfil }}
                                  >
                                    {item.autor.nome.charAt(0)}
                                  </AvatarFallback>
                                </Avatar>
                              )}
                              <span className="text-[10px] text-muted-foreground">
                                {format(new Date(item.created_at), "dd/MM/yyyy HH:mm", {
                                  locale: ptBR,
                                })}
                              </span>
                            </div>
                            <p>{item.descricao}</p>
                            {item.valor_anterior && item.valor_novo && (
                              <p className="text-xs text-muted-foreground mt-1">
                                <span className="line-through">{item.valor_anterior}</span>
                                {" → "}
                                <span className="font-medium">{item.valor_novo}</span>
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de preview de anexo */}
      {previewAttachment && (
        <Dialog open={!!previewAttachment} onOpenChange={() => setPreviewAttachment(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm">
                <Paperclip className="h-4 w-4" />
                {previewAttachment.file_name}
              </DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-auto">
              {isImageFile(previewAttachment.file_type, previewAttachment.file_name) ? (
                <img 
                  src={previewAttachment.file_url} 
                  alt={previewAttachment.file_name}
                  className="w-full h-auto max-h-[70vh] object-contain rounded"
                />
              ) : previewAttachment.file_type?.includes('pdf') || previewAttachment.file_name.endsWith('.pdf') ? (
                <iframe 
                  src={previewAttachment.file_url}
                  className="w-full h-[70vh] rounded border-0"
                  title={previewAttachment.file_name}
                />
              ) : previewAttachment.file_type?.startsWith('video/') ? (
                <video 
                  src={previewAttachment.file_url}
                  controls
                  className="w-full max-h-[70vh] rounded"
                />
              ) : previewAttachment.file_type?.startsWith('audio/') ? (
                <div className="flex items-center justify-center p-8">
                  <audio 
                    src={previewAttachment.file_url}
                    controls
                    className="w-full max-w-md"
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12">
                  {(() => {
                    const info = getFileTypeInfo(previewAttachment.file_type, previewAttachment.file_name);
                    const FileIconComp = info.icon;
                    return (
                      <>
                        <div 
                          className="w-24 h-24 rounded-xl flex items-center justify-center mb-4"
                          style={{ backgroundColor: info.bgColor }}
                        >
                          <FileIconComp className="h-12 w-12" style={{ color: info.color }} />
                        </div>
                        <p className="text-lg font-medium mb-1">{previewAttachment.file_name}</p>
                        <p className="text-sm text-muted-foreground mb-4">
                          {formatFileSize(previewAttachment.file_size)} • {info.label}
                        </p>
                      </>
                    );
                  })()}
                  <p className="text-sm text-muted-foreground mb-4">
                    Este arquivo não pode ser visualizado no navegador
                  </p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="outline" onClick={() => setPreviewAttachment(null)}>
                Fechar
              </Button>
              <Button onClick={() => handleDownload(previewAttachment)}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Dialog de confirmação de exclusão */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir Tarefa</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir a tarefa "{task.titulo}"? 
              Ela ficará registrada por 30 dias antes de ser removida permanentemente.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDeleteTask} disabled={deleting}>
              {deleting ? "Excluindo..." : "Excluir"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
