import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Smartphone } from "lucide-react";
import type { HubSummary } from "@/hooks/useHubWhatsApp";

interface Props {
  data: HubSummary | undefined;
  isLoading: boolean;
}

export const HubInstanceStats = ({ data, isLoading }: Props) => {
  const instances = data?.by_instance || [];

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-48 shrink-0" />
        ))}
      </div>
    );
  }

  if (instances.length === 0) {
    return null;
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {instances.map((inst) => (
        <Card key={inst.instance_id} className="shrink-0 min-w-[180px]">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-2">
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: inst.cor || "#6b7280" }}
              />
              <span className="text-sm font-medium truncate">{inst.nome}</span>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Smartphone className="h-3 w-3" />
                <span>{inst.contact_count.toLocaleString("pt-BR")} contatos</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {inst.conversa_count.toLocaleString("pt-BR")} conversas
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
