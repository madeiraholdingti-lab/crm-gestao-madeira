import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { 
  Send, 
  Paperclip, 
  Mic, 
  Square, 
  Image, 
  FileText, 
  Video,
  X,
  FileIcon,
  Reply,
  ImageIcon,
  Film,
  Music
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { ReplyingTo } from './MessageActions';

interface FilePreview {
  file: File;
  type: 'image' | 'video' | 'document' | 'audio';
  url: string;
  caption: string;
}

export interface ReplyContext {
  waMessageId: string;
  remoteJid: string;
  fromMe: boolean;
}

interface ChatInputProps {
  onSendMessage: (text: string, replyContext?: ReplyContext) => Promise<void>;
  onSendMedia: (file: File, type: 'image' | 'video' | 'document' | 'audio', caption?: string) => Promise<void>;
  onSendMultipleMedia?: (files: { file: File; caption: string }[], type: 'image' | 'video' | 'document') => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  externalFiles?: File[];
  onExternalFilesProcessed?: () => void;
  replyingTo?: ReplyingTo | null;
  onCancelReply?: () => void;
  remoteJid?: string;
}

export function ChatInput({ 
  onSendMessage, 
  onSendMedia, 
  onSendMultipleMedia,
  disabled = false,
  placeholder = "Digite sua mensagem...",
  externalFiles,
  onExternalFilesProcessed,
  replyingTo,
  onCancelReply,
  remoteJid
}: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [sendingFiles, setSendingFiles] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [dragCounter, setDragCounter] = useState(0);
  const [previewFiles, setPreviewFiles] = useState<FilePreview[]>([]);
  const [activePreviewIndex, setActivePreviewIndex] = useState(0);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captionInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const isDragging = dragCounter > 0;

  // Handle external files (from parent component drag-and-drop or paste)
  useEffect(() => {
    if (externalFiles && externalFiles.length > 0) {
      addFilesToPreview(externalFiles);
      onExternalFilesProcessed?.();
    }
  }, [externalFiles, onExternalFilesProcessed]);

  // Focus caption input when preview opens
  useEffect(() => {
    if (previewFiles.length > 0 && captionInputRef.current) {
      captionInputRef.current.focus();
    }
  }, [previewFiles.length, activePreviewIndex]);

  // Handle paste event for Ctrl+V image paste
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            files.push(file);
          }
        }
      }

      if (files.length > 0) {
        e.preventDefault();
        addFilesToPreview(files);
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, []);

  const addFilesToPreview = (files: File[]) => {
    // Check file sizes
    const oversizedFiles = files.filter(f => f.size > 20 * 1024 * 1024);
    if (oversizedFiles.length > 0) {
      toast.error(`${oversizedFiles.length} arquivo(s) muito grande(s). Máximo 20MB por arquivo.`);
      return;
    }

    const newPreviews: FilePreview[] = files.map(file => {
      let type: 'image' | 'video' | 'document' | 'audio';
      
      if (file.type.startsWith('image/')) {
        type = 'image';
      } else if (file.type.startsWith('video/')) {
        type = 'video';
      } else if (file.type.startsWith('audio/')) {
        type = 'audio';
      } else {
        type = 'document';
      }

      return {
        file,
        type,
        url: type === 'image' || type === 'video' ? URL.createObjectURL(file) : '',
        caption: ''
      };
    });

    setPreviewFiles(prev => [...prev, ...newPreviews]);
    setActivePreviewIndex(previewFiles.length);
  };

  const handleSendText = () => {
    if (!message.trim() || disabled) return;
    
    const textToSend = message.trim();
    setMessage(''); // Limpar input imediatamente
    
    // Envio assíncrono (fire-and-forget) - não esperar resposta
    if (replyingTo && remoteJid) {
      onSendMessage(textToSend, {
        waMessageId: replyingTo.waMessageId,
        remoteJid: remoteJid,
        fromMe: replyingTo.fromMe
      });
      onCancelReply?.();
    } else {
      onSendMessage(textToSend);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  };

  // Handle Enter on preview to send files
  const handlePreviewKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendAllPreviewFiles();
    }
  };

  const handleFileSelect = (type: 'image' | 'video' | 'document') => {
    if (fileInputRef.current) {
      switch (type) {
        case 'image':
          fileInputRef.current.accept = 'image/*';
          fileInputRef.current.multiple = true;
          break;
        case 'video':
          fileInputRef.current.accept = 'video/*';
          fileInputRef.current.multiple = true;
          break;
        case 'document':
          fileInputRef.current.accept = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv';
          fileInputRef.current.multiple = true;
          break;
      }
      fileInputRef.current.dataset.type = type;
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    const type = e.target.dataset.type as 'image' | 'video' | 'document';
    
    if (!files || files.length === 0 || !type) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const fileArray = Array.from(files);
    
    // Check file sizes (20MB max each)
    const oversizedFiles = fileArray.filter(f => f.size > 20 * 1024 * 1024);
    if (oversizedFiles.length > 0) {
      toast.error(`${oversizedFiles.length} arquivo(s) muito grande(s). Máximo 20MB por arquivo.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // Add files to preview
    const newPreviews: FilePreview[] = fileArray.map(file => ({
      file,
      type,
      url: type === 'image' || type === 'video' ? URL.createObjectURL(file) : '',
      caption: ''
    }));

    setPreviewFiles(prev => [...prev, ...newPreviews]);
    setActivePreviewIndex(previewFiles.length); // Focus first new file
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const sendAllPreviewFiles = () => {
    if (previewFiles.length === 0 || sendingFiles) return;

    // Snapshot dos arquivos e limpar o composer imediatamente
    const previewsToSend = [...previewFiles];
    clearAllPreviews();

    setSendingFiles(true);

    // Enviar em background para liberar o usuário para digitar enquanto sobe o arquivo
    void (async () => {
      try {
        // Group files by type
        const imageFiles = previewsToSend.filter(p => p.type === 'image');
        const videoFiles = previewsToSend.filter(p => p.type === 'video');
        const docFiles = previewsToSend.filter(p => p.type === 'document');

        // Send images
        if (imageFiles.length > 0) {
          if (onSendMultipleMedia && imageFiles.length > 1) {
            await onSendMultipleMedia(
              imageFiles.map(p => ({ file: p.file, caption: p.caption })),
              'image'
            );
          } else {
            for (const preview of imageFiles) {
              await onSendMedia(preview.file, 'image', preview.caption);
            }
          }
        }

        // Send videos
        for (const preview of videoFiles) {
          await onSendMedia(preview.file, 'video', preview.caption);
        }

        // Send documents
        if (docFiles.length > 0) {
          if (onSendMultipleMedia && docFiles.length > 1) {
            await onSendMultipleMedia(
              docFiles.map(p => ({ file: p.file, caption: p.caption })),
              'document'
            );
          } else {
            for (const preview of docFiles) {
              await onSendMedia(preview.file, 'document', preview.caption);
            }
          }
        }

        toast.success(`${previewsToSend.length} arquivo(s) enviado(s) com sucesso!`);
      } catch (error) {
        console.error('Erro ao enviar arquivos:', error);
        toast.error('Erro ao enviar alguns arquivos');
      } finally {
        setSendingFiles(false);
      }
    })();
  };

  const sendFile = async (file: File, type: 'image' | 'video' | 'document' | 'audio', caption?: string) => {
    setSendingFiles(true);
    try {
      await onSendMedia(file, type, caption);
    } catch (error) {
      console.error('Erro ao enviar arquivo:', error);
      toast.error('Erro ao enviar arquivo');
    } finally {
      setSendingFiles(false);
    }
  };

  const removePreviewFile = (index: number) => {
    setPreviewFiles(prev => {
      const newPreviews = [...prev];
      // Revoke URL if exists
      if (newPreviews[index].url) {
        URL.revokeObjectURL(newPreviews[index].url);
      }
      newPreviews.splice(index, 1);
      return newPreviews;
    });
    
    // Adjust active index
    if (activePreviewIndex >= previewFiles.length - 1) {
      setActivePreviewIndex(Math.max(0, previewFiles.length - 2));
    }
  };

  const updatePreviewCaption = (index: number, caption: string) => {
    setPreviewFiles(prev => {
      const newPreviews = [...prev];
      newPreviews[index] = { ...newPreviews[index], caption };
      return newPreviews;
    });
  };

  const clearAllPreviews = () => {
    previewFiles.forEach(p => {
      if (p.url) URL.revokeObjectURL(p.url);
    });
    setPreviewFiles([]);
    setActivePreviewIndex(0);
  };

  // Audio Recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/ogg; codecs=opus' });
        const audioFile = new File([audioBlob], `audio_${Date.now()}.ogg`, { type: 'audio/ogg' });
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
        
        await sendFile(audioFile, 'audio');
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      // Timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (error) {
      console.error('Erro ao acessar microfone:', error);
      toast.error('Não foi possível acessar o microfone. Verifique as permissões.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      mediaRecorderRef.current = null;
      audioChunksRef.current = [];
      setIsRecording(false);
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Drag and Drop - using counter to handle nested elements
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(prev => prev + 1);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(prev => prev - 1);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(0);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    // Check file sizes
    const oversizedFiles = files.filter(f => f.size > 20 * 1024 * 1024);
    if (oversizedFiles.length > 0) {
      toast.error(`${oversizedFiles.length} arquivo(s) muito grande(s). Máximo 20MB por arquivo.`);
      return;
    }

    // Add all files to preview
    const newPreviews: FilePreview[] = files.map(file => {
      let type: 'image' | 'video' | 'document' | 'audio';
      
      if (file.type.startsWith('image/')) {
        type = 'image';
      } else if (file.type.startsWith('video/')) {
        type = 'video';
      } else if (file.type.startsWith('audio/')) {
        type = 'audio';
      } else {
        type = 'document';
      }

      return {
        file,
        type,
        url: type === 'image' || type === 'video' ? URL.createObjectURL(file) : '',
        caption: ''
      };
    });

    setPreviewFiles(prev => [...prev, ...newPreviews]);
    setActivePreviewIndex(previewFiles.length);
  }, [previewFiles.length]);

  // Get thumbnail for file
  const getFileThumbnail = (preview: FilePreview) => {
    if (preview.type === 'image' && preview.url) {
      return (
        <img 
          src={preview.url} 
          alt={preview.file.name} 
          className="w-full h-full object-cover"
        />
      );
    }
    if (preview.type === 'video' && preview.url) {
      return (
        <video 
          src={preview.url} 
          className="w-full h-full object-cover"
        />
      );
    }
    // Document/Audio icons
    const ext = preview.file.name.split('.').pop()?.toLowerCase() || '';
    const isPdf = ext === 'pdf';
    const isExcel = ['xls', 'xlsx', 'csv'].includes(ext);
    
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-muted">
        <FileIcon className={`h-8 w-8 ${isPdf ? 'text-red-500' : isExcel ? 'text-green-600' : 'text-blue-500'}`} />
        <span className="text-[10px] font-medium mt-1 uppercase text-muted-foreground">{ext}</span>
      </div>
    );
  };

  // Helper para ícone do tipo de mídia no reply
  const getReplyMediaIcon = (type?: string) => {
    switch (type) {
      case 'image': return <ImageIcon className="h-3 w-3 text-muted-foreground" />;
      case 'video': return <Film className="h-3 w-3 text-muted-foreground" />;
      case 'audio': return <Music className="h-3 w-3 text-muted-foreground" />;
      case 'document': return <FileText className="h-3 w-3 text-muted-foreground" />;
      default: return null;
    }
  };

  return (
    <div 
      ref={dropZoneRef}
      className={`relative flex-shrink-0 border-t bg-card transition-colors ${isDragging ? 'bg-primary/10 border-primary' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Reply Preview - WhatsApp style */}
      {replyingTo && (
        <div className="px-3 pt-3">
          <div className="flex items-start gap-2 p-2 bg-muted/80 rounded-lg border-l-4 border-primary">
            <Reply className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-primary">
                {replyingTo.fromMe ? 'Você' : (replyingTo.senderName || 'Contato')}
              </p>
              <div className="flex items-center gap-1">
                {getReplyMediaIcon(replyingTo.messageType)}
                <p className="text-xs text-muted-foreground truncate">
                  {replyingTo.text || 'Mensagem'}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 flex-shrink-0"
              onClick={onCancelReply}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      {/* Multiple Files Preview Gallery */}
      {previewFiles.length > 0 && (
        <div className="p-3 border-b bg-muted/50">
          {/* Thumbnail Gallery */}
          <div className="flex gap-2 mb-3 overflow-x-auto pb-2">
            {previewFiles.map((preview, index) => (
              <div 
                key={index}
                className={`relative flex-shrink-0 w-24 h-24 rounded-lg overflow-hidden border-2 cursor-pointer transition-all ${
                  activePreviewIndex === index 
                    ? 'border-primary ring-2 ring-primary/30' 
                    : 'border-border hover:border-primary/50'
                }`}
                onClick={() => setActivePreviewIndex(index)}
              >
                {getFileThumbnail(preview)}
                {/* Delete button */}
                <Button 
                  size="icon" 
                  variant="destructive" 
                  className="absolute top-1 right-1 h-5 w-5 rounded-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    removePreviewFile(index);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
                {/* Caption indicator */}
                {preview.caption && (
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                    <p className="text-[10px] text-white truncate">{preview.caption}</p>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Caption moves to main input area when files are selected */}
        </div>
      )}

      {/* Recording UI */}
      {isRecording && (
        <div className="p-3 border-b bg-red-50 dark:bg-red-950/30">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 flex-1">
              <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
              <span className="text-sm font-medium text-red-600 dark:text-red-400">
                Gravando... {formatTime(recordingTime)}
              </span>
            </div>
            <Button 
              size="sm" 
              variant="outline" 
              onClick={cancelRecording}
            >
              <X className="h-4 w-4 mr-1" />
              Cancelar
            </Button>
            <Button 
              size="sm" 
              variant="destructive"
              onClick={stopRecording}
            >
              <Square className="h-4 w-4 mr-1" />
              Parar e Enviar
            </Button>
          </div>
        </div>
      )}

      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex items-center justify-center z-10 pointer-events-none">
          <div className="text-center">
            <Paperclip className="h-8 w-8 mx-auto text-primary mb-2" />
            <p className="text-sm font-medium">Solte o arquivo aqui</p>
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-3">
        <div className="flex items-end gap-2">
          {/* Attachment Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-10 w-10 flex-shrink-0"
                disabled={disabled || isRecording || sendingFiles}
              >
                <Paperclip className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuItem onClick={() => handleFileSelect('document')}>
                <FileText className="h-4 w-4 mr-2 text-blue-500" />
                Documento
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleFileSelect('image')}>
                <Image className="h-4 w-4 mr-2 text-green-500" />
                Fotos
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleFileSelect('video')}>
                <Video className="h-4 w-4 mr-2 text-purple-500" />
                Vídeo
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Caption Input when files are selected, otherwise Text Input */}
          {previewFiles.length > 0 ? (
              <Input
                ref={captionInputRef}
                placeholder="Adicionar legenda... (opcional)"
                value={previewFiles[activePreviewIndex]?.caption || ''}
                onChange={(e) => updatePreviewCaption(activePreviewIndex, e.target.value)}
                onKeyDown={handlePreviewKeyPress}
                className="h-[44px] flex-1"
                disabled={sendingFiles}
              />
            ) : (
              <Textarea
                placeholder={placeholder}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                className="min-h-[44px] max-h-[120px] resize-none flex-1"
                disabled={disabled || isRecording}
                rows={1}
              />
          )}

          {/* Send button when files or text, otherwise Record Button */}
          {previewFiles.length > 0 ? (
            <Button
              onClick={sendAllPreviewFiles}
              disabled={sendingFiles || disabled}
              size="icon"
              className="h-10 w-10 flex-shrink-0"
            >
              <Send className="h-5 w-5" />
            </Button>
          ) : message.trim() ? (
            <Button
              onClick={handleSendText}
              disabled={disabled}
              size="icon"
              className="h-10 w-10 flex-shrink-0"
            >
              <Send className="h-5 w-5" />
            </Button>
          ) : (
            <Button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={disabled}
              size="icon"
              variant={isRecording ? "destructive" : "default"}
              className="h-10 w-10 flex-shrink-0"
            >
              {isRecording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </Button>
          )}
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
