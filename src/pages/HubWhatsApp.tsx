import { useState, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Network, Search, Route } from "lucide-react";
import { useHubSummary, useHubActivity, useHubFilter, type HubFilterParams } from "@/hooks/useHubWhatsApp";
import { HubSummaryCards } from "@/components/hub-whatsapp/HubSummaryCards";
import { HubProfileChart } from "@/components/hub-whatsapp/HubProfileChart";
import { HubActivityTimeline } from "@/components/hub-whatsapp/HubActivityTimeline";
import { HubInstanceStats } from "@/components/hub-whatsapp/HubInstanceStats";
import { HubUnclassifiedBanner } from "@/components/hub-whatsapp/HubUnclassifiedBanner";
import { HubContactFilter } from "@/components/hub-whatsapp/HubContactFilter";
import { HubFilterResults } from "@/components/hub-whatsapp/HubFilterResults";
import { HubRoteamentoConfig } from "@/components/hub-whatsapp/HubRoteamentoConfig";

const HubWhatsApp = () => {
  const [days, setDays] = useState(30);
  const [activeTab, setActiveTab] = useState("overview");
  const [filterParams, setFilterParams] = useState<HubFilterParams>({});
  const [filterEnabled, setFilterEnabled] = useState(false);

  const { data: summary, isLoading: summaryLoading } = useHubSummary();
  const { data: activity, isLoading: activityLoading } = useHubActivity(days);
  const { data: filterResult, isLoading: filterLoading } = useHubFilter(filterParams, filterEnabled);

  const handleFilter = useCallback((params: HubFilterParams) => {
    setFilterParams({ ...params, limit: 50, offset: 0 });
    setFilterEnabled(true);
  }, []);

  const handleClearFilter = useCallback(() => {
    setFilterParams({});
    setFilterEnabled(false);
  }, []);

  const handlePageChange = useCallback((offset: number) => {
    setFilterParams((prev) => ({ ...prev, offset }));
  }, []);

  const handlePerfilClick = useCallback((perfil: string) => {
    setActiveTab("search");
    // Aciona o filtro do componente HubContactFilter
    setTimeout(() => {
      (window as any).__hubSetPerfil?.(perfil);
      handleFilter({ perfil, limit: 50, offset: 0 });
    }, 100);
  }, [handleFilter]);

  return (
    <div className="h-[calc(100vh-4rem)] bg-background p-4 md:p-6 overflow-y-auto">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Network className="h-6 w-6 text-primary" />
            Hub WhatsApp
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Central de inteligência dos seus contatos em todos os números
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview" className="gap-1.5">
              <Network className="h-3.5 w-3.5" />
              Visão Geral
            </TabsTrigger>
            <TabsTrigger value="search" className="gap-1.5">
              <Search className="h-3.5 w-3.5" />
              Busca Inteligente
            </TabsTrigger>
            <TabsTrigger value="routing" className="gap-1.5">
              <Route className="h-3.5 w-3.5" />
              Roteamento
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Visão Geral */}
          <TabsContent value="overview" className="space-y-6 mt-4">
            <HubSummaryCards
              data={summary}
              activeContacts={activity?.active_contacts}
              isLoading={summaryLoading || activityLoading}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <HubProfileChart
                data={summary?.by_profile}
                isLoading={summaryLoading}
                onPerfilClick={handlePerfilClick}
              />
              <HubActivityTimeline
                data={activity}
                isLoading={activityLoading}
                days={days}
                onDaysChange={setDays}
              />
            </div>

            <div>
              <h3 className="text-sm font-medium mb-3">Por Instância</h3>
              <HubInstanceStats data={summary} isLoading={summaryLoading} />
            </div>

            <HubUnclassifiedBanner count={summary?.unclassified ?? 0} />
          </TabsContent>

          {/* Tab 2: Busca Inteligente */}
          <TabsContent value="search" className="space-y-4 mt-4">
            <HubContactFilter onFilter={handleFilter} onClear={handleClearFilter} />
            <HubFilterResults
              data={filterResult}
              isLoading={filterLoading}
              params={filterParams}
              onPageChange={handlePageChange}
            />
          </TabsContent>

          {/* Tab 3: Roteamento */}
          <TabsContent value="routing" className="space-y-4 mt-4">
            <HubRoteamentoConfig />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default HubWhatsApp;
