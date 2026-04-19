import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AgendaCard } from "./AgendaCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, CalendarCheck, Link2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

export const AgendaList = () => {
  const navigate = useNavigate();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const em7dias = new Date(today);
  em7dias.setDate(em7dias.getDate() + 7);

  // Eventos do dia corrente
  const { data: eventosHoje, isLoading } = useQuery({
    queryKey: ["agenda-hoje"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { data, error } = await supabase
        .from("eventos_agenda")
        .select("*")
        .eq("medico_id", user.id)
        .gte("data_hora_inicio", today.toISOString())
        .lt("data_hora_inicio", tomorrow.toISOString())
        .order("data_hora_inicio", { ascending: true });

      if (error) throw error;
      return data;
    },
  });

  // Próximo evento nos próximos 7 dias (só busca se não há eventos hoje).
  // Usado pra preencher o estado vazio com algo útil em vez de "nenhum compromisso".
  const { data: proximoEvento } = useQuery({
    queryKey: ["agenda-proximo"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data } = await supabase
        .from("eventos_agenda")
        .select("titulo, data_hora_inicio, tipo_evento")
        .eq("medico_id", user.id)
        .gte("data_hora_inicio", tomorrow.toISOString())
        .lt("data_hora_inicio", em7dias.toISOString())
        .order("data_hora_inicio", { ascending: true })
        .limit(1)
        .maybeSingle();

      return data;
    },
    // só roda depois de saber que hoje está vazio (economiza query)
    enabled: !isLoading && (!eventosHoje || eventosHoje.length === 0),
  });

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
    enabled: !isLoading && (!eventosHoje || eventosHoje.length === 0),
  });

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="py-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">Agenda do Dia - Dr. Maikon</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        ) : !eventosHoje || eventosHoje.length === 0 ? (
          // Estado vazio enriquecido: mostra o próximo compromisso se houver,
          // ou CTA pra conectar Google Calendar se ainda não tem contas ativas.
          <div className="flex flex-col items-center justify-center py-8 text-center gap-4">
            <div className="flex flex-col items-center gap-2">
              <CalendarCheck className="h-10 w-10 text-green-600" />
              <p className="text-sm font-medium text-foreground">Sem compromissos hoje</p>
            </div>

            {proximoEvento ? (
              <div className="w-full border rounded-lg p-3 bg-muted/30 text-left">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-1">
                  🔜 Próximo compromisso
                </p>
                <p className="text-sm font-semibold text-foreground truncate">
                  {proximoEvento.titulo}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {format(new Date(proximoEvento.data_hora_inicio), "EEEE, dd/MM 'às' HH:mm", { locale: ptBR })}
                </p>
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
            ) : (
              <p className="text-xs text-muted-foreground">
                Nenhum compromisso nos próximos 7 dias.
              </p>
            )}
          </div>
        ) : (
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
        )}
      </CardContent>
    </Card>
  );
};
