import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AgendaCard } from "./AgendaCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "lucide-react";

export const AgendaList = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

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
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Calendar className="h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">Nenhum compromisso para hoje</p>
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
