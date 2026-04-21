import { Check, CheckCheck, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageStatusIconProps {
  status?: string;
  fromMe?: boolean;
  className?: string;
}

/**
 * Status dos ACK do WhatsApp (em ordem de progressão):
 *   PENDING     → 🕐 relógio, mensagem ainda na fila local
 *   SERVER_ACK  → ✓ um check cinza, servidor WA recebeu
 *   DELIVERED  → ✓✓ dois checks cinza, entregue ao destinatário
 *   READ        → ✓✓ dois checks azuis (#53BDEB é a cor oficial do WhatsApp)
 *
 * Cores tokenizadas pra respeitar light/dark. O azul é hardcoded porque é
 * a assinatura do "lido" no WhatsApp — trocar descaracteriza.
 */
export function MessageStatusIcon({ status, fromMe, className = "" }: MessageStatusIconProps) {
  if (!fromMe) return null;

  const normalized = (status || "").toUpperCase();

  if (normalized === 'READ') {
    return <CheckCheck className={cn("h-[14px] w-[14px]", className)} style={{ color: '#53BDEB' }} />;
  }
  if (normalized === 'DELIVERED' || normalized === 'DELIVERY_ACK') {
    return <CheckCheck className={cn("h-[14px] w-[14px]", className)} />;
  }
  if (normalized === 'SERVER_ACK' || normalized === 'SENT') {
    return <Check className={cn("h-[14px] w-[14px]", className)} />;
  }
  if (normalized === 'PENDING') {
    return <Clock className={cn("h-[12px] w-[12px] opacity-60", className)} />;
  }
  // Estado desconhecido/sem status ainda — um check fraco pra indicar "enviando"
  return <Check className={cn("h-[14px] w-[14px] opacity-50", className)} />;
}
