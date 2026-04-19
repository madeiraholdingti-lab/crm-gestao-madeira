export function getConversaUrgencyColor(lastMessageFromMe: boolean | null, ultimaInteracao: string | null): string {
  if (lastMessageFromMe !== false) return '#22C55E';
  if (!ultimaInteracao) return '#EF4444';

  const hours = (Date.now() - new Date(ultimaInteracao).getTime()) / 3600000;
  if (hours > 4) return '#EF4444';
  if (hours > 2) return '#F97316';
  if (hours > 1) return '#F59E0B';
  return '#EAB308';
}

export function getTempoSemResposta(ultimaInteracao: string | null): string | null {
  if (!ultimaInteracao) return null;
  const min = Math.floor((Date.now() - new Date(ultimaInteracao).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function getUrgencyLabel(hours: number): 'normal' | 'atencao' | 'urgente' {
  if (hours > 4) return 'urgente';
  if (hours > 2) return 'atencao';
  return 'normal';
}
