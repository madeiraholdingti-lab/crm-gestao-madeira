import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Calendar, AlertCircle, CheckCircle, RefreshCw, Plus } from "lucide-react";
import { CalendarModalStatus } from "@/hooks/useCalendarAction";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

interface CalendarConfirmModalProps {
  open: boolean;
  onClose: () => void;
  status: CalendarModalStatus;
  countdown: number;
  action: "create" | "update" | null;
  message: string | null;
  successMessage: string | null;
  evento: {
    inicio: string;
    fim: string;
    titulo: string;
    descricao: string;
  } | null;
  currentEvento: {
    inicio: string;
    fim: string;
  } | null;
  eventId: string | null;
  conflictMessage: string | null;
  errorMessage: string | null;
  onConfirm: (evento: { inicio: string; fim: string; titulo: string; descricao: string }) => void;
  onEventoChange: (updates: Partial<{ inicio: string; fim: string; titulo: string; descricao: string }>) => void;
}

export function CalendarConfirmModal({
  open,
  onClose,
  status,
  countdown,
  action,
  message,
  successMessage,
  evento,
  currentEvento,
  eventId,
  conflictMessage,
  errorMessage,
  onConfirm,
  onEventoChange,
}: CalendarConfirmModalProps) {
  const [localEvento, setLocalEvento] = useState(evento);

  useEffect(() => {
    if (evento) {
      setLocalEvento(evento);
    }
  }, [evento]);

  const handleDateChange = (field: 'inicio' | 'fim', dateStr: string) => {
    if (!localEvento) return;
    
    const currentDate = parseISO(localEvento[field]);
    const [year, month, day] = dateStr.split('-').map(Number);
    const newDate = new Date(currentDate);
    newDate.setFullYear(year, month - 1, day);
    
    const newValue = newDate.toISOString();
    setLocalEvento(prev => prev ? { ...prev, [field]: newValue } : null);
    onEventoChange({ [field]: newValue });
  };

  const handleTimeChange = (field: 'inicio' | 'fim', timeStr: string) => {
    if (!localEvento) return;
    
    const currentDate = parseISO(localEvento[field]);
    const [hours, minutes] = timeStr.split(':').map(Number);
    const newDate = new Date(currentDate);
    newDate.setHours(hours, minutes, 0, 0);
    
    const newValue = newDate.toISOString();
    setLocalEvento(prev => prev ? { ...prev, [field]: newValue } : null);
    onEventoChange({ [field]: newValue });
  };

  const formatDateForInput = (isoString: string) => {
    try {
      const date = parseISO(isoString);
      return format(date, 'yyyy-MM-dd');
    } catch {
      return '';
    }
  };

  const formatTimeForInput = (isoString: string) => {
    try {
      const date = parseISO(isoString);
      return format(date, 'HH:mm');
    } catch {
      return '';
    }
  };

  const formatDateTimeDisplay = (isoString: string) => {
    try {
      const date = parseISO(isoString);
      return format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
    } catch {
      return isoString;
    }
  };

  const handleConfirm = () => {
    if (localEvento) {
      onConfirm(localEvento);
    }
  };

  const isUpdate = action === "update";
  const isCreate = action === "create";

  const getModalTitle = () => {
    if (isUpdate) return "Ajustar Agendamento Existente";
    return "Novo Agendamento";
  };

  const getModalIcon = () => {
    if (isUpdate) {
      return <RefreshCw className="h-5 w-5 text-amber-600" />;
    }
    return <Plus className="h-5 w-5 text-primary" />;
  };

  const getIconBgClass = () => {
    if (isUpdate) return "bg-amber-100";
    return "bg-primary/10";
  };

  const getConfirmButtonText = () => {
    if (status === "confirming") {
      return (
        <>
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          Confirmando...
        </>
      );
    }
    if (isUpdate) return "Confirmar Alteração";
    return "Confirmar Criação";
  };

  const getSuccessMessage = () => {
    if (isUpdate) return "Agendamento Atualizado!";
    return "Agendamento Criado!";
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[500px] border-2">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center ${getIconBgClass()}`}>
              {status === "ready" || status === "confirming" ? getModalIcon() : (
                <Calendar className="h-5 w-5 text-primary" />
              )}
            </div>
            <span>{(status === "ready" || status === "confirming") ? getModalTitle() : "Agendamento"}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="py-4">
          {/* Status: Loading */}
          {status === "loading" && (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <div className="text-center">
                <p className="text-lg font-medium">Verificando disponibilidade...</p>
                <p className="text-3xl font-bold text-primary mt-2">{countdown}</p>
              </div>
            </div>
          )}

          {/* Status: Conflict */}
          {status === "conflict" && (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertCircle className="h-8 w-8 text-destructive" />
              </div>
              <div className="text-center">
                <p className="text-lg font-medium text-destructive">Horário Indisponível</p>
                <p className="text-muted-foreground mt-2">
                  {conflictMessage || "Horário ocupado, escolha outra data"}
                </p>
              </div>
              <Button variant="outline" onClick={onClose} className="mt-4">
                Fechar
              </Button>
            </div>
          )}

          {/* Status: Error */}
          {status === "error" && (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertCircle className="h-8 w-8 text-destructive" />
              </div>
              <div className="text-center">
                <p className="text-lg font-medium text-destructive">Erro</p>
                <p className="text-muted-foreground mt-2">
                  {errorMessage || "Ocorreu um erro inesperado"}
                </p>
              </div>
              <Button variant="outline" onClick={onClose} className="mt-4">
                Fechar
              </Button>
            </div>
          )}

          {/* Status: Ready - Form de edição */}
          {(status === "ready" || status === "confirming") && localEvento && (
            <div className="space-y-6">
              {/* Mensagem do webhook */}
              {message && (
                <div className={`p-3 rounded-lg text-sm ${
                  isUpdate 
                    ? "bg-amber-50 text-amber-800 border border-amber-200" 
                    : "bg-blue-50 text-blue-800 border border-blue-200"
                }`}>
                  {message}
                </div>
              )}

              {/* UPDATE: Mostrar horário atual vs novo */}
              {isUpdate && currentEvento && (
                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-muted/50 border">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Horário Atual</p>
                    <p className="text-sm">
                      {formatDateTimeDisplay(currentEvento.inicio)} → {formatDateTimeDisplay(currentEvento.fim)}
                    </p>
                  </div>
                  <div className="flex justify-center">
                    <div className="h-6 w-6 rounded-full bg-amber-100 flex items-center justify-center">
                      <span className="text-amber-600 text-xs">↓</span>
                    </div>
                  </div>
                  <p className="text-xs font-medium text-muted-foreground text-center">Novo Horário Proposto</p>
                </div>
              )}

              {/* Início */}
              <div className="grid grid-cols-[80px_1fr_60px_1fr] items-center gap-3">
                <Label className="text-right font-medium">Início</Label>
                <Input
                  type="date"
                  value={formatDateForInput(localEvento.inicio)}
                  onChange={(e) => handleDateChange('inicio', e.target.value)}
                  disabled={status === "confirming"}
                />
                <Label className="text-right font-medium">Hora</Label>
                <Input
                  type="time"
                  value={formatTimeForInput(localEvento.inicio)}
                  onChange={(e) => handleTimeChange('inicio', e.target.value)}
                  disabled={status === "confirming"}
                />
              </div>

              {/* Fim */}
              <div className="grid grid-cols-[80px_1fr_60px_1fr] items-center gap-3">
                <Label className="text-right font-medium">Fim</Label>
                <Input
                  type="date"
                  value={formatDateForInput(localEvento.fim)}
                  onChange={(e) => handleDateChange('fim', e.target.value)}
                  disabled={status === "confirming"}
                />
                <Label className="text-right font-medium">Hora</Label>
                <Input
                  type="time"
                  value={formatTimeForInput(localEvento.fim)}
                  onChange={(e) => handleTimeChange('fim', e.target.value)}
                  disabled={status === "confirming"}
                />
              </div>

              {/* Botões */}
              <div className="flex justify-center gap-4 pt-4">
                <Button
                  variant="destructive"
                  onClick={onClose}
                  disabled={status === "confirming"}
                  className="min-w-[120px]"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleConfirm}
                  disabled={status === "confirming"}
                  className={`min-w-[140px] ${
                    isUpdate 
                      ? "bg-amber-600 hover:bg-amber-700" 
                      : "bg-green-600 hover:bg-green-700"
                  }`}
                >
                  {getConfirmButtonText()}
                </Button>
              </div>
            </div>
          )}

          {/* Status: Success */}
          {status === "success" && (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <div className="h-16 w-16 rounded-full bg-green-500/10 flex items-center justify-center">
                <CheckCircle className="h-8 w-8 text-green-500" />
              </div>
              <div className="text-center">
                <p className="text-lg font-medium text-green-600">
                  {successMessage || (isUpdate ? "Agendamento Atualizado!" : "Agendamento Criado!")}
                </p>
                {!successMessage && (
                  <p className="text-muted-foreground mt-2">
                    O evento foi {isUpdate ? "atualizado" : "adicionado"} na agenda com sucesso.
                  </p>
                )}
              </div>
              <Button onClick={onClose} className="mt-4 min-w-[100px] bg-green-600 hover:bg-green-700">
                OK
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
