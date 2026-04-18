import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { PERFIS_PROFISSIONAIS } from "@/utils/constants";

const COLORS = [
  "#3b82f6", "#22c55e", "#f97316", "#8b5cf6", "#ec4899",
  "#06b6d4", "#eab308", "#ef4444", "#14b8a6", "#f43f5e",
  "#6366f1", "#84cc16", "#a855f7",
];

interface Props {
  data: { perfil: string; total: number }[] | undefined;
  isLoading: boolean;
  onPerfilClick?: (perfil: string) => void;
}

const getLabel = (value: string) => {
  const found = PERFIS_PROFISSIONAIS.find((p) => p.value === value);
  return found ? found.label : value === "nao_classificado" ? "Não classificado" : value;
};

export const HubProfileChart = ({ data, isLoading, onPerfilClick }: Props) => {
  const [view, setView] = useState<"pie" | "bar">("pie");

  const chartData = (data || []).map((d, i) => ({
    name: getLabel(d.perfil),
    value: d.total,
    perfil: d.perfil,
    fill: COLORS[i % COLORS.length],
  }));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">Contatos por Perfil</CardTitle>
        <div className="flex gap-1">
          <Button size="sm" variant={view === "pie" ? "default" : "ghost"} onClick={() => setView("pie")} className="h-7 text-xs">
            Pizza
          </Button>
          <Button size="sm" variant={view === "bar" ? "default" : "ghost"} onClick={() => setView("bar")} className="h-7 text-xs">
            Barras
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[280px] w-full" />
        ) : chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">Sem dados</p>
        ) : view === "pie" ? (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                outerRadius={100}
                dataKey="value"
                label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                onClick={(entry) => onPerfilClick?.(entry.perfil)}
                className="cursor-pointer"
              >
                {chartData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => value.toLocaleString("pt-BR")} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 100 }}>
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={95} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value: number) => value.toLocaleString("pt-BR")} />
              <Bar
                dataKey="value"
                radius={[0, 4, 4, 0]}
                onClick={(entry) => onPerfilClick?.(entry.perfil)}
                className="cursor-pointer"
              >
                {chartData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
};
