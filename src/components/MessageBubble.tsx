import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FileText, Image, Video, Mic, MapPin, User, Download, Play, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useRef } from "react";

interface MessageBubbleProps {
  text: string | null;
  messageType: string;
  isFromMe: boolean;
  timestamp: number | null;
  createdAt: string;
  senderName?: string;
  showSenderName?: boolean;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
}

export function MessageBubble({ 
  text, 
  messageType, 
  isFromMe, 
  timestamp, 
  createdAt,
  senderName,
  showSenderName = false,
  mediaUrl,
  mediaMimeType
}: MessageBubbleProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [imageError, setImageError] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const toggleAudio = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
  };
  
  const renderMediaIcon = () => {
    switch (messageType) {
      case 'image':
      case 'imageMessage':
        return <Image className="h-4 w-4 inline mr-1" />;
      case 'video':
      case 'videoMessage':
        return <Video className="h-4 w-4 inline mr-1" />;
      case 'audio':
      case 'audioMessage':
        return <Mic className="h-4 w-4 inline mr-1" />;
      case 'document':
      case 'documentMessage':
      case 'documentWithCaptionMessage':
        return <FileText className="h-4 w-4 inline mr-1" />;
      case 'location':
        return <MapPin className="h-4 w-4 inline mr-1" />;
      case 'contact':
        return <User className="h-4 w-4 inline mr-1" />;
      case 'sticker':
      case 'stickerMessage':
        return <span className="mr-1">🏷️</span>;
      default:
        return null;
    }
  };

  const renderContent = () => {
    const icon = renderMediaIcon();
    const normalizedType = messageType?.replace('Message', '').toLowerCase();
    
    // Audio with media URL - render player
    if ((normalizedType === 'audio' || messageType === 'audioMessage') && mediaUrl) {
      return (
        <div className="flex items-center gap-3 min-w-[200px]">
          <audio 
            ref={audioRef} 
            src={mediaUrl} 
            onEnded={handleAudioEnded}
            className="hidden"
          />
          <button
            onClick={toggleAudio}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
              isFromMe 
                ? 'bg-primary-foreground/20 hover:bg-primary-foreground/30' 
                : 'bg-muted-foreground/20 hover:bg-muted-foreground/30'
            }`}
          >
            {isPlaying ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5 ml-0.5" />
            )}
          </button>
          <div className="flex-1">
            <div className={`h-1 rounded-full ${
              isFromMe ? 'bg-primary-foreground/40' : 'bg-muted-foreground/40'
            }`} />
            <p className="text-xs mt-1 opacity-70">Áudio</p>
          </div>
        </div>
      );
    }

    // Audio without media URL - placeholder
    if (normalizedType === 'audio' || messageType === 'audioMessage') {
      return (
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
            isFromMe ? 'bg-primary-foreground/20' : 'bg-muted-foreground/20'
          }`}>
            <Mic className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className={`h-1 rounded-full ${
              isFromMe ? 'bg-primary-foreground/40' : 'bg-muted-foreground/40'
            }`} />
            <p className="text-xs mt-1 opacity-70">Áudio não disponível</p>
          </div>
        </div>
      );
    }

    // Image with media URL - render image
    if ((normalizedType === 'image' || messageType === 'imageMessage' || normalizedType === 'sticker' || messageType === 'stickerMessage') && mediaUrl && !imageError) {
      return (
        <div className="space-y-1">
          <img 
            src={mediaUrl} 
            alt="Imagem" 
            className="max-w-[280px] max-h-[300px] rounded-lg object-cover cursor-pointer hover:opacity-90 transition-opacity"
            onError={() => setImageError(true)}
            onClick={() => window.open(mediaUrl, '_blank')}
          />
          {text && !text.startsWith('[mensagem de') && (
            <p className="text-sm whitespace-pre-wrap break-words mt-2">{text}</p>
          )}
        </div>
      );
    }

    // Image/video without media URL or with error - placeholder
    if (normalizedType === 'image' || messageType === 'imageMessage' || normalizedType === 'sticker' || messageType === 'stickerMessage') {
      return (
        <div className="space-y-1">
          <div className={`flex items-center gap-2 p-3 rounded ${
            isFromMe ? 'bg-primary-foreground/10' : 'bg-background/50'
          }`}>
            {icon}
            <span className="text-sm">Imagem não disponível</span>
          </div>
          {text && !text.startsWith('[mensagem de') && (
            <p className="text-sm whitespace-pre-wrap break-words">{text}</p>
          )}
        </div>
      );
    }

    // Video with media URL - render video player
    if ((normalizedType === 'video' || messageType === 'videoMessage') && mediaUrl) {
      return (
        <div className="space-y-1">
          <video 
            src={mediaUrl} 
            controls 
            className="max-w-[280px] max-h-[300px] rounded-lg"
          />
          {text && !text.startsWith('[mensagem de') && (
            <p className="text-sm whitespace-pre-wrap break-words mt-2">{text}</p>
          )}
        </div>
      );
    }

    // Video without media URL - placeholder
    if (normalizedType === 'video' || messageType === 'videoMessage') {
      return (
        <div className="space-y-1">
          <div className={`flex items-center gap-2 p-3 rounded ${
            isFromMe ? 'bg-primary-foreground/10' : 'bg-background/50'
          }`}>
            {icon}
            <span className="text-sm">Vídeo não disponível</span>
          </div>
          {text && !text.startsWith('[mensagem de') && (
            <p className="text-sm whitespace-pre-wrap break-words">{text}</p>
          )}
        </div>
      );
    }

    // Document with media URL - render download link
    if ((normalizedType === 'document' || messageType === 'documentMessage' || messageType === 'documentWithCaptionMessage') && mediaUrl) {
      const fileName = text?.replace('📎 ', '').replace('[mensagem de documento]', 'Documento') || 'Documento';
      return (
        <div className="space-y-1">
          <a 
            href={mediaUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className={`flex items-center gap-2 p-3 rounded transition-colors ${
              isFromMe 
                ? 'bg-primary-foreground/10 hover:bg-primary-foreground/20' 
                : 'bg-background/50 hover:bg-background/70'
            }`}
          >
            <FileText className="h-6 w-6" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{fileName}</p>
              {mediaMimeType && (
                <p className="text-xs opacity-70">{mediaMimeType}</p>
              )}
            </div>
            <Download className="h-4 w-4 opacity-70" />
          </a>
        </div>
      );
    }

    // Document without media URL - placeholder
    if (normalizedType === 'document' || messageType === 'documentMessage' || messageType === 'documentWithCaptionMessage') {
      return (
        <div className="space-y-1">
          <div className={`flex items-center gap-2 p-3 rounded ${
            isFromMe ? 'bg-primary-foreground/10' : 'bg-background/50'
          }`}>
            <FileText className="h-6 w-6" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {text?.replace('📎 ', '').replace('[mensagem de documento]', 'Documento') || 'Documento'}
              </p>
              <p className="text-xs opacity-70">Documento não disponível</p>
            </div>
          </div>
        </div>
      );
    }

    if (messageType === 'location') {
      return (
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-red-500" />
          <p className="text-sm">{text || 'Localização'}</p>
        </div>
      );
    }

    if (messageType === 'contact' || messageType === 'contactMessage' || messageType === 'contactsArrayMessage') {
      // Extract contact name from text (format might be "📇 Contato: Name (phone)" or "=Name")
      let contactDisplay = text || 'Contato';
      // Clean up malformed text that starts with "="
      if (contactDisplay.startsWith('=')) {
        contactDisplay = contactDisplay.substring(1);
      }
      // Remove emoji prefix if present
      contactDisplay = contactDisplay.replace(/^📇\s*Contato:\s*/i, '');
      
      return (
        <div className={`flex items-center gap-3 p-2 rounded-lg ${
          isFromMe ? 'bg-primary-foreground/10' : 'bg-background/50'
        }`}>
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
            isFromMe ? 'bg-primary-foreground/30' : 'bg-primary/20'
          }`}>
            <User className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{contactDisplay}</p>
            <p className="text-xs opacity-70">Contato compartilhado</p>
          </div>
        </div>
      );
    }

    // Default text message
    return (
      <p className="text-sm whitespace-pre-wrap break-words">
        {text || '(Mensagem sem texto)'}
      </p>
    );
  };

  const formattedTime = timestamp 
    ? format(new Date(timestamp * 1000), "HH:mm", { locale: ptBR })
    : format(new Date(createdAt), "HH:mm", { locale: ptBR });

  return (
    <div
      className={`rounded-lg p-3 ${
        isFromMe
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted'
      }`}
    >
      {showSenderName && senderName && (
        <p className="text-xs font-semibold mb-1 opacity-70">
          {senderName}
        </p>
      )}
      {renderContent()}
      <p className={`text-xs mt-1 ${
        isFromMe ? 'text-primary-foreground/70' : 'text-muted-foreground'
      }`}>
        {formattedTime}
      </p>
    </div>
  );
}