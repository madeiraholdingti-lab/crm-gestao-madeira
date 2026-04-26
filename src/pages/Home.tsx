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

  const now = new Date();
  const hora = now.getHours();
  const saudacao = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  const dataFmt = now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  // Trata nomes técnicos ("madeira.holding.ti", "user_admin") com fallback amigável.
  // Pega 1º nome real e capitaliza.
  const rawNome = ((profile as { nome?: string } | null)?.nome ?? "").trim();
  const ehNomeTecnico = rawNome.length > 0 && !/\s/.test(rawNome) && /[._-]/.test(rawNome);
  const primeiroNome = rawNome.split(/\s+/)[0] || "";
  const nomeCurto = ehNomeTecnico || !primeiroNome
    ? "Doutor"
    : primeiroNome.charAt(0).toUpperCase() + primeiroNome.slice(1).toLowerCase();

  return (
    <div className="h-[calc(100vh-4rem)] bg-background p-4 overflow-y-auto">
      <div className="flex flex-col gap-4">
        {/* Cabeçalho institucional — serif display + data, identidade Madeira Holding */}
        {isAdminOrMedico && (
          <div className="flex flex-col gap-1 px-1 pt-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-mh-ink-3">
              {saudacao}, {nomeCurto} · {dataFmt}
            </div>
            <h1 className="font-serif-display text-2xl sm:text-3xl font-medium text-mh-ink leading-tight">
              Panorama do consultório
            </h1>
          </div>
        )}

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
