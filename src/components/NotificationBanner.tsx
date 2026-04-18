import { CheckCircle2, XCircle, AlertCircle, X, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export type NotificationType = "success" | "error" | "warning" | "loading";

interface NotificationBannerProps {
  type: NotificationType;
  message: string;
  onClose?: () => void;
  onRetry?: () => void;
}

export function NotificationBanner({ type, message, onClose, onRetry }: NotificationBannerProps) {
  const icons = {
    success: CheckCircle2,
    error: XCircle,
    warning: AlertCircle,
    loading: RefreshCw,
  };

  const colors = {
    success: "bg-green-500 border-green-600",
    error: "bg-red-500 border-red-600",
    warning: "bg-yellow-500 border-yellow-600",
    loading: "bg-blue-500 border-blue-600",
  };

  const Icon = icons[type];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-end">
      {/* Metade direita com o overlay */}
      <div className="w-1/2 h-full bg-black/60 backdrop-blur-sm flex items-center justify-center p-8">
        <div 
          className={`
            ${colors[type]} 
            border-4 rounded-2xl shadow-2xl 
            w-full max-w-md p-8 text-white 
            animate-in zoom-in-95 duration-300
          `}
        >
          <div className="flex items-start gap-4">
            <Icon 
              className={`
                w-12 h-12 flex-shrink-0 
                ${type === 'loading' ? 'animate-spin' : ''}
              `} 
            />
            <div className="flex-1">
              <p className="text-2xl font-bold leading-tight">{message}</p>
            </div>
          </div>

          {(onClose || onRetry) && (
            <div className="flex gap-3 mt-6">
              {onRetry && (
                <Button
                  onClick={onRetry}
                  variant="secondary"
                  size="lg"
                  className="flex-1 text-lg font-semibold"
                >
                  Tentar Novamente
                </Button>
              )}
              {onClose && (
                <Button
                  onClick={onClose}
                  variant="outline"
                  size="lg"
                  className={`
                    ${onRetry ? '' : 'flex-1'} 
                    text-lg font-semibold bg-white/20 hover:bg-white/30 
                    border-white/50 text-white hover:text-white
                  `}
                >
                  <X className="w-5 h-5 mr-2" />
                  Fechar
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
