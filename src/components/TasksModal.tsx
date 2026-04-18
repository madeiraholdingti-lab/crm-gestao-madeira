import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { format, isPast, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useNavigate } from "react-router-dom";

interface Task {
  id: string;
  titulo: string;
  prazo: string | null;
  task_flow_columns: {
    nome: string;
    cor: string;
  } | null;
}

interface TasksModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  tasks: Task[];
}

export const TasksModal = ({ open, onOpenChange, title, tasks }: TasksModalProps) => {
  const navigate = useNavigate();

  const handleGoToTask = (taskId: string) => {
    onOpenChange(false);
    navigate(`/task-flow?task=${taskId}`);
  };

  const handleGoToTaskFlow = () => {
    onOpenChange(false);
    navigate("/task-flow");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle>{title}</DialogTitle>
            <Button variant="outline" size="sm" onClick={handleGoToTaskFlow}>
              <ExternalLink className="h-4 w-4 mr-2" />
              Ir para TaskFlow
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto mt-4">
          {tasks.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              Nenhuma tarefa encontrada
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="border border-border rounded-lg p-4 bg-card hover:bg-accent/50 hover:border-primary/30 transition-all cursor-pointer group"
                  onClick={() => handleGoToTask(task.id)}
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div 
                      className="w-3 h-3 rounded-full flex-shrink-0 mt-1"
                      style={{ backgroundColor: task.task_flow_columns?.cor || '#6b7280' }}
                    />
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                      {task.task_flow_columns?.nome || "Sem coluna"}
                    </span>
                  </div>
                  
                  <h4 className="font-medium text-foreground text-sm mb-3 line-clamp-2">
                    {task.titulo}
                  </h4>
                  
                  <div className="flex items-center justify-between">
                    {task.prazo ? (
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        isPast(new Date(task.prazo)) 
                          ? 'bg-red-100 text-red-700' 
                          : isToday(new Date(task.prazo))
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-muted text-muted-foreground'
                      }`}>
                        {format(new Date(task.prazo), "dd/MM/yyyy", { locale: ptBR })}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Sem prazo</span>
                    )}
                    
                    <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
