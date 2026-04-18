import { useState, useRef, useEffect } from "react";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { 
  MoreVertical, 
  Reply, 
  Trash2, 
  Copy,
  ThumbsUp,
  Heart,
  Laugh,
  Frown,
  HandMetal,
  Pencil,
  Smile
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ReplyingTo {
  messageId: string;
  waMessageId: string;
  text: string | null;
  fromMe: boolean;
  senderName?: string;
  messageType?: string;
}

interface MessageActionsProps {
  messageId: string;
  waMessageId: string | null;
  remoteJid: string;
  fromMe: boolean;
  instanciaWhatsappId: string;
  conversaId: string;
  userId: string;
  messageText?: string | null;
  messageType?: string;
  senderName?: string;
  onStartReply?: (replyingTo: ReplyingTo) => void;
  onMessageEdited?: (newText: string) => void;
}

const QUICK_REACTIONS = [
  { emoji: "👍", icon: ThumbsUp },
  { emoji: "❤️", icon: Heart },
  { emoji: "😂", icon: Laugh },
  { emoji: "😮", icon: null },
  { emoji: "😢", icon: Frown },
  { emoji: "🙏", icon: HandMetal },
];

export function MessageActions({
  messageId,
  waMessageId,
  remoteJid,
  fromMe,
  instanciaWhatsappId,
  conversaId,
  userId,
  messageText,
  messageType,
  senderName,
  onStartReply,
  onMessageEdited
}: MessageActionsProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editText, setEditText] = useState(messageText || "");
  const [deleteType, setDeleteType] = useState<'forMe' | 'forAll' | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  // Fechar emoji picker ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        setShowEmojiPicker(false);
      }
    };

    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showEmojiPicker]);

  const handleAction = async (action: string, emoji?: string, deleteForAll?: boolean) => {
    if (!waMessageId && action !== 'deleteForMe') {
      toast.error("ID da mensagem não disponível");
      return;
    }

    setIsLoading(true);
    try {
      if (action === 'deleteForMe') {
        // Deletar apenas localmente (no banco)
        const { error } = await supabase
          .from('messages')
          .delete()
          .eq('id', messageId);
        
        if (error) throw error;
        toast.success("Mensagem apagada para você!");
        setShowDeleteConfirm(false);
        setDeleteType(null);
        return;
      }

      const payload: any = {
        action,
        instancia_whatsapp_id: instanciaWhatsappId,
        remote_jid: remoteJid,
        message_id: waMessageId,
        from_me: fromMe,
      };

      if (action === 'react') {
        payload.emoji = emoji;
      }

      const { data, error } = await supabase.functions.invoke('message-actions-evolution', {
        body: payload
      });

      if (error) throw error;

      if (!data?.success) {
        throw new Error(data?.message || 'Erro na ação');
      }

      if (action === 'react') {
        toast.success("Reação enviada!");
      } else if (action === 'delete') {
        toast.success("Mensagem apagada para todos!");
      }
    } catch (error) {
      console.error(`Erro na ação ${action}:`, error);
      toast.error(`Erro: ${error instanceof Error ? error.message : 'Falha na ação'}`);
    } finally {
      setIsLoading(false);
      setShowDeleteConfirm(false);
      setDeleteType(null);
    }
  };

  const handleEdit = async () => {
    if (!editText.trim() || !waMessageId) {
      toast.error("Texto não pode estar vazio");
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('message-actions-evolution', {
        body: {
          action: 'edit',
          instancia_whatsapp_id: instanciaWhatsappId,
          remote_jid: remoteJid,
          message_id: waMessageId,
          from_me: fromMe,
          conversa_id: conversaId,
          new_text: editText.trim()
        }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.message || 'Erro ao editar');

      toast.success("Mensagem editada!");
      setShowEditDialog(false);
      onMessageEdited?.(editText.trim());
    } catch (error) {
      console.error("Erro ao editar:", error);
      toast.error(`Erro: ${error instanceof Error ? error.message : 'Falha ao editar'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (messageText) {
      navigator.clipboard.writeText(messageText);
      toast.success("Texto copiado!");
    }
  };

  const handleReplyClick = () => {
    if (!waMessageId) {
      toast.error("ID da mensagem não disponível");
      return;
    }

    // Gerar texto de preview para o reply
    let previewText = messageText;
    if (!previewText) {
      switch (messageType) {
        case 'image':
          previewText = '📷 Imagem';
          break;
        case 'video':
          previewText = '🎬 Vídeo';
          break;
        case 'audio':
          previewText = '🎵 Áudio';
          break;
        case 'document':
          previewText = '📎 Documento';
          break;
        case 'sticker':
          previewText = '🏷️ Figurinha';
          break;
        default:
          previewText = 'Mensagem';
      }
    }

    onStartReply?.({
      messageId,
      waMessageId,
      text: previewText,
      fromMe,
      senderName,
      messageType
    });
  };

  return (
    <>
      <div className="flex items-center gap-0.5">
        {/* Botão de Reação Rápida */}
        <div className="relative" ref={emojiPickerRef}>
          <button 
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-background/20"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            disabled={isLoading || !waMessageId}
            title="Reagir"
          >
            <Smile className="h-4 w-4" />
          </button>
          
          {/* Emoji Picker Flutuante */}
          {showEmojiPicker && (
            <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-background border border-border rounded-full shadow-lg px-2 py-1.5 flex items-center gap-1 z-50 animate-in fade-in zoom-in-95 duration-100">
              {QUICK_REACTIONS.map(({ emoji }) => (
                <button
                  key={emoji}
                  onClick={() => {
                    handleAction('react', emoji);
                    setShowEmojiPicker(false);
                  }}
                  className="text-lg hover:scale-125 transition-transform p-1 hover:bg-muted rounded-full"
                  disabled={isLoading}
                  title={`Reagir com ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Menu de Ações */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button 
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-background/20"
              disabled={isLoading}
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {/* Quick Reactions no menu também */}
            <div className="flex justify-around p-2 border-b">
              {QUICK_REACTIONS.map(({ emoji }) => (
                <button
                  key={emoji}
                  onClick={() => handleAction('react', emoji)}
                  className="text-xl hover:scale-125 transition-transform p-1"
                  disabled={isLoading}
                >
                  {emoji}
                </button>
              ))}
            </div>

            <DropdownMenuItem onClick={handleReplyClick} disabled={isLoading || !waMessageId}>
              <Reply className="h-4 w-4 mr-2" />
              Responder
            </DropdownMenuItem>

            {messageText && (
              <DropdownMenuItem onClick={handleCopy}>
                <Copy className="h-4 w-4 mr-2" />
                Copiar
              </DropdownMenuItem>
            )}

            {/* Editar - só para mensagens próprias de texto */}
            {fromMe && waMessageId && (messageType === 'text' || messageType === 'conversation' || messageType === 'extendedTextMessage') && messageText && (
              <DropdownMenuItem 
                onClick={() => {
                  setEditText(messageText);
                  setShowEditDialog(true);
                }}
                disabled={isLoading}
              >
                <Pencil className="h-4 w-4 mr-2" />
                Editar
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />

            <DropdownMenuItem 
              onClick={() => setShowDeleteConfirm(true)} 
              disabled={isLoading}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Apagar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={(open) => {
        setShowDeleteConfirm(open);
        if (!open) setDeleteType(null);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Apagar mensagem?</DialogTitle>
          </DialogHeader>
          
          <div className="flex flex-col gap-2">
            <Button 
              variant="outline" 
              className="justify-start text-left h-auto py-3"
              onClick={() => handleAction('deleteForMe')}
              disabled={isLoading}
            >
              <div className="flex flex-col items-start">
                <span className="font-medium">Apagar para mim</span>
                <span className="text-xs text-muted-foreground">A mensagem será removida apenas da sua visualização</span>
              </div>
            </Button>
            
            {fromMe && waMessageId && (
              <Button 
                variant="outline" 
                className="justify-start text-left h-auto py-3 border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                onClick={() => handleAction('delete')}
                disabled={isLoading}
              >
                <div className="flex flex-col items-start">
                  <span className="font-medium">Apagar para todos</span>
                  <span className="text-xs opacity-80">A mensagem será apagada para todos os participantes</span>
                </div>
              </Button>
            )}
          </div>
          
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDeleteConfirm(false)}>
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Message Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar mensagem</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <Textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              placeholder="Digite o novo texto..."
              rows={4}
              className="resize-none"
            />
          </div>
          
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setShowEditDialog(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={handleEdit} 
              disabled={isLoading || !editText.trim()}
            >
              {isLoading ? "Editando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
