import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TaskFlowColumn } from "./TaskFlowColumn";
import { TaskFlowCardModal } from "./TaskFlowCardModal";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, closestCorners, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { TaskFlowCard } from "./TaskFlowCard";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface TaskFlowProfile {
  id: string;
  nome: string;
  avatar_url: string | null;
  cor: string;
  ativo: boolean;
}

interface TaskFlowColumn {
  id: string;
  nome: string;
  tipo: string;
  ordem: number;
  icone: string | null;
  cor: string | null;
}

export interface TaskFlowTask {
  id: string;
  titulo: string;
  descricao: string | null;
  resumo: string | null;
  column_id: string;
  responsavel_id: string | null;
  criado_por_id: string | null;
  data_retorno: string | null;
  prazo: string | null;
  audio_url: string | null;
  ordem: number;
  origem: string;
  created_at: string;
  updated_at: string;
  responsavel?: { id: string; nome: string; avatar_url: string | null; cor: string } | null;
  tags?: Array<{ id: string; nome: string; cor: string }>;
}

interface TaskFlowBoardProps {
  selectedProfile: TaskFlowProfile;
  allProfiles: TaskFlowProfile[];
  initialTaskId?: string | null;
}

export function TaskFlowBoard({ selectedProfile, allProfiles, initialTaskId }: TaskFlowBoardProps) {
  const [columns, setColumns] = useState<TaskFlowColumn[]>([]);
  const [tasks, setTasks] = useState<TaskFlowTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTask, setActiveTask] = useState<TaskFlowTask | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskFlowTask | null>(null);
  const [showNewTaskDialog, setShowNewTaskDialog] = useState(false);
  const [newTaskColumnId, setNewTaskColumnId] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [currentUserProfile, setCurrentUserProfile] = useState<TaskFlowProfile | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

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
            ativo: true,
          });
        }
      } catch (error) {
        console.error("Erro ao buscar usuário:", error);
      }
    };
    
    fetchCurrentUser();
  }, []);

  useEffect(() => {
    fetchData();
  }, [selectedProfile.id]);

  // Realtime: subscription única, isolada do fetchData pra evitar re-subscribe.
  useEffect(() => {
    const channel = supabase
      .channel(`task_flow_tasks_changes_${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "task_flow_tasks" },
        () => {
          fetchData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Abrir tarefa automaticamente se initialTaskId for passado
  useEffect(() => {
    if (initialTaskId && tasks.length > 0 && !selectedTask) {
      const task = tasks.find(t => t.id === initialTaskId);
      if (task) {
        setSelectedTask(task);
      }
    }
  }, [initialTaskId, tasks]);

  const fetchData = async () => {
    try {
      // Buscar colunas
      const { data: columnsData, error: columnsError } = await supabase
        .from("task_flow_columns")
        .select("*")
        .order("ordem");

      if (columnsError) throw columnsError;

      // Buscar tarefas com responsável
      const { data: tasksData, error: tasksError } = await supabase
        .from("task_flow_tasks")
        .select(`
          *,
          responsavel:task_flow_profiles!task_flow_tasks_responsavel_id_fkey(id, nome, avatar_url, cor)
        `)
        .is("deleted_at", null)
        .order("ordem");

      if (tasksError) throw tasksError;

      // Buscar tags das tarefas
      const taskIds = tasksData?.map(t => t.id) || [];
      if (taskIds.length > 0) {
        const { data: taskTagsData } = await supabase
          .from("task_flow_task_tags")
          .select(`
            task_id,
            tag:task_flow_tags(id, nome, cor)
          `)
          .in("task_id", taskIds);

        // Mapear tags para as tarefas
        const tasksWithTags = tasksData?.map(task => ({
          ...task,
          tags: taskTagsData
            ?.filter(tt => tt.task_id === task.id)
            .map(tt => tt.tag)
            .filter(Boolean) || []
        }));

        setTasks(tasksWithTags || []);
      } else {
        setTasks(tasksData || []);
      }

      setColumns(columnsData || []);
    } catch (error) {
      console.error("Erro ao carregar dados:", error);
      toast.error("Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  };

  const setupRealtimeSubscription = () => {
    const channel = supabase
      .channel("task_flow_tasks_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "task_flow_tasks" },
        () => {
          fetchData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find(t => t.id === event.active.id);
    setActiveTask(task || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) return;

    const taskId = active.id as string;
    const targetColumnId = over.id as string;

    const task = tasks.find(t => t.id === taskId);
    if (!task || task.column_id === targetColumnId) return;

    const targetColumn = columns.find(c => c.id === targetColumnId);
    if (!targetColumn) return;

    // Atualizar localmente primeiro
    setTasks(prev =>
      prev.map(t =>
        t.id === taskId
          ? { ...t, column_id: targetColumnId, responsavel_id: selectedProfile.id }
          : t
      )
    );

    try {
      // Atualizar no banco
      const { error } = await supabase
        .from("task_flow_tasks")
        .update({
          column_id: targetColumnId,
          responsavel_id: selectedProfile.id,
        })
        .eq("id", taskId);

      if (error) throw error;

      // Registrar no histórico
      const oldColumn = columns.find(c => c.id === task.column_id);
      await supabase.from("task_flow_history").insert({
        task_id: taskId,
        autor_id: currentUserProfile?.id || selectedProfile.id,
        tipo: "move",
        descricao: `Movido de "${oldColumn?.nome}" para "${targetColumn.nome}"`,
        valor_anterior: oldColumn?.nome,
        valor_novo: targetColumn.nome,
      });
    } catch (error) {
      console.error("Erro ao mover tarefa:", error);
      toast.error("Erro ao mover tarefa");
      fetchData();
    }
  };

  const handleOpenNewTask = (columnId: string) => {
    setNewTaskColumnId(columnId);
    setNewTaskTitle("");
    setNewTaskDescription("");
    setShowNewTaskDialog(true);
  };

  const handleCreateTask = async () => {
    if (!newTaskTitle.trim() || !newTaskColumnId) {
      toast.error("Título é obrigatório");
      return;
    }

    try {
      const { data, error } = await supabase
        .from("task_flow_tasks")
        .insert({
          titulo: newTaskTitle.trim(),
          descricao: newTaskDescription.trim() || null,
          column_id: newTaskColumnId,
          responsavel_id: selectedProfile.id,
          criado_por_id: currentUserProfile?.id || selectedProfile.id,
          origem: "manual",
        })
        .select()
        .single();

      if (error) throw error;

      // Registrar no histórico
      await supabase.from("task_flow_history").insert({
        task_id: data.id,
        autor_id: currentUserProfile?.id || selectedProfile.id,
        tipo: "create",
        descricao: "Tarefa criada manualmente",
      });

      setShowNewTaskDialog(false);
      toast.success("Tarefa criada!");
      fetchData();
    } catch (error) {
      console.error("Erro ao criar tarefa:", error);
      toast.error("Erro ao criar tarefa");
    }
  };

  const getTasksForColumn = (columnId: string, columnType: string) => {
    const filteredTasks = tasks.filter(task => {
      if (task.column_id !== columnId) return false;

      // Colunas compartilhadas mostram todas as tarefas
      if (columnType === "shared") return true;

      // Colunas individuais mostram apenas tarefas do perfil selecionado
      return task.responsavel_id === selectedProfile.id;
    });

    // Ordenar por prazo (tarefas com prazo primeiro, ordenadas por data/hora)
    return filteredTasks.sort((a, b) => {
      // Tarefas com prazo vêm primeiro
      if (a.prazo && !b.prazo) return -1;
      if (!a.prazo && b.prazo) return 1;
      
      // Se ambas têm prazo, ordenar por data/hora
      if (a.prazo && b.prazo) {
        return new Date(a.prazo).getTime() - new Date(b.prazo).getTime();
      }
      
      // Se nenhuma tem prazo, manter ordem original (por created_at)
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="h-full w-full overflow-x-auto overflow-y-hidden p-4">
          <div className="flex gap-4 h-full min-h-0">
            {columns.map(column => (
              <TaskFlowColumn
                key={column.id}
                column={column}
                tasks={getTasksForColumn(column.id, column.tipo)}
                selectedProfile={selectedProfile}
                allProfiles={allProfiles}
                onTaskClick={setSelectedTask}
                onAddTask={() => handleOpenNewTask(column.id)}
              />
            ))}
          </div>
        </div>

        <DragOverlay>
          {activeTask && (
            <TaskFlowCard
              task={activeTask}
              selectedProfile={selectedProfile}
              allProfiles={allProfiles}
              isDragging
            />
          )}
        </DragOverlay>
      </DndContext>

      {/* Modal de detalhes da tarefa */}
      {selectedTask && (
        <TaskFlowCardModal
          task={selectedTask}
          open={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          selectedProfile={selectedProfile}
          allProfiles={allProfiles}
          onUpdate={fetchData}
        />
      )}

      {/* Dialog para criar nova tarefa */}
      <Dialog open={showNewTaskDialog} onOpenChange={setShowNewTaskDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Tarefa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="titulo">Título</Label>
              <Input
                id="titulo"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                placeholder="Digite o título da tarefa..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="descricao">Descrição (opcional)</Label>
              <Textarea
                id="descricao"
                value={newTaskDescription}
                onChange={(e) => setNewTaskDescription(e.target.value)}
                placeholder="Descreva a tarefa..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewTaskDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateTask}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
