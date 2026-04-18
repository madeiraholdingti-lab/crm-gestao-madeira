import { WeeklyMetrics } from "@/components/WeeklyMetrics";
import { AgendaList } from "@/components/AgendaList";
import { TasksSummary } from "@/components/TasksSummary";
import { BriefingIA } from "@/components/BriefingIA";
import { MonitorSecretarias } from "@/components/MonitorSecretarias";
import { IndicadoresSecretarias } from "@/components/IndicadoresSecretarias";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const Home = () => {
  const { profile } = useCurrentUser();
  const isAdminOrMedico = profile?.role === "admin_geral" || profile?.role === "medico";
  const isDisparador = profile?.role === "disparador";

  return (
    <div className="h-[calc(100vh-4rem)] bg-background p-4 overflow-y-auto">
      <div className="flex flex-col gap-4">
        {/* Briefing IA — topo, só admin/medico */}
        {isAdminOrMedico && (
          <BriefingIA />
        )}

        {/* Monitor de Secretárias + Agenda */}
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
          {/* Monitor — esquerda */}
          {!isDisparador && (
            <MonitorSecretarias />
          )}

          {/* Agenda — direita */}
          <div className={!isDisparador ? "" : "lg:col-span-full"}>
            <AgendaList />
          </div>
        </div>

        {/* Indicadores de tarefas por secretária */}
        {!isDisparador && (
          <IndicadoresSecretarias />
        )}

        {/* Métricas + Tarefas — embaixo */}
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
          <WeeklyMetrics />
          <TasksSummary />
        </div>
      </div>
    </div>
  );
};

export default Home;
