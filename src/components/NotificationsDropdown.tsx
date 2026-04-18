import { useState, useEffect, useRef, useCallback } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Notificacao {
  id: string;
  titulo: string;
  mensagem: string;
  tipo: string;
  lida: boolean;
  created_at: string;
  dados: unknown;
  user_id: string | null;
}

// Som de notificação usando Web Audio API
const playNotificationSound = () => {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // Primeiro beep
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.frequency.value = 880;
    osc1.type = 'sine';
    gain1.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
    osc1.start(audioCtx.currentTime);
    osc1.stop(audioCtx.currentTime + 0.15);

    // Segundo beep (mais agudo)
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    osc2.frequency.value = 1175;
    osc2.type = 'sine';
    gain2.gain.setValueAtTime(0.3, audioCtx.currentTime + 0.18);
    gain2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
    osc2.start(audioCtx.currentTime + 0.18);
    osc2.stop(audioCtx.currentTime + 0.35);

    // Cleanup
    setTimeout(() => audioCtx.close(), 500);
  } catch (e) {
    console.warn('[Notificações] Não foi possível tocar som:', e);
  }
};

export function NotificationsDropdown() {
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [open, setOpen] = useState(false);
  const previousNaoLidasRef = useRef<number>(0);
  const isFirstLoadRef = useRef(true);

  const checkAndPlaySound = useCallback((newNaoLidas: number) => {
    // Não tocar som no primeiro carregamento
    if (isFirstLoadRef.current) {
      isFirstLoadRef.current = false;
      previousNaoLidasRef.current = newNaoLidas;
      return;
    }

    // Tocar som se aumentou o número de não lidas
    if (newNaoLidas > previousNaoLidasRef.current) {
      playNotificationSound();
    }
    previousNaoLidasRef.current = newNaoLidas;
  }, []);

  useEffect(() => {
    fetchNotificacoes();

    // Subscribe to realtime updates filtrado por user_id
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setupChannel = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      channel = supabase
        .channel(`notificacoes-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notificacoes',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            console.log('[Notificações] Nova notificação:', payload);
            fetchNotificacoes();
            playNotificationSound();
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'notificacoes',
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            fetchNotificacoes();
          }
        )
        .subscribe();
    };

    setupChannel();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const fetchNotificacoes = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Using any to bypass types since user_id column was just added via migration
    const { data, error } = await (supabase
      .from("notificacoes") as any)
      .select("id, titulo, mensagem, tipo, lida, created_at, dados, user_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      console.error("[Notificações] Erro ao buscar:", error);
      return;
    }

    const notifs = (data || []) as Notificacao[];
    setNotificacoes(notifs);
    setNaoLidas(notifs.filter(n => !n.lida).length);
  };

  const marcarComoLida = async (id: string) => {
    const { error } = await supabase
      .from("notificacoes")
      .update({ lida: true })
      .eq("id", id);

    if (!error) {
      setNotificacoes(prev => 
        prev.map(n => n.id === id ? { ...n, lida: true } : n)
      );
      setNaoLidas(prev => Math.max(0, prev - 1));
    }
  };

  const marcarTodasComoLidas = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Using any to bypass types since user_id column was just added via migration
    const { error } = await (supabase
      .from("notificacoes") as any)
      .update({ lida: true })
      .eq("user_id", user.id)
      .eq("lida", false);

    if (!error) {
      setNotificacoes(prev => prev.map(n => ({ ...n, lida: true })));
      setNaoLidas(0);
    }
  };

  const getTipoIcon = (tipo: string) => {
    switch (tipo) {
      case "disparo_agendado_sucesso":
        return "✅";
      case "disparo_massa_concluido":
        return "📤";
      case "disparo_massa_parcial":
        return "⚠️";
      case "disparo_erro":
        return "❌";
      default:
        return "🔔";
    }
  };

  const getTipoBgColor = (tipo: string, lida: boolean) => {
    if (lida) return "bg-muted/30";
    
    switch (tipo) {
      case "disparo_agendado_sucesso":
        return "bg-green-500/10";
      case "disparo_massa_concluido":
        return "bg-blue-500/10";
      case "disparo_massa_parcial":
        return "bg-yellow-500/10";
      case "disparo_erro":
        return "bg-red-500/10";
      default:
        return "bg-primary/10";
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {naoLidas > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs"
            >
              {naoLidas > 9 ? "9+" : naoLidas}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notificações</span>
          {naoLidas > 0 && (
            <Button 
              variant="ghost" 
              size="sm" 
              className="text-xs h-7"
              onClick={marcarTodasComoLidas}
            >
              Marcar todas como lidas
            </Button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ScrollArea className="h-[300px]">
          {notificacoes.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-sm">
              Nenhuma notificação
            </div>
          ) : (
            notificacoes.map((notificacao) => (
              <DropdownMenuItem 
                key={notificacao.id}
                className={`flex flex-col items-start gap-1 p-3 cursor-pointer ${getTipoBgColor(notificacao.tipo, notificacao.lida)}`}
                onClick={() => {
                  if (!notificacao.lida) {
                    marcarComoLida(notificacao.id);
                  }
                }}
              >
                <div className="flex items-start gap-2 w-full">
                  <span className="text-lg">{getTipoIcon(notificacao.tipo)}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${notificacao.lida ? "text-muted-foreground" : ""}`}>
                      {notificacao.titulo}
                    </p>
                    <p className={`text-xs ${notificacao.lida ? "text-muted-foreground/70" : "text-muted-foreground"}`}>
                      {notificacao.mensagem}
                    </p>
                    <p className="text-xs text-muted-foreground/50 mt-1">
                      {formatDistanceToNow(new Date(notificacao.created_at), { 
                        addSuffix: true, 
                        locale: ptBR 
                      })}
                    </p>
                  </div>
                  {!notificacao.lida && (
                    <div className="w-2 h-2 bg-primary rounded-full shrink-0" />
                  )}
                </div>
              </DropdownMenuItem>
            ))
          )}
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
