import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { 
  Users, 
  Target, 
  Send,
  CheckCircle, 
  XCircle, 
  ArrowRight,
  FileSpreadsheet,
  Ban
} from "lucide-react";
import DisparosTopNav from "@/components/DisparosTopNav";

interface Stats {
  totalLeads: number;
  totalCampanhas: number;
  enviados: number;
  falhas: number;
}

export default function DisparosEmMassa() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats>({
    totalLeads: 0,
    totalCampanhas: 0,
    enviados: 0,
    falhas: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    setLoading(true);
    
    const [leadsRes, campanhasRes] = await Promise.all([
      supabase.from("leads").select("id", { count: "exact", head: true }),
      supabase.from("campanhas_disparo").select("sucesso, falhas")
    ]);

    const enviados = campanhasRes.data?.reduce((acc, c) => acc + (c.sucesso || 0), 0) || 0;
    const falhas = campanhasRes.data?.reduce((acc, c) => acc + (c.falhas || 0), 0) || 0;

    setStats({
      totalLeads: leadsRes.count || 0,
      totalCampanhas: campanhasRes.data?.length || 0,
      enviados,
      falhas
    });
    setLoading(false);
  };

  const menuItems = [
    {
      title: "Leads",
      description: "Importe e gerencie sua base de leads com tipos, anotações e histórico de campanhas",
      icon: Users,
      path: "/disparos-em-massa/leads",
      color: "text-blue-500",
      bgColor: "bg-blue-500/10"
    },
    {
      title: "Campanhas",
      description: "Crie campanhas de relacionamento, captação, reativação e promocionais",
      icon: Target,
      path: "/disparos-em-massa/campanhas",
      color: "text-purple-500",
      bgColor: "bg-purple-500/10"
    },
    {
      title: "Envios",
      description: "Configure e agende disparos com regras anti-bloqueio (70/dia, intervalos aleatórios)",
      icon: Send,
      path: "/disparos-em-massa/envios",
      color: "text-green-500",
      bgColor: "bg-green-500/10"
    },
    {
      title: "Blacklist",
      description: "Gerencie leads bloqueados que nunca receberão disparos em massa",
      icon: Ban,
      path: "/disparos-em-massa/blacklist",
      color: "text-red-500",
      bgColor: "bg-red-500/10"
    }
  ];

  return (
    <div className="p-4 md:p-6">
      <DisparosTopNav />
      <div className="max-w-6xl mx-auto space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Disparos em Massa</h1>
            <p className="text-muted-foreground mt-1">
              Gerencie leads, campanhas e envios em massa
            </p>
          </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <Card>
            <CardContent className="pt-4 md:pt-6">
              <div className="flex items-center gap-3 md:gap-4">
                <Users className="h-6 w-6 md:h-8 md:w-8 text-primary flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xl md:text-2xl font-bold">{stats.totalLeads}</p>
                  <p className="text-xs md:text-sm text-muted-foreground truncate">Leads</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 md:pt-6">
              <div className="flex items-center gap-3 md:gap-4">
                <Target className="h-6 w-6 md:h-8 md:w-8 text-purple-500 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xl md:text-2xl font-bold">{stats.totalCampanhas}</p>
                  <p className="text-xs md:text-sm text-muted-foreground truncate">Campanhas</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 md:pt-6">
              <div className="flex items-center gap-3 md:gap-4">
                <CheckCircle className="h-6 w-6 md:h-8 md:w-8 text-green-500 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xl md:text-2xl font-bold">{stats.enviados}</p>
                  <p className="text-xs md:text-sm text-muted-foreground truncate">Enviados</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 md:pt-6">
              <div className="flex items-center gap-3 md:gap-4">
                <XCircle className="h-6 w-6 md:h-8 md:w-8 text-red-500 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xl md:text-2xl font-bold">{stats.falhas}</p>
                  <p className="text-xs md:text-sm text-muted-foreground truncate">Falhas</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Navigation Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {menuItems.map((item) => (
            <Card 
              key={item.path}
              className="cursor-pointer hover:shadow-lg transition-all hover:scale-[1.02] group"
              onClick={() => navigate(item.path)}
            >
              <CardHeader className="pb-3">
                <div className={`w-12 h-12 rounded-lg ${item.bgColor} flex items-center justify-center mb-3`}>
                  <item.icon className={`h-6 w-6 ${item.color}`} />
                </div>
                <CardTitle className="flex items-center justify-between">
                  {item.title}
                  <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:translate-x-1 transition-transform" />
                </CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>

        {/* Quick Info */}
        <Card className="bg-muted/50 border-dashed">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <FileSpreadsheet className="h-6 w-6 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p className="font-medium">Como funciona</p>
                <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>Importe seus leads via CSV na página de <strong>Leads</strong></li>
                  <li>Crie campanhas com mensagens personalizadas em <strong>Campanhas</strong></li>
                  <li>Configure e agende os disparos em <strong>Envios</strong></li>
                </ol>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
