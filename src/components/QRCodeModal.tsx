import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, AlertCircle } from "lucide-react";

export type QRCodeStatus = "loading" | "waiting" | "success" | "error" | "timeout";

interface QRCodeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  qrCodeBase64: string | null;
  instanceName: string;
  status?: QRCodeStatus;
  statusMessage?: string;
  onRetry?: () => void;
}

export function QRCodeModal({ 
  open, 
  onOpenChange, 
  qrCodeBase64, 
  instanceName,
  status = "loading",
  statusMessage,
  onRetry
}: QRCodeModalProps) {
  const getStatusIcon = () => {
    switch (status) {
      case "loading":
      case "waiting":
        return <Loader2 className="h-5 w-5 animate-spin" />;
      case "success":
        return <CheckCircle2 className="h-5 w-5" />;
      case "error":
      case "timeout":
        return <XCircle className="h-5 w-5" />;
      default:
        return null;
    }
  };

  const getAlertVariant = () => {
    switch (status) {
      case "success":
        return "default";
      case "error":
      case "timeout":
        return "destructive";
      default:
        return "default";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px] max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>Conectar WhatsApp - {instanceName}</DialogTitle>
        </DialogHeader>
        
        <div className="flex flex-col items-center justify-center space-y-4">
          {/* Status Alert */}
          {statusMessage && (
            <Alert variant={getAlertVariant()} className="w-full">
              <div className="flex items-start gap-3">
                {getStatusIcon()}
                <AlertDescription className="flex-1">
                  {statusMessage}
                </AlertDescription>
              </div>
            </Alert>
          )}

          {/* QR Code */}
          {qrCodeBase64 ? (
            <>
              <div className="bg-white p-4 rounded-lg">
                <img 
                  src={qrCodeBase64} 
                  alt="QR Code" 
                  className="w-64 h-64"
                />
              </div>
              <div className="text-center space-y-2 text-sm text-muted-foreground">
                <p>1. Abra o WhatsApp no seu telefone</p>
                <p>2. Toque em <strong>Menu</strong> ou <strong>Configurações</strong></p>
                <p>3. Toque em <strong>Aparelhos conectados</strong> e depois em <strong>Conectar um aparelho</strong></p>
                <p>4. Aponte seu telefone para esta tela para capturar o código</p>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Gerando QR Code...</p>
            </div>
          )}

          {/* Retry Button */}
          {(status === "error" || status === "timeout") && onRetry && (
            <Button onClick={onRetry} variant="default" className="w-full">
              Tentar Novamente
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
