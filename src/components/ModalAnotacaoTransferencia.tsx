import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface ModalAnotacaoTransferenciaProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (anotacao: string) => void;
  nomeResponsavel: string;
  nomeContato: string;
}

export const ModalAnotacaoTransferencia = ({
  open,
  onClose,
  onConfirm,
  nomeResponsavel,
  nomeContato,
}: ModalAnotacaoTransferenciaProps) => {
  const [anotacao, setAnotacao] = useState("");

  const handleConfirm = () => {
    onConfirm(anotacao);
    setAnotacao("");
  };

  const handleCancel = () => {
    setAnotacao("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Transferir Conversa</DialogTitle>
          <DialogDescription>
            Transferindo conversa de <strong>{nomeContato}</strong> para <strong>{nomeResponsavel}</strong>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="anotacao">Anotação de Transferência</Label>
            <Textarea
              id="anotacao"
              placeholder="Ex: Paciente do zap pessoal, deseja agendar..."
              value={anotacao}
              onChange={(e) => setAnotacao(e.target.value)}
              className="min-h-[120px]"
            />
            <p className="text-sm text-muted-foreground">
              Esta anotação será enviada ao novo responsável junto com a notificação.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm}>
            Confirmar Transferência
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
