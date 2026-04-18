import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, UserCheck, UserX, Activity } from "lucide-react";
import type { HubSummary } from "@/hooks/useHubWhatsApp";

interface Props {
  data: HubSummary | undefined;
  activeContacts: number | undefined;
  isLoading: boolean;
}

const cards = [
  { key: "total", label: "Total de Contatos", icon: Users, color: "text-blue-600" },
  { key: "classified", label: "Classificados", icon: UserCheck, color: "text-green-600" },
  { key: "unclassified", label: "Sem Classificação", icon: UserX, color: "text-amber-600" },
  { key: "active", label: "Ativos (período)", icon: Activity, color: "text-purple-600" },
] as const;

export const HubSummaryCards = ({ data, activeContacts, isLoading }: Props) => {
  const values: Record<string, number> = {
    total: data?.total_contacts ?? 0,
    classified: data?.classified ?? 0,
    unclassified: data?.unclassified ?? 0,
    active: activeContacts ?? 0,
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <Card key={card.key}>
          <CardContent className="pt-6">
            {isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <div className="flex items-center gap-3">
                <div className={`rounded-lg bg-muted p-2.5 ${card.color}`}>
                  <card.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{values[card.key].toLocaleString("pt-BR")}</p>
                  <p className="text-xs text-muted-foreground">{card.label}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
