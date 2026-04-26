import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { format, subDays, startOfDay, startOfMonth, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Send, Calendar, TrendingUp } from "lucide-react";

const COLORS = ["#3b82f6", "#f97316", "#22c55e", "#06b6d4", "#8b5cf6", "#ec4899"];

export const WeeklyMetrics = () => {
  // IMPORTANTE: manter essas datas estáveis para não trocar o queryKey a cada render
  // (isso causava refetch contínuo e deixava o card preso em skeleton/loading)
  const hoje = useMemo(() => startOfDay(new Date()), []);
  const inicioMes = useMemo(() => startOfMonth(hoje), [hoje]);
  // Bug anterior: tresDiasAtras como gte fazia totalMes contar só envios dos
  // últimos 3 dias (no mês inteiro). Agora pega o mês todo e usamos mesmo data
  // pra calcular cards diários (hoje/ontem/anteontem).

  const { data: enviosData, isLoading, isError } = useQuery({
    queryKey: ["envios-dashboard", inicioMes.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campanha_envios")
        .select("id, status, enviado_em, campanha_id, campanhas_disparo(nome, tipo)")
        .gte("enviado_em", inicioMes.toISOString())
        .eq("status", "enviado")
        .not("enviado_em", "is", null);

      if (error) throw error;
      return data || [];
    },
    retry: 1,
    staleTime: 30000,
  });

  const calcularEnviosPorDia = () => {
    if (!enviosData) return [];
    
    const diasMetricas = [];
    for (let i = 0; i < 3; i++) {
      const dia = subDays(hoje, i);
      const diaStr = format(dia, "yyyy-MM-dd");
      
      const enviosDoDia = enviosData.filter(e => {
        if (!e.enviado_em) return false;
        return format(new Date(e.enviado_em), "yyyy-MM-dd") === diaStr;
      });
      
      let label = format(dia, "dd/MM", { locale: ptBR });
      if (isToday(dia)) label = "Hoje";
      else if (isYesterday(dia)) label = "Ontem";
      
      diasMetricas.push({
        label,
        total: enviosDoDia.length,
        date: dia,
      });
    }
    return diasMetricas;
  };

  const calcularTiposDisparo = () => {
    if (!enviosData) return [];
    
    const tiposCount: Record<string, number> = {};
    
    enviosData.forEach(e => {
      const tipo = e.campanhas_disparo?.tipo || "Outros";
      tiposCount[tipo] = (tiposCount[tipo] || 0) + 1;
    });
    
    return Object.entries(tiposCount).map(([name, value]) => ({
      name: name === "massa" ? "Em Massa" : name === "automatico" ? "Automático" : name,
      value
    }));
  };

  // Total do mês: filtra apenas envios do mês atual
  const totalMes = enviosData?.filter(e => {
    if (!e.enviado_em) return false;
    return new Date(e.enviado_em) >= inicioMes;
  }).length || 0;
  const enviosPorDia = calcularEnviosPorDia();
  const tiposDisparo = calcularTiposDisparo();
  const mesAtual = format(hoje, "MMMM", { locale: ptBR });

  if (isLoading) {
    return (
      <Card className="overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-primary/10 to-primary/5 border-b py-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-primary" />
            Métricas de Disparos
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-primary/10 to-primary/5 border-b py-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-primary" />
            Métricas de Disparos
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <p className="text-center text-muted-foreground">Erro ao carregar métricas</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden shadow-sm">
      <CardHeader className="bg-gradient-to-r from-primary/10 to-primary/5 border-b py-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4 text-primary" />
          Métricas de Disparos
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Coluna Esquerda - Cards de métricas */}
          <div className="space-y-2">
            {/* Card Total do Mês */}
            <div className="bg-gradient-to-br from-primary to-primary/80 rounded-lg p-3 text-primary-foreground shadow-md">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs opacity-90 font-medium">
                    Total de {mesAtual.charAt(0).toUpperCase() + mesAtual.slice(1)}
                  </p>
                  <p className="text-2xl font-bold">{totalMes}</p>
                </div>
                <div className="bg-white/20 rounded-full p-2">
                  <Calendar className="h-4 w-4" />
                </div>
              </div>
            </div>
            
            {/* Cards por dia */}
            <div className="space-y-1.5">
              {enviosPorDia.map((item, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between border border-border rounded-lg p-2.5 bg-card hover:bg-accent/50 hover:border-primary/30 transition-all duration-200 group"
                >
                  <div className="flex items-center gap-2">
                    <div className="bg-primary/10 rounded p-1.5 group-hover:bg-primary/20 transition-colors">
                      <Send className="h-3 w-3 text-primary" />
                    </div>
                    <span className="text-sm text-muted-foreground font-medium">
                      Enviados {item.label}
                    </span>
                  </div>
                  <span className="text-lg font-bold text-foreground">{item.total}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Coluna Direita - Gráfico de Pizza */}
          <div className="flex flex-col bg-muted/30 rounded-lg p-3">
            <h3 className="text-sm font-semibold text-foreground mb-1 text-center">
              Tipos de Disparos
            </h3>
            
            {tiposDisparo.length > 0 ? (
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie
                    data={tiposDisparo}
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={55}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {tiposDisparo.map((_, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={COLORS[index % COLORS.length]}
                        stroke="none"
                      />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ 
                      borderRadius: '6px', 
                      border: 'none', 
                      boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                      fontSize: '12px'
                    }}
                  />
                  <Legend 
                    verticalAlign="bottom"
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: '11px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[150px] text-muted-foreground text-sm">
                Nenhum disparo este mês
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
