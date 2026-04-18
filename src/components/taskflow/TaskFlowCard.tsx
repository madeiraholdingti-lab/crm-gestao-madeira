import { useDraggable } from "@dnd-kit/core";
import { TaskFlowTask } from "./TaskFlowBoard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Clock, Bot, User, AlertCircle, Play, Pause, Calendar } from "lucide-react";
import { format, isPast, isToday, isTomorrow, differenceInHours } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useState, useRef, type MouseEvent } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";

interface TaskFlowProfile {
  id: string;
  nome: string;
  avatar_url: string | null;
  cor: string;
}

interface TaskFlowCardProps {
  task: TaskFlowTask;
  selectedProfile: TaskFlowProfile;
  allProfiles: TaskFlowProfile[];
  columnName?: string;
  onClick?: () => void;
  isDragging?: boolean;
}

// Player de áudio no mesmo "estilo" do SDRZap (play/pause + barra simples)
function AudioPlayer({ audioUrl }: { audioUrl: string }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const togglePlay = async (e: MouseEvent) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    try {
      await audio.play();
      setIsPlaying(true);
    } catch (err) {
      console.error("Failed to play audio:", err);
      setIsPlaying(false);
      toast.error("Não foi possível reproduzir este áudio. Abrindo para download...");
      window.open(audioUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleEnded = () => setIsPlaying(false);
  const handlePause = () => setIsPlaying(false);

  return (
    <div
      className="bg-primary rounded-lg p-2 flex items-center gap-2 min-w-[200px]"
      onClick={(e) => e.stopPropagation()}
    >
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="none"
        onEnded={handleEnded}
        onPause={handlePause}
        className="hidden"
      />

      <button
        type="button"
        onClick={togglePlay}
        className="w-10 h-10 rounded-full flex items-center justify-center bg-primary-foreground/20 hover:bg-primary-foreground/30 transition-colors"
        aria-label={isPlaying ? "Pausar áudio" : "Tocar áudio"}
      >
        {isPlaying ? (
          <Pause className="h-5 w-5 text-primary-foreground" />
        ) : (
          <Play className="h-5 w-5 text-primary-foreground ml-0.5" />
        )}
      </button>

      <div className="flex-1">
        <div className="h-1 bg-primary-foreground/40 rounded-full" />
        <p className="text-xs text-primary-foreground/70 mt-1">Áudio</p>
      </div>
    </div>
  );
}

export function TaskFlowCard({
  task,
  selectedProfile,
  allProfiles,
  columnName,
  onClick,
  isDragging,
}: TaskFlowCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: task.id,
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  const isFromBot = task.origem === "api" || task.origem === "ia";
  const hasReturnDate = !!task.data_retorno;
  const returnDatePast = hasReturnDate && isPast(new Date(task.data_retorno!));
  const returnDateToday = hasReturnDate && isToday(new Date(task.data_retorno!));
  
  // Prazo (deadline) display
  const hasPrazo = !!task.prazo;
  const prazoDate = hasPrazo ? new Date(task.prazo!) : null;
  const prazoPast = prazoDate && isPast(prazoDate) && !isToday(prazoDate);
  const prazoToday = prazoDate && isToday(prazoDate);
  const prazoTomorrow = prazoDate && isTomorrow(prazoDate);

  const responsavel = task.responsavel || allProfiles.find(p => p.id === task.responsavel_id);
  
  // Helper to get complexity badge color
  const getComplexityStyle = (tagName: string) => {
    if (tagName === "Baixa Complexidade") return { bg: "#22C55E", text: "#fff" };
    if (tagName === "Média Complexidade") return { bg: "#F59E0B", text: "#fff" };
    if (tagName === "Alta Complexidade") return { bg: "#EF4444", text: "#fff" };
    return null;
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`cursor-grab active:cursor-grabbing hover:shadow-md transition-all ${
        isDragging ? "opacity-50 shadow-lg rotate-2" : ""
      } ${returnDatePast ? "border-red-500" : returnDateToday ? "border-amber-500" : ""}`}
      onClick={onClick}
    >
      <CardContent className="p-3 space-y-2">
        {/* Tags e origem */}
        <div className="flex items-center gap-1 flex-wrap">
          {isFromBot && (
            <Badge variant="outline" className="text-[10px] h-5 gap-1 bg-blue-500/10 border-blue-500/30 text-blue-600">
              <Bot className="h-3 w-3" />
              Automação
            </Badge>
          )}
          {task.tags?.map(tag => (
            <Badge
              key={tag.id}
              className="text-[10px] h-5"
              style={{ backgroundColor: tag.cor, color: "#fff" }}
            >
              {tag.nome}
            </Badge>
          ))}
        </div>

        {/* Título */}
        <h4 className="font-medium text-sm line-clamp-2">{task.titulo}</h4>

        {/* Audio Player */}
        {task.audio_url && (
          <AudioPlayer audioUrl={task.audio_url} />
        )}

        {/* Descrição resumida */}
        {task.descricao && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            Descrição: {task.descricao}
          </p>
        )}

        {/* Data de retorno (destaque) */}
        {hasReturnDate && (
          <div
            className={`flex items-center gap-1 text-xs p-1.5 rounded ${
              returnDatePast
                ? "bg-red-500/10 text-red-600"
                : returnDateToday
                ? "bg-amber-500/10 text-amber-600"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {returnDatePast ? (
              <AlertCircle className="h-3 w-3" />
            ) : (
              <Clock className="h-3 w-3" />
            )}
            <span className="font-medium">
              Retorno: {format(new Date(task.data_retorno!), "dd/MM/yyyy", { locale: ptBR })}
            </span>
          </div>
        )}

        {/* Destaque de horário na coluna "Lembrar Dr. Maikon" */}
        {columnName?.toLowerCase().includes("lembrar") && hasPrazo && prazoDate && (
          <div
            className={`flex items-center gap-2 text-sm p-2 rounded-md font-semibold ${
              prazoPast
                ? "bg-red-500/15 text-red-700"
                : prazoDate && differenceInHours(prazoDate, new Date()) <= 2 && !prazoPast
                ? "bg-amber-500/15 text-amber-700 animate-pulse"
                : prazoToday
                ? "bg-amber-500/10 text-amber-600"
                : "bg-blue-500/10 text-blue-600"
            }`}
          >
            <Clock className="h-4 w-4" />
            <span>{format(prazoDate, "dd/MM 'às' HH:mm", { locale: ptBR })}</span>
            {prazoPast && <span className="text-xs font-normal">(atrasado)</span>}
            {prazoDate && differenceInHours(prazoDate, new Date()) <= 2 && differenceInHours(prazoDate, new Date()) >= 0 && !prazoPast && (
              <span className="text-xs font-normal">(em breve)</span>
            )}
          </div>
        )}

        {/* Footer: Responsável + Prazo */}
        <div className="flex items-center justify-between pt-1 border-t">
          {responsavel ? (
            <div className="flex items-center gap-1.5">
              <Avatar className="h-5 w-5">
                <AvatarImage src={responsavel.avatar_url || undefined} />
                <AvatarFallback
                  className="text-[10px] text-white"
                  style={{ backgroundColor: responsavel.cor }}
                >
                  {responsavel.nome.charAt(0)}
                </AvatarFallback>
              </Avatar>
              <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">
                {responsavel.nome}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <User className="h-4 w-4" />
              <span className="text-[10px]">Sem responsável</span>
            </div>
          )}

          {/* Mostrar prazo ao invés de data de criação */}
          {hasPrazo && prazoDate ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${
                    prazoPast
                      ? "bg-red-500/10 text-red-600 font-medium"
                      : prazoToday
                      ? "bg-amber-500/10 text-amber-600 font-medium"
                      : prazoTomorrow
                      ? "bg-blue-500/10 text-blue-600"
                      : "text-muted-foreground"
                  }`}
                >
                  <Calendar className="h-3 w-3" />
                  <span>{format(prazoDate, "dd/MM HH:mm", { locale: ptBR })}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Prazo: {format(prazoDate, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="text-[10px] text-muted-foreground">
              Sem prazo
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
