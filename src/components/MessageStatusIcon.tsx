import { Check, CheckCheck } from "lucide-react";

interface MessageStatusIconProps {
  status?: string;
  fromMe?: boolean;
  className?: string;
}

export function MessageStatusIcon({ status, fromMe, className = "" }: MessageStatusIconProps) {
  // Só mostrar status para mensagens enviadas
  if (!fromMe) return null;

  // Status possíveis: PENDING, SERVER_ACK, DELIVERED, READ
  switch (status) {
    case 'READ':
      return <CheckCheck className={`h-3.5 w-3.5 ${className}`} style={{ color: '#34D399' }} />;
    case 'DELIVERED':
      return <CheckCheck className={`h-3.5 w-3.5 ${className}`} />;
    case 'SERVER_ACK':
      return <Check className={`h-3.5 w-3.5 ${className}`} />;
    case 'PENDING':
      return <Check className={`h-3.5 w-3.5 ${className} opacity-50`} />;
    default:
      return <Check className={`h-3.5 w-3.5 ${className} opacity-50`} />;
  }
}
