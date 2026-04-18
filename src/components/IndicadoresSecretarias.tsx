import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { BarChart3, CheckCircle2, Clock, AlertTriangle, ListTodo } from "lucide-react";
import { startOfDay, startOfWeek, startOfMonth, isPast, isToday } from "date-fns";

type Periodo = "hoje" | "semana" | "mes";

interface TaskFlowProfile {
  id: string;
  nome: string;
  cor: string;
  user_id: string | null;
}

interface TaskData {
  id: string;
  responsavel_id: string;
  column_id: string;
  prazo: string | null;
  created_at: string;
  updated_at: string;
  column_nome: string;
}

export const IndicadoresSecretarias = () => {
  const { profile: currentUser } = useCurrentUser();
  const [periodo, setPeriodo] = useState<Periodo>("semana");

  const isSecretaria = currentUser?.role === "secretaria_medica";
  const isDisparador = currentUser?.role === "disparador";

  // Buscar perfis do TaskFlow
  const { data: profiles } = useQuery({
    queryKey: ["indicadores-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_flow_profiles")
        .select("id, nome, cor, user_id")
        .eq("ativo", true);
      if (error) throw error;
      return (data || []) as TaskFlowProfile[];
    },
  });

  // Buscar tarefas não deletadas
  const { data: tasks, isLoading } = useQuery({
    queryKey: ["indicadores-tasks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_flow_tasks")
        .select(`
          id, responsavel_id, column_id, prazo, created_at, updated_at,
          task_flow_columns(nome)
        `)
        .is("deleted_at", null);
      if (error) throw error;
      return (data || []).map((t: any) => ({
        id: t.id,
        responsavel_id: t.responsavel_id,
        column_id: t.column_id,
        prazo: t.prazo,
        created_at: t.created_at,
        updated_at: t.updated_at,
        column_nome: t.task_flow_columns?.nome || "",
      })) as TaskData[];
    },
    refetchInterval: 120000, // 2 minutos (era 30s)
  });

  const dataInicio = useMemo(() => {
    const agora = new Date();
    switch (periodo) {
      case "hoje": return startOfDay(agora);
      case "semana": return startOfWeek(agora, { weekStartsOn: 1 });
      case "mes": return startOfMonth(agora);
    }
  }, [periodo]);

  // Calcular métricas por perfil
  const cards = useMemo(() => {
    if (!profiles || !tasks) return [];

    // Secretária vê apenas seu próprio perfil
    const filteredProfiles = isSecretaria && currentUser?.id
      ? profiles.filter(p => p.user_id === currentUser.id)
      : profiles;

    return filteredProfiles.map(profile => {
      const perfilTasks = tasks.filter(t => t.responsavel_id === profile.id);

      const concluidas = perfilTasks.filter(
        t => t.column_nome === "Finalizada" && new Date(t.updated_at) >= dataInicio
      ).length;

      const emAndamento = perfilTasks.filter(
        t => t.column_nome !== "Finalizada"
      ).length;

      const atrasadas = perfilTasks.filter(
        t => t.prazo && isPast(new Date(t.prazo)) && !isToday(new Date(t.prazo)) && t.column_nome !== "Finalizada"
      ).length;

      const criadasNoPeriodo = perfilTasks.filter(
        t => new Date(t.created_at) >= dataInicio
      ).length;

      return {
        profile,
        concluidas,
        emAndamento,
        atrasadas,
        criadasNoPeriodo,
      };
    }).sort((a, b) => b.concluidas - a.concluidas);
  }, [profiles, tasks, dataInicio, isSecretaria, currentUser]);

  if (isDisparador) return null;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="py-3">
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="p-4">
          <Skeleton className="h-24" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="bg-gradient-to-r from-indigo-500/10 to-indigo-500/5 border-b py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4" />
            Produtividade — Tarefas
          </CardTitle>
          <div className="flex gap-1">
            {(["hoje", "semana", "mes"] as Periodo[]).map(p => (
              <Badge
                key={p}
                variant={periodo === p ? "default" : "outline"}
                className="cursor-pointer text-[10px] capitalize"
                onClick={() => setPeriodo(p)}
              >
                {p === "mes" ? "mês" : p}
              </Badge>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        {cards.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Nenhum perfil de tarefas encontrado
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {cards.map(({ profile, concluidas, emAndamento, atrasadas, criadasNoPeriodo }) => (
              <div
                key={profile.id}
                className="rounded-lg border p-3 space-y-2"
                style={{ borderLeftColor: profile.cor, borderLeftWidth: "4px" }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: profile.cor }}
                  />
                  <span className="font-medium text-sm truncate">{profile.nome}</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-1.5 text-xs">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    <span className="font-semibold text-green-700">{concluidas}</span>
                    <span className="text-muted-foreground">concluídas</span>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs">
                    <ListTodo className="h-3.5 w-3.5 text-blue-500" />
                    <span className="font-semibold text-blue-700">{criadasNoPeriodo}</span>
                    <span className="text-muted-foreground">criadas</span>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs">
                    <Clock className="h-3.5 w-3.5 text-amber-500" />
                    <span className="font-semibold text-amber-700">{emAndamento}</span>
                    <span className="text-muted-foreground">abertas</span>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                    <span className={`font-semibold ${atrasadas > 0 ? "text-red-700" : "text-muted-foreground"}`}>
                      {atrasadas}
                    </span>
                    <span className="text-muted-foreground">atrasadas</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
