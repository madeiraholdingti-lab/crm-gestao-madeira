import { useDroppable } from "@dnd-kit/core";
import { TaskFlowCard } from "./TaskFlowCard";
import { TaskFlowTask } from "./TaskFlowBoard";
import { Button } from "@/components/ui/button";

import { Bot, Clock, CheckCircle, Search, Wrench, HandHelping, UserCheck, Plus, Bell, Columns } from "lucide-react";

interface TaskFlowProfile {
  id: string;
  nome: string;
  avatar_url: string | null;
  cor: string;
}

interface Column {
  id: string;
  nome: string;
  tipo: string;
  ordem: number;
  icone: string | null;
  cor: string | null;
}

interface TaskFlowColumnProps {
  column: Column;
  tasks: TaskFlowTask[];
  selectedProfile: TaskFlowProfile;
  allProfiles: TaskFlowProfile[];
  onTaskClick: (task: TaskFlowTask) => void;
  onAddTask: () => void;
}

const iconMap: Record<string, React.ElementType> = {
  bot: Bot,
  clock: Clock,
  "check-circle": CheckCircle,
  search: Search,
  wrench: Wrench,
  "hand-helping": HandHelping,
  "user-check": UserCheck,
  bell: Bell,
};

export function TaskFlowColumn({
  column,
  tasks,
  selectedProfile,
  allProfiles,
  onTaskClick,
  onAddTask,
}: TaskFlowColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
  });

  const IconComponent = column.icone ? iconMap[column.icone] : null;
  const isShared = column.tipo === "shared";
  const isInbox = column.nome === "Caixa de Entrada";

  const columnColor = column.cor || "#6366F1";
  
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col flex-1 min-w-[260px] max-w-[320px] bg-card rounded-lg border-2 h-full min-h-0 ${
        isOver ? "ring-2 ring-primary" : ""
      }`}
      style={{ borderColor: columnColor }}
    >
      {/* Header da coluna */}
      <div
        className="p-2 border-b rounded-t-lg flex items-center justify-between h-12"
        style={{ backgroundColor: `${columnColor}20` }}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {IconComponent && (
            <IconComponent
              className="h-4 w-4 flex-shrink-0"
              style={{ color: columnColor }}
            />
          )}
          <h3 className="font-semibold text-xs truncate">{column.nome}</h3>
          <span 
            className="text-[10px] px-1.5 py-0.5 rounded-full text-white flex-shrink-0"
            style={{ backgroundColor: columnColor }}
          >
            {tasks.length}
          </span>
        </div>
        {isShared && (
          <span 
            className="text-[10px] uppercase tracking-wider font-medium flex-shrink-0 ml-1"
            style={{ color: columnColor }}
          >
            Todos
          </span>
        )}
      </div>

      {/* Lista de cards */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="space-y-2 p-2">
          {tasks.map(task => (
            <TaskFlowCard
              key={task.id}
              task={task}
              selectedProfile={selectedProfile}
              allProfiles={allProfiles}
              columnName={column.nome}
              onClick={() => onTaskClick(task)}
            />
          ))}

          {tasks.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Nenhuma tarefa
            </div>
          )}
        </div>
      </div>

      {/* Botão adicionar */}
      <div className="p-2 border-t">
        <Button
          variant="ghost"
          className="w-full justify-start text-muted-foreground"
          onClick={onAddTask}
        >
          <Plus className="h-4 w-4 mr-2" />
          Adicionar tarefa
        </Button>
      </div>
    </div>
  );
}
