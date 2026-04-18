import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { 
  Plus, 
  GripVertical, 
  Trash2, 
  Edit2, 
  Save, 
  X,
  Bot,
  Clock,
  CheckCircle,
  Search,
  Wrench,
  HandHelping,
  UserCheck,
  Bell,
  Columns,
} from "lucide-react";
import { toast } from "sonner";

interface Column {
  id: string;
  nome: string;
  tipo: string;
  ordem: number;
  icone: string | null;
  cor: string | null;
}

const availableColors = [
  { value: "#3B82F6", label: "Azul" },
  { value: "#10B981", label: "Verde" },
  { value: "#F59E0B", label: "Âmbar" },
  { value: "#EF4444", label: "Vermelho" },
  { value: "#8B5CF6", label: "Roxo" },
  { value: "#EC4899", label: "Rosa" },
  { value: "#06B6D4", label: "Ciano" },
  { value: "#F97316", label: "Laranja" },
  { value: "#6366F1", label: "Índigo" },
  { value: "#84CC16", label: "Lima" },
];

interface TaskFlowColumnsConfigProps {
  open: boolean;
  onClose: () => void;
}

const availableIcons = [
  { value: "bot", label: "Bot/Automação", icon: Bot },
  { value: "search", label: "Busca", icon: Search },
  { value: "wrench", label: "Ferramentas", icon: Wrench },
  { value: "clock", label: "Relógio", icon: Clock },
  { value: "hand-helping", label: "Ajuda", icon: HandHelping },
  { value: "user-check", label: "Aprovação", icon: UserCheck },
  { value: "check-circle", label: "Concluído", icon: CheckCircle },
  { value: "bell", label: "Lembrete", icon: Bell },
];

