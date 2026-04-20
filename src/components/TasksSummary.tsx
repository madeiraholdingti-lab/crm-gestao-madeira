import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Clock, AlertCircle, ListTodo } from "lucide-react";
import { format, isToday, isTomorrow, isPast } from "date-fns";
import { ptBR } from "date-fns/locale";
import { TasksModal } from "./TasksModal";
import { useNavigate } from "react-router-dom";

type FilterType = "all" | "today" | "tomorrow" | "overdue" | "completed_today";

interface Task {
  id: string;
  titulo: string;
  prazo: string | null;
  column_id: string;
  updated_at: string;
  task_flow_columns: {
    nome: string;
    cor: string;
  } | null;
}

export const TasksSummary = () => {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalFilter, setModalFilter] = useState<FilterType>("all");
  const [modalTitle, setModalTitle] = useState("");
  const navigate = useNavigate();

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["tasks-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_flow_tasks")
        .select(`
          id, 
          titulo, 
          prazo, 
          column_id,
          updated_at,
          task_flow_columns(nome, cor)
        `)
        .is("deleted_at", null)
        .order("prazo", { ascending: true });
      
      if (error) throw error;
      return (data || []) as Task[];
    },
  });

  // Filtrar tarefas
  const filterTasks = (filter: FilterType): Task[] => {
    if (!tasks) return [];
    
    switch (filter) {
      case "today":
        return tasks.filter(t => t.prazo && isToday(new Date(t.prazo)) && t.task_flow_columns?.nome !== "Finalizada");
      case "tomorrow":
        return tasks.filter(t => t.prazo && isTomorrow(new Date(t.prazo)) && t.task_flow_columns?.nome !== "Finalizada");
      case "overdue":
        return tasks.filter(t => t.prazo && isPast(new Date(t.prazo)) && !isToday(new Date(t.prazo)) && t.task_flow_columns?.nome !== "Finalizada");
      case "completed_today":
        return tasks.filter(t => t.task_flow_columns?.nome === "Finalizada" && isToday(new Date(t.updated_at)));
      default:
        return tasks;
    }
  };

  // Calcular métricas
  const tarefasRealizadasHoje = filterTasks("completed_today").length;
  const tarefasAtrasadas = filterTasks("overdue").length;
  const tarefasHoje = filterTasks("today").length;
  const tarefasAmanha = filterTasks("tomorrow").length;

  const handleCardClick = (filter: FilterType, title: string) => {
    setModalFilter(filter);
    setModalTitle(title);
    setModalOpen(true);
  };

  const handleTaskClick = (taskId: string) => {
    navigate(`/task-flow?task=${taskId}`);
  };

  const metrics = [
    {
      title: "Realizadas Hoje",
      value: tarefasRealizadasHoje,
      icon: CheckCircle2,
      color: "text-green-600",
      bgColor: "bg-green-50",
      hoverBgColor: "hover:bg-green-100",
      filter: "completed_today" as FilterType,
    },
    {
      title: "Vencendo Hoje",
      value: tarefasHoje,
      icon: Clock,
      color: "text-amber-600",
      bgColor: "bg-amber-50",
      hoverBgColor: "hover:bg-amber-100",
      filter: "today" as FilterType,
    },
    {
      title: "Vencendo Amanhã",
      value: tarefasAmanha,
      icon: ListTodo,
      color: "text-blue-600",
      bgColor: "bg-blue-50",
      hoverBgColor: "hover:bg-blue-100",
      filter: "tomorrow" as FilterType,
    },
    {
      title: "Atrasadas",
      value: tarefasAtrasadas,
      icon: AlertCircle,
      color: "text-red-600",
      bgColor: "bg-red-50",
      hoverBgColor: "hover:bg-red-100",
      filter: "overdue" as FilterType,
    },
  ];

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="bg-gradient-to-r from-amber-500/10 to-amber-500/5 border-b py-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListTodo className="h-4 w-4 text-amber-600" />
            Tarefas
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="h-full overflow-hidden shadow-sm flex flex-col">
        <CardHeader className="bg-gradient-to-r from-amber-500/10 to-amber-500/5 border-b py-3 flex-shrink-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListTodo className="h-4 w-4 text-amber-600" />
            Tarefas
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 flex-1 overflow-hidden flex flex-col min-h-0">
          {/* Grid de métricas clicáveis */}
          <div className="grid grid-cols-4 gap-2 mb-3 flex-shrink-0">
            {metrics.map((metric, index) => (
              <div
                key={index}
                onClick={() => handleCardClick(metric.filter, metric.title)}
                className={`${metric.bgColor} ${metric.hoverBgColor} rounded-lg p-2 flex flex-col items-center justify-center text-center cursor-pointer transition-all hover:scale-105 hover:shadow-md`}
              >
                <metric.icon className={`h-4 w-4 ${metric.color} mb-1`} />
                <p className="text-lg font-bold text-foreground">{metric.value}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">{metric.title}</p>
              </div>
            ))}
          </div>

          {/* Lista de tarefas próximas */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <h4 className="text-xs font-medium text-muted-foreground mb-2 flex-shrink-0">Próximas tarefas</h4>
                {tasks && tasks.filter(t => t.task_flow_columns?.nome !== "Finalizada").length > 0 ? (
              <div className="space-y-1.5 flex-1 overflow-y-auto min-h-0">
                {tasks
                  .filter(t => t.task_flow_columns?.nome !== "Finalizada")
                  .slice(0, 5)
                  .map((task) => {
                    const isFinalizada = task.task_flow_columns?.nome === "Finalizada";
                    const prazoDate = task.prazo ? new Date(task.prazo) : null;
                    const isOverdue = prazoDate && isPast(prazoDate) && !isToday(prazoDate) && !isFinalizada;
                    const isDueToday = prazoDate && isToday(prazoDate) && !isFinalizada;

                    return (
                      <div
                        key={task.id}
                        onClick={() => handleTaskClick(task.id)}
                        className="flex items-center justify-between p-2 rounded-lg border border-border bg-card hover:bg-accent/50 hover:border-primary/30 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: task.task_flow_columns?.cor || '#6b7280' }}
                          />
                          <span className="text-xs font-medium text-foreground truncate max-w-[180px]">
                            {task.titulo}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {task.prazo && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                              isOverdue
                                ? 'bg-red-100 text-red-700' 
                                : isDueToday
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-muted text-muted-foreground'
                            }`}>
                              {format(new Date(task.prazo), "dd/MM", { locale: ptBR })}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground">
                            {task.task_flow_columns?.nome}
                          </span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div className="text-center py-6 px-3">
                <div className="font-serif-display text-sm font-medium text-mh-ink mb-1">
                  Lista em dia
                </div>
                <p className="text-[11px] text-mh-ink-3 leading-snug">
                  Nenhuma tarefa nesse filtro.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <TasksModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={modalTitle}
        tasks={filterTasks(modalFilter)}
      />
    </>
  );
};
