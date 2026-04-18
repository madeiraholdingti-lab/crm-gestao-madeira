import { useDroppable } from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ActionCircleOverlay } from "./ActionCircleOverlay";

interface InstanciaProps {
  id: string;
  instancia_id: string;
  nome_instancia: string;
  numero_chip?: string | null;
  cor_identificacao: string;
  ativo: boolean;
  status: 'ativa' | 'inativa' | 'deletada';
}

interface DragDropInstanceOverlayProps {
  instancias: InstanciaProps[];
  isDragging: boolean;
  onActionDrop?: (appId: string, cardId: string) => void;
}

const DroppableInstanceCard = ({ instancia }: { instancia: InstanciaProps }) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `instance-${instancia.id}`,
    data: { instanciaId: instancia.id }
  });

  return (
    <Card
      ref={setNodeRef}
      className={`p-3 cursor-pointer transition-all border-2 ${
        isOver 
          ? 'border-white scale-105 shadow-2xl' 
          : 'border-transparent hover:border-white/50 hover:scale-102'
      }`}
      style={{
        backgroundColor: instancia.cor_identificacao || '#3B82F6',
        color: 'white',
      }}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm truncate">{instancia.nome_instancia}</h3>
            {instancia.numero_chip && (
              <p className="text-xs opacity-80 truncate">
                {instancia.numero_chip}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge 
            variant="outline"
            className="text-xs border-white/50 text-white bg-white/20"
          >
            {instancia.ativo ? 'Ativa' : 'Inativa'}
          </Badge>
          {isOver && (
            <Badge className="text-xs bg-white text-black">
              Soltar aqui
            </Badge>
          )}
        </div>
      </div>
    </Card>
  );
};

export const DragDropInstanceOverlay = ({ instancias, isDragging, onActionDrop }: DragDropInstanceOverlayProps) => {
  if (!isDragging) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Círculo de Ações no topo central */}
      <ActionCircleOverlay 
        isDragging={isDragging}
        onDropAction={onActionDrop}
      />
      
      {/* Barra lateral de instâncias (mantida exatamente igual) */}
      <div className="h-full w-[280px] bg-card/95 backdrop-blur-md border-l shadow-2xl p-4 overflow-y-auto">
        <div className="space-y-3">
          <div className="mb-4">
            <h2 className="text-lg font-bold mb-1">Transferir para</h2>
            <p className="text-xs text-muted-foreground">
              Arraste sobre uma instância
            </p>
          </div>
          
          <div className="space-y-2">
            {instancias.map((instancia) => (
              <DroppableInstanceCard key={instancia.id} instancia={instancia} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
