import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AgendaCard } from "./AgendaCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, CalendarCheck, Link2 } from "lucide-react";
import { format, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AgendaView = "hoje" | "semana";

export const AgendaList = () => {
  const navigate = useNavigate();
  const [view, setView] = useState<AgendaView>("hoje");

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const em7dias = new Date(today);
  em7dias.setDate(em7dias.getDate() + 7);

  // Descobre se o user logado é admin_geral — se for, vê eventos de TODOS
  // os médicos/secretárias (caso típico: Maikon admin enxergando agenda da
  // Isadora que conectou o Google Calendar dele). Senão, filtra pelo próprio
  // medico_id. RLS no backend já permite isso.
  const { data: isAdminGeral } = useQuery({
    queryKey: ["agenda-is-admin"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      return data?.role === "admin_geral";
    },
    staleTime: 5 * 60 * 1000,
  });

  // Eventos no range selecionado. Quando view=hoje: [hoje 00:00, amanhã 00:00).
  // Quando view=semana: [hoje 00:00, hoje+7 dias 00:00). Fetches sempre os 7
  // dias, filtra localmente pra o toggle ser instantâneo e contar "hoje"
  // sem precisar de 2 queries.
  const { data: eventos7dias, isLoading } = useQuery({
    queryKey: ["agenda-7d", isAdminGeral ?? false],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      let query = supabase
        .from("eventos_agenda")
        .select("*")
        .gte("data_hora_inicio", today.toISOString())
        .lt("data_hora_inicio", em7dias.toISOString())
        .order("data_hora_inicio", { ascending: true });

      if (!isAdminGeral) query = query.eq("medico_id", user.id);

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: isAdminGeral !== undefined,
  });

  // Derivar as duas listas a partir do fetch único
  const eventosHoje = (eventos7dias || []).filter((e: { data_hora_inicio: string }) =>
    isSameDay(new Date(e.data_hora_inicio), today),
  );
  const eventosSemana = eventos7dias || [];
  const eventosExibidos = view === "hoje" ? eventosHoje : eventosSemana;

  // Detecta se user tem Google Calendar conectado. Se não, mostra CTA no vazio.
  const { data: googleConectado } = useQuery({
    queryKey: ["agenda-google-connected"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("google_accounts")
        .select("id")
        .eq("ativo", true)
        .limit(1);
      if (error) return false;
      return (data || []).length > 0;
    },
    enabled: !isLoading && eventosExibidos.length === 0,
  });

  // Agrupa por dia quando exibindo a semana. Pra "hoje" mostra lista plana.
  const eventosAgrupados = (() => {
    if (view === "hoje") return null;
    const grupos = new Map<string, typeof eventosSemana>();
    for (const ev of eventosSemana) {
      const d = new Date(ev.data_hora_inicio);
      const key = format(d, "yyyy-MM-dd");
      if (!grupos.has(key)) grupos.set(key, []);
      grupos.get(key)!.push(ev);
    }
    return Array.from(grupos.entries()).map(([key, evs]) => ({
      label: (() => {
        const d = new Date(`${key}T12:00:00`);
        if (isSameDay(d, today)) return "Hoje";
        if (isSameDay(d, tomorrow)) return "Amanhã";
        return format(d, "EEEE, dd 'de' MMMM", { locale: ptBR });
      })(),
      eventos: evs,
    }));
  })();

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="py-3 flex-shrink-0 border-b border-border">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Calendar className="h-4 w-4 text-mh-navy-700 flex-shrink-0" />
            <CardTitle className="text-base font-serif-display font-medium truncate">
              Agenda
            </CardTitle>
          </div>
          {/* Toggle Hoje / 7 dias */}
          <div className="inline-flex rounded-full border border-border p-0.5 bg-muted/40 flex-shrink-0">
            <button
              onClick={() => setView("hoje")}
              className={cn(
                "px-2.5 py-1 text-[11px] font-semibold rounded-full transition-colors flex items-center gap-1",
                view === "hoje"
                  ? "bg-mh-navy-700 text-white"
                  : "text-mh-ink-3 hover:text-mh-ink"
              )}
            >
              Hoje
              <span className={cn(
                "inline-flex items-center justify-center min-w-[16px] h-[14px] px-1 rounded-full text-[9px] font-bold",
                view === "hoje" ? "bg-white/20" : "bg-muted text-mh-ink-3"
              )}>
                {eventosHoje.length}
              </span>
            </button>
            <button
              onClick={() => setView("semana")}
              className={cn(
                "px-2.5 py-1 text-[11px] font-semibold rounded-full transition-colors flex items-center gap-1",
                view === "semana"
                  ? "bg-mh-navy-700 text-white"
                  : "text-mh-ink-3 hover:text-mh-ink"
              )}
            >
              7 dias
              <span className={cn(
                "inline-flex items-center justify-center min-w-[16px] h-[14px] px-1 rounded-full text-[9px] font-bold",
                view === "semana" ? "bg-white/20" : "bg-muted text-mh-ink-3"
              )}>
                {eventosSemana.length}
              </span>
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        ) : eventosExibidos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center gap-4">
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-mh-teal-500/10 border border-mh-teal-500/20">
                <CalendarCheck className="h-5 w-5 text-mh-teal-700" />
              </div>
              <div>
                <div className="font-serif-display text-base font-medium text-mh-ink">
                  {view === "hoje" ? "Agenda livre hoje" : "Próximos 7 dias livres"}
                </div>
                <p className="text-[11px] text-mh-ink-3 mt-0.5">
                  {view === "hoje"
                    ? "Sem compromissos marcados hoje."
                    : "Nenhum compromisso agendado nessa janela."}
                </p>
              </div>
            </div>

            {view === "hoje" && eventosSemana.length > 0 ? (
              <div className="w-full border rounded-lg p-3 bg-muted/30 text-left">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-1">
                  🔜 Próximo compromisso
                </p>
                <p className="text-sm font-semibold text-foreground truncate">
                  {eventosSemana[0].titulo}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {format(new Date(eventosSemana[0].data_hora_inicio), "EEEE, dd/MM 'às' HH:mm", { locale: ptBR })}
                </p>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs mt-1"
                  onClick={() => setView("semana")}
                >
                  Ver os próximos 7 dias →
                </Button>
              </div>
            ) : googleConectado === false ? (
              <div className="w-full border border-dashed rounded-lg p-3 bg-muted/30 text-left">
                <div className="flex items-start gap-2">
                  <Link2 className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-xs text-foreground font-medium">Conecte seu Google Calendar</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Sua agenda aparece aqui automaticamente.
                    </p>
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs mt-1"
                      onClick={() => navigate("/perfil")}
                    >
                      Ir para Perfil →
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : view === "hoje" ? (
          <div className="space-y-3">
            {eventosHoje.map((evento) => (
              <AgendaCard
                key={evento.id}
                titulo={evento.titulo}
                tipo_evento={evento.tipo_evento}
                data_hora_inicio={evento.data_hora_inicio}
                data_hora_fim={evento.data_hora_fim}
                status={evento.status}
                descricao={evento.descricao}
              />
            ))}
          </div>
        ) : (
          // 7 dias — agrupado por dia com separadores
          <div className="space-y-5">
            {eventosAgrupados?.map((grupo) => (
              <div key={grupo.label}>
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-mh-gold-600 mb-2 sticky top-0 bg-card pt-1 pb-1 z-10">
                  {grupo.label}
                  <span className="ml-1.5 text-mh-ink-4 font-medium normal-case tracking-normal">
                    · {grupo.eventos.length} {grupo.eventos.length === 1 ? "evento" : "eventos"}
                  </span>
                </div>
                <div className="space-y-2">
                  {grupo.eventos.map((evento) => (
                    <AgendaCard
                      key={evento.id}
                      titulo={evento.titulo}
                      tipo_evento={evento.tipo_evento}
                      data_hora_inicio={evento.data_hora_inicio}
                      data_hora_fim={evento.data_hora_fim}
                      status={evento.status}
                      descricao={evento.descricao}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
