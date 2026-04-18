import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, MessageSquare, Target, CheckCircle, XCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export const DashboardStats = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Buscar eventos do dia
  const { data: eventosHoje, isLoading: loadingEventos } = useQuery({
    queryKey: ["eventos-hoje"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eventos_agenda")
        .select("*")
        .gte("data_hora_inicio", today.toISOString())
        .lt("data_hora_inicio", tomorrow.toISOString());
      
      if (error) throw error;
      return data;
    },
  });

  // Buscar conversas de hoje
  const { data: conversasHoje, isLoading: loadingConversas } = useQuery({
    queryKey: ["conversas-hoje"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversas")
        .select("*")
        .gte("created_at", today.toISOString())
        .lt("created_at", tomorrow.toISOString());
      
      if (error) throw error;
      return data;
    },
  });

  // Calcular estatísticas
  const consultasConfirmadas = eventosHoje?.filter(e => e.status === "confirmado" && e.tipo_evento === "consulta").length || 0;
  const consultasRealizadas = eventosHoje?.filter(e => e.status === "concluido" && e.tipo_evento === "consulta").length || 0;
  const consultasCanceladas = eventosHoje?.filter(e => e.status === "cancelado" && e.tipo_evento === "consulta").length || 0;
  const novosLeads = conversasHoje?.length || 0;
  const atendimentosEmProgresso = conversasHoje?.filter(c => c.status === "em_andamento").length || 0;

  const stats = [
    {
      title: "Consultas Confirmadas",
      value: consultasConfirmadas,
      icon: Calendar,
      color: "text-blue-600",
      bgColor: "bg-blue-50",
    },
    {
      title: "Consultas Realizadas",
      value: consultasRealizadas,
      icon: CheckCircle,
      color: "text-green-600",
      bgColor: "bg-green-50",
    },
    {
      title: "Consultas Canceladas",
      value: consultasCanceladas,
      icon: XCircle,
      color: "text-red-600",
      bgColor: "bg-red-50",
    },
    {
      title: "Novos Leads WhatsApp",
      value: novosLeads,
      icon: MessageSquare,
      color: "text-purple-600",
      bgColor: "bg-purple-50",
    },
    {
      title: "Atendimentos em Progresso",
      value: atendimentosEmProgresso,
      icon: Target,
      color: "text-orange-600",
      bgColor: "bg-orange-50",
    },
  ];

  if (loadingEventos || loadingConversas) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Dashboard do Dia</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dashboard do Dia - Dr. Maikon</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {stats.map((stat) => (
            <div
              key={stat.title}
              className={`${stat.bgColor} rounded-lg p-4 flex flex-col items-center justify-center text-center transition-transform hover:scale-105`}
            >
              <stat.icon className={`h-8 w-8 ${stat.color} mb-2`} />
              <p className="text-2xl font-bold text-foreground">{stat.value}</p>
              <p className="text-sm text-muted-foreground mt-1">{stat.title}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
