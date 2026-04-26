import { useState } from "react";
import { Sparkles, Loader2, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AudioMessageProps {
  messageId: string;
  text: string | null;
  mediaSrc: string | null;
  mimetype?: string;
  isMinhaMsg: boolean;
  onTranscribed?: (newText: string) => void;
}

/**
 * Renderiza áudio + botão de transcrição (Whisper) sob demanda.
 * Convenção: text começando com '[Áudio]:' é transcrição já feita.
 * Após transcrever, atualiza messages.text via edge function.
 */
export function AudioMessage({
  messageId,
  text,
  mediaSrc,
  mimetype,
  isMinhaMsg,
  onTranscribed,
}: AudioMessageProps) {
  const [transcribing, setTranscribing] = useState(false);
  const [localTranscription, setLocalTranscription] = useState<string | null>(null);

  const transcricaoPersistida =
    text && text.startsWith('[Áudio]:') ? text.replace(/^\[Áudio\]:\s*/, '') : null;
  const transcricaoMostrada = localTranscription ?? transcricaoPersistida;

  const handleTranscribe = async () => {
    setTranscribing(true);
    try {
      const { data, error } = await supabase.functions.invoke('transcrever-audio', {
        body: { message_id: messageId },
      });
      if (error) throw error;
      const result = data as { ok?: boolean; text?: string; error?: string };
      if (!result.ok) throw new Error(result.error || 'Falha ao transcrever');
      const novoTexto = result.text || '';
      setLocalTranscription(novoTexto.replace(/^\[Áudio\]:\s*/, ''));
      onTranscribed?.(novoTexto);
      toast.success("Áudio transcrito");
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      toast.error(`Não consegui transcrever: ${msg}`);
    } finally {
      setTranscribing(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {mediaSrc ? (
        <audio controls className="max-w-[250px] h-10" preload="metadata">
          <source src={mediaSrc} type={mimetype || 'audio/ogg'} />
          Seu navegador não suporta áudio.
        </audio>
      ) : (
        <div className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center ${
              isMinhaMsg ? 'bg-primary-foreground/20' : 'bg-muted-foreground/20'
            }`}
          >
            <Mic className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div
              className={`h-1 rounded-full w-24 ${
                isMinhaMsg ? 'bg-primary-foreground/40' : 'bg-muted-foreground/40'
              }`}
            />
            <p className="text-xs mt-1 opacity-70">Áudio</p>
          </div>
        </div>
      )}

      {transcricaoMostrada ? (
        <div
          className={`text-xs italic px-2 py-1.5 rounded leading-relaxed max-w-[280px] ${
            isMinhaMsg ? 'bg-primary-foreground/10' : 'bg-muted-foreground/10'
          }`}
        >
          <span className="font-semibold not-italic mr-1 opacity-70">Transcrição:</span>
          {transcricaoMostrada}
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleTranscribe}
          disabled={transcribing}
          className="h-7 text-xs gap-1 self-start"
          title="Transcreve via Whisper (OpenAI)"
        >
          {transcribing ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Transcrevendo...
            </>
          ) : (
            <>
              <Sparkles className="h-3 w-3" />
              Transcrever áudio
            </>
          )}
        </Button>
      )}
    </div>
  );
}
