import { useState, useEffect, useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Archive, Star, Bell, ChevronLeft, ChevronRight, Zap } from "lucide-react";
import googleCalendarIcon from "@/assets/google-calendar-icon.png";
import { useOverlayApps } from "@/contexts/OverlayAppsContext";

interface AppItem {
  id: string;
  name: string;
  color: string;
  icon?: React.ElementType;
  customIcon?: string;
  disabled?: boolean;
}

interface ActionCircleOverlayProps {
  isDragging: boolean;
  onDropAction?: (appId: string, cardId: string) => void;
}

// Cores e ícones dos apps
const APP_VISUAL_CONFIG: Record<string, { color: string; icon?: React.ElementType; customIcon?: string }> = {
  calendar: { color: "#4285F4", customIcon: googleCalendarIcon },
  crm: { color: "#2563EB", icon: Zap },
  archive: { color: "#059669", icon: Archive },
  priority: { color: "#7C3AED", icon: Star },
  notify: { color: "#DC2626", icon: Bell },
};

// Componente para cada app droppable na barra horizontal
const DroppableApp = ({ 
  app, 
  index,
  isHovered,
  onHover
}: { 
  app: AppItem; 
  index: number;
  isHovered: boolean;
  onHover: (hovered: boolean) => void;
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `action-app-${app.id}`,
    data: { appId: app.id, appName: app.name },
    disabled: app.disabled
  });

  useEffect(() => {
    if (isOver && !app.disabled) {
      onHover(true);
    } else {
      onHover(false);
    }
  }, [isOver, onHover, app.disabled]);

  const isHighlighted = !app.disabled && (isOver || isHovered);
  const IconComponent = app.icon;

  return (
    <div
      ref={app.disabled ? undefined : setNodeRef}
      className={`flex flex-col items-center justify-center gap-2 px-4 py-3 rounded-xl transition-all duration-200 min-w-[80px] ${
        app.disabled 
          ? 'cursor-not-allowed opacity-60' 
          : isHighlighted 
            ? 'scale-110 shadow-lg cursor-pointer' 
            : 'hover:bg-gray-100 cursor-pointer'
      }`}
      style={{
        backgroundColor: isHighlighted ? app.color : 'transparent',
        animationDelay: `${index * 50}ms`,
        filter: app.disabled ? 'grayscale(100%)' : 'none',
      }}
      title={app.disabled ? `${app.name} (em breve)` : app.name}
    >
      <div
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 overflow-hidden ${
          isHighlighted ? 'bg-white/20' : ''
        }`}
        style={{ 
          backgroundColor: isHighlighted ? 'rgba(255,255,255,0.25)' : app.customIcon ? 'transparent' : app.disabled ? '#9CA3AF' : app.color,
        }}
      >
        {app.customIcon ? (
          <img 
            src={app.customIcon} 
            alt={app.name} 
            className={`w-10 h-10 object-contain rounded-lg ${app.disabled ? 'grayscale' : ''}`} 
          />
        ) : IconComponent ? (
          <IconComponent 
            className={`w-6 h-6 ${isHighlighted ? 'text-white' : 'text-white'}`} 
            strokeWidth={2} 
          />
        ) : null}
      </div>
      <span className={`text-xs font-medium whitespace-nowrap transition-colors duration-200 ${
        isHighlighted ? 'text-white' : app.disabled ? 'text-gray-400' : 'text-gray-700'
      }`}>
        {app.name}
      </span>
    </div>
  );
};

// Zona de detecção no topo da tela para acionar expansão
const TopDetectionZone = ({ 
  onEnter 
}: { 
  onEnter: (entering: boolean) => void;
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: 'action-circle-zone',
    data: { type: 'toolbar-zone' }
  });

  useEffect(() => {
    onEnter(isOver);
  }, [isOver, onEnter]);

  return (
    <div
      ref={setNodeRef}
      className="fixed z-[58] bg-transparent"
      style={{ 
        left: '0',
        right: '280px', // Não cobrir o overlay de instâncias
        top: '0',
        height: '80px',
        pointerEvents: 'auto',
      }}
    />
  );
};

export const ActionCircleOverlay = ({ 
  isDragging, 
  onDropAction 
}: ActionCircleOverlayProps) => {
  const { apps: configuredApps } = useOverlayApps();
  const [isExpanded, setIsExpanded] = useState(false);
  const [rotationOffset, setRotationOffset] = useState(0);
  const [hoveredAppId, setHoveredAppId] = useState<string | null>(null);

  // Combinar configurações do contexto com visuais
  const apps: AppItem[] = useMemo(() => {
    return configuredApps.map(configApp => {
      const visual = APP_VISUAL_CONFIG[configApp.id] || { color: "#6B7280" };
      return {
        id: configApp.id,
        name: configApp.name,
        color: visual.color,
        icon: visual.icon,
        customIcon: visual.customIcon,
        disabled: !configApp.enabled,
      };
    });
  }, [configuredApps]);

  // Número de apps visíveis por vez
  const visibleCount = 5;
  
  // Apps visíveis com base no offset de rotação
  const getVisibleApps = () => {
    const result: AppItem[] = [];
    for (let i = 0; i < Math.min(visibleCount, apps.length); i++) {
      const index = (rotationOffset + i) % apps.length;
      result.push(apps[index]);
    }
    return result;
  };

  const visibleApps = getVisibleApps();

  // Rotacionar para esquerda
  const rotatePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRotationOffset((prev) => (prev - 1 + apps.length) % apps.length);
  };

  // Rotacionar para direita
  const rotateNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRotationOffset((prev) => (prev + 1) % apps.length);
  };

  // Quando não está arrastando, resetar estado
  useEffect(() => {
    if (!isDragging) {
      setIsExpanded(false);
      setHoveredAppId(null);
    }
  }, [isDragging]);

  // Handler para quando o card entra/sai da zona da barra
  const handleToolbarZoneEnter = (entering: boolean) => {
    if (isDragging && entering) {
      setIsExpanded(true);
    }
  };

  if (!isDragging) return null;

  return (
    <>
      {/* Zona de detecção no topo da tela - sempre visível durante arraste */}
      <TopDetectionZone onEnter={handleToolbarZoneEnter} />

      {/* Barra de ferramentas horizontal */}
      <div 
        className={`fixed z-[60] transition-all duration-300 ease-out pointer-events-none ${
          isExpanded ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-8'
        }`}
        style={{ 
          left: '50%',
          transform: 'translateX(-70%)',
          top: '16px',
        }}
      >
        {/* Container da barra */}
        <div 
          className="relative bg-white rounded-2xl shadow-2xl border border-gray-200 p-3 pointer-events-auto"
          style={{
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.05)',
          }}
        >
          <div className="flex items-center gap-1">
            {/* Botão anterior se necessário */}
            {apps.length > visibleCount && (
              <button
                onClick={rotatePrev}
                className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                title="Anterior"
              >
                <ChevronLeft className="w-4 h-4 text-gray-600" strokeWidth={2.5} />
              </button>
            )}

            {/* Apps na barra horizontal */}
            <div className="flex items-center gap-1 px-2">
              {visibleApps.map((app, idx) => (
                <DroppableApp
                  key={`${app.id}-${rotationOffset}`}
                  app={app}
                  index={idx}
                  isHovered={hoveredAppId === app.id}
                  onHover={(hovered) => setHoveredAppId(hovered ? app.id : null)}
                />
              ))}
            </div>

            {/* Botão próximo se necessário */}
            {apps.length > visibleCount && (
              <button
                onClick={rotateNext}
                className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                title="Próximo"
              >
                <ChevronRight className="w-4 h-4 text-gray-600" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Indicador no topo quando ainda não expandiu */}
      {!isExpanded && (
        <div 
          className="fixed z-[59] left-1/2 -translate-x-1/2 top-2 px-4 py-2 bg-black/60 text-white text-sm rounded-full backdrop-blur-sm"
          style={{ transform: 'translateX(-70%)' }}
        >
          ↑ Arraste para cima para ações
        </div>
      )}
    </>
  );
};