export function TaskFlowColumnsConfig({ open, onClose }: TaskFlowColumnsConfigProps) {
  const [columns, setColumns] = useState<Column[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ nome: "", tipo: "individual", icone: "", cor: "#6366F1" });
  const [showNewForm, setShowNewForm] = useState(false);
  const [newForm, setNewForm] = useState({ nome: "", tipo: "individual", icone: "search", cor: "#6366F1" });

  useEffect(() => {
    if (open) {
      fetchColumns();
    }
  }, [open]);

  const fetchColumns = async () => {
    try {
      const { data, error } = await supabase
        .from("task_flow_columns")
        .select("*")
        .order("ordem");

      if (error) throw error;
      setColumns(data || []);
    } catch (error) {
      console.error("Erro ao carregar colunas:", error);
      toast.error("Erro ao carregar colunas");
    } finally {
      setLoading(false);
    }
  };

  const handleStartEdit = (column: Column) => {
    setEditingId(column.id);
    setEditForm({
      nome: column.nome,
      tipo: column.tipo,
      icone: column.icone || "",
      cor: column.cor || "#6366F1",
    });
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editForm.nome.trim()) return;

    try {
      const { error } = await supabase
        .from("task_flow_columns")
        .update({
          nome: editForm.nome.trim(),
          tipo: editForm.tipo,
          icone: editForm.icone || null,
          cor: editForm.cor || null,
        })
        .eq("id", editingId);

      if (error) throw error;

      toast.success("Coluna atualizada!");
      setEditingId(null);
      fetchColumns();
    } catch (error) {
      console.error("Erro ao atualizar coluna:", error);
      toast.error("Erro ao atualizar coluna");
    }
  };

  const handleCreateColumn = async () => {
    if (!newForm.nome.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }

    try {
      const maxOrdem = Math.max(...columns.map(c => c.ordem), -1);
      
      const { error } = await supabase
        .from("task_flow_columns")
        .insert({
          nome: newForm.nome.trim(),
          tipo: newForm.tipo,
          icone: newForm.icone || null,
          cor: newForm.cor || null,
          ordem: maxOrdem + 1,
        });

      if (error) throw error;

      toast.success("Coluna criada!");
      setShowNewForm(false);
      setNewForm({ nome: "", tipo: "individual", icone: "search", cor: "#6366F1" });
      fetchColumns();
    } catch (error) {
      console.error("Erro ao criar coluna:", error);
      toast.error("Erro ao criar coluna");
    }
  };

  const handleDeleteColumn = async (columnId: string) => {
    if (!confirm("Tem certeza? Todas as tarefas nesta coluna serão perdidas.")) return;

    try {
      const { error } = await supabase
        .from("task_flow_columns")
        .delete()
        .eq("id", columnId);

      if (error) throw error;

      toast.success("Coluna removida!");
      fetchColumns();
    } catch (error) {
      console.error("Erro ao remover coluna:", error);
      toast.error("Erro ao remover coluna");
    }
  };

  const handleMoveColumn = async (columnId: string, direction: "up" | "down") => {
    const index = columns.findIndex(c => c.id === columnId);
    if (
      (direction === "up" && index === 0) ||
      (direction === "down" && index === columns.length - 1)
    ) return;

    const swapIndex = direction === "up" ? index - 1 : index + 1;
    const currentColumn = columns[index];
    const swapColumn = columns[swapIndex];

    try {
      await supabase
        .from("task_flow_columns")
        .update({ ordem: swapColumn.ordem })
        .eq("id", currentColumn.id);

      await supabase
        .from("task_flow_columns")
        .update({ ordem: currentColumn.ordem })
        .eq("id", swapColumn.id);

      fetchColumns();
    } catch (error) {
      console.error("Erro ao reordenar:", error);
    }
  };

  const getIconComponent = (iconName: string | null) => {
    const iconData = availableIcons.find(i => i.value === iconName);
    return iconData?.icon || Columns;
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-none w-[min(1100px,95vw)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Columns className="h-5 w-5" />
            Configurar Colunas do Kanban
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-2 pr-4">
              {columns.map((column, index) => {
                const IconComponent = getIconComponent(column.icone);
                const isEditing = editingId === column.id;

                return (
                  <div
                    key={column.id}
                    className="flex items-center gap-2 p-3 rounded-lg border-l-4"
                    style={{ 
                      backgroundColor: `${column.cor || '#6366F1'}15`,
                      borderLeftColor: column.cor || '#6366F1'
                    }}
                  >
                    {/* Drag handle e ordem */}
                    <div className="flex flex-col gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={() => handleMoveColumn(column.id, "up")}
                        disabled={index === 0}
                      >
                        ▲
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={() => handleMoveColumn(column.id, "down")}
                        disabled={index === columns.length - 1}
                      >
                        ▼
                      </Button>
                    </div>

                    {/* Ícone */}
                    <div className="w-8 h-8 flex items-center justify-center">
                      <IconComponent className="h-4 w-4 text-muted-foreground" />
                    </div>

                    {isEditing ? (
                      /* Formulário de edição inline */
                      <div className="flex-1 flex flex-wrap items-center gap-2">
                        <Input
                          value={editForm.nome}
                          onChange={(e) => setEditForm({ ...editForm, nome: e.target.value })}
                          className="flex-1 min-w-[260px]"
                        />
                        <Select
                          value={editForm.tipo}
                          onValueChange={(v) => setEditForm({ ...editForm, tipo: v })}
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="shared">Compartilhada</SelectItem>
                            <SelectItem value="individual">Individual</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select
                          value={editForm.icone}
                          onValueChange={(v) => setEditForm({ ...editForm, icone: v })}
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue placeholder="Ícone" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableIcons.map(icon => (
                              <SelectItem key={icon.value} value={icon.value}>
                                <div className="flex items-center gap-2">
                                  <icon.icon className="h-4 w-4" />
                                  {icon.label}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={editForm.cor}
                          onValueChange={(v) => setEditForm({ ...editForm, cor: v })}
                        >
                          <SelectTrigger className="w-28">
                            <div className="flex items-center gap-2">
                              <div 
                                className="w-4 h-4 rounded-full" 
                                style={{ backgroundColor: editForm.cor }}
                              />
                              <span className="text-xs">Cor</span>
                            </div>
                          </SelectTrigger>
                          <SelectContent>
                            {availableColors.map(color => (
                              <SelectItem key={color.value} value={color.value}>
                                <div className="flex items-center gap-2">
                                  <div 
                                    className="w-4 h-4 rounded-full" 
                                    style={{ backgroundColor: color.value }}
                                  />
                                  {color.label}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="icon" variant="ghost" onClick={handleSaveEdit}>
                          <Save className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setEditingId(null)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      /* Visualização normal */
                      <>
                        <div 
                          className="w-4 h-4 rounded-full flex-shrink-0" 
                          style={{ backgroundColor: column.cor || '#6366F1' }}
                        />
                        <div className="flex-1">
                          <span className="font-medium">{column.nome}</span>
                        </div>
                        <Badge variant={column.tipo === "shared" ? "default" : "outline"}>
                          {column.tipo === "shared" ? "Compartilhada" : "Individual"}
                        </Badge>
                        <Button size="icon" variant="ghost" onClick={() => handleStartEdit(column)}>
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => handleDeleteColumn(column.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}

              {/* Formulário para nova coluna */}
              {showNewForm ? (
                <div className="flex flex-wrap items-center gap-2 p-3 bg-primary/10 rounded-lg border-2 border-dashed border-primary">
                  <Input
                    value={newForm.nome}
                    onChange={(e) => setNewForm({ ...newForm, nome: e.target.value })}
                    placeholder="Nome da coluna..."
                    className="flex-1 min-w-[260px]"
                  />
                  <Select
                    value={newForm.tipo}
                    onValueChange={(v) => setNewForm({ ...newForm, tipo: v })}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="shared">Compartilhada</SelectItem>
                      <SelectItem value="individual">Individual</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={newForm.icone}
                    onValueChange={(v) => setNewForm({ ...newForm, icone: v })}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue placeholder="Ícone" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableIcons.map(icon => (
                        <SelectItem key={icon.value} value={icon.value}>
                          <div className="flex items-center gap-2">
                            <icon.icon className="h-4 w-4" />
                            {icon.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={newForm.cor}
                    onValueChange={(v) => setNewForm({ ...newForm, cor: v })}
                  >
                    <SelectTrigger className="w-28">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-4 h-4 rounded-full" 
                          style={{ backgroundColor: newForm.cor }}
                        />
                        <span className="text-xs">Cor</span>
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      {availableColors.map(color => (
                        <SelectItem key={color.value} value={color.value}>
                          <div className="flex items-center gap-2">
                            <div 
                              className="w-4 h-4 rounded-full" 
                              style={{ backgroundColor: color.value }}
                            />
                            {color.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={handleCreateColumn}>
                    Criar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowNewForm(false)}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setShowNewForm(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Adicionar Nova Coluna
                </Button>
              )}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <p className="text-xs text-muted-foreground flex-1">
            As alterações afetam todos os boards do Task-Flow.
          </p>
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
