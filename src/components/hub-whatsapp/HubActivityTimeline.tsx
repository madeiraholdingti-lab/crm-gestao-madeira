import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { HubActivity } from "@/hooks/useHubWhatsApp";

interface Props {
  data: HubActivity | undefined;
  isLoading: boolean;
  days: number;
  onDaysChange: (days: number) => void;
}

const PERIOD_OPTIONS = [30, 60, 90] as const;

export const HubActivityTimeline = ({ data, isLoading, days, onDaysChange }: Props) => {
  const chartData = (data?.timeline || []).map((d) => ({
    date: format(parseISO(d.date), "dd/MM", { locale: ptBR }),
    conversas: d.conversations,
  }));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-medium">Atividade</CardTitle>
          {data && (
            <Badge variant="secondary" className="text-xs">
              {data.active_contacts.toLocaleString("pt-BR")} contatos ativos
            </Badge>
          )}
        </div>
        <div className="flex gap-1">
          {PERIOD_OPTIONS.map((d) => (
            <Button
              key={d}
              size="sm"
              variant={days === d ? "default" : "ghost"}
              onClick={() => onDaysChange(d)}
              className="h-7 text-xs"
            >
              {d}d
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[280px] w-full" />
        ) : chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">Sem dados no período</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                interval={Math.max(Math.floor(chartData.length / 10), 0)}
              />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="conversas"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                name="Conversas"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
};
