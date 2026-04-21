import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import {
  Users,
  Target,
  Send,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Ban,
} from "lucide-react";
import DisparosTopNav from "@/components/DisparosTopNav";
import { ChipSaudeCard } from "@/components/disparos/ChipSaudeCard";

interface Stats {
  totalLeads: number;
  totalCampanhas: number;
  enviados: number;
  falhas: number;
}

interface MenuItem {
  title: string;
  description: string;
  icon: typeof Users;
  path: string;
  accent: "navy" | "gold" | "teal" | "red";
}

const MENU: MenuItem[] = [
  { title: "Leads", description: "Base de contatos, importação CSV, enriquecimento e histórico por campanha.", icon: Users, path: "/disparos-em-massa/leads", accent: "navy" },
  { title: "Campanhas", description: "Mensagens, filtros por perfil/especialidade/UF e chips rotativos anti-ban.", icon: Target, path: "/disparos-em-massa/campanhas", accent: "gold" },
  { title: "Envios", description: "Agendamento + regras de disparo (70/dia, intervalos aleatórios).", icon: Send, path: "/disparos-em-massa/envios", accent: "teal" },
  { title: "Blacklist", description: "Contatos bloqueados que nunca recebem disparos em massa.", icon: Ban, path: "/disparos-em-massa/blacklist", accent: "red" },
];

const ACCENT_MAP = {
  navy: { ring: "border-mh-navy-700", bg: "bg-mh-navy-700/10", text: "text-mh-navy-700", hero: "mh-gradient-hero text-mh-gold-100" },
  gold: { ring: "border-mh-gold-500", bg: "bg-mh-gold-100", text: "text-mh-gold-700", hero: "mh-gradient-gold text-mh-navy-950" },
  teal: { ring: "border-mh-teal-600", bg: "bg-mh-teal-500/10", text: "text-mh-teal-700", hero: "bg-mh-teal-700 text-white" },
  red: { ring: "border-destructive", bg: "bg-destructive/10", text: "text-destructive", hero: "bg-destructive text-white" },
};

export default function DisparosEmMassa() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats>({ totalLeads: 0, totalCampanhas: 0, enviados: 0, falhas: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [leadsRes, campanhasRes] = await Promise.all([
        supabase.from("leads").select("id", { count: "exact", head: true }),
        supabase.from("campanhas_disparo").select("sucesso, falhas"),
      ]);
      const enviados = campanhasRes.data?.reduce((acc, c: { sucesso: number | null }) => acc + (c.sucesso || 0), 0) || 0;
      const falhas = campanhasRes.data?.reduce((acc, c: { falhas: number | null }) => acc + (c.falhas || 0), 0) || 0;
      setStats({ totalLeads: leadsRes.count || 0, totalCampanhas: campanhasRes.data?.length || 0, enviados, falhas });
      setLoading(false);
    })();
  }, []);

  const kpis = [
    { label: "Leads ativos", value: stats.totalLeads, icon: Users, tone: "text-mh-navy-700" },
    { label: "Campanhas", value: stats.totalCampanhas, icon: Target, tone: "text-mh-gold-700" },
    { label: "Enviados", value: stats.enviados, icon: CheckCircle2, tone: "text-mh-teal-700" },
    { label: "Falhas", value: stats.falhas, icon: XCircle, tone: "text-destructive" },
  ];

  return (
    <div className="p-4 md:p-6">
      <DisparosTopNav />
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Cabeçalho institucional */}
        <div className="flex flex-col gap-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mh-gold-600">
            Operação · Disparos em Massa
          </div>
          <h1 className="font-serif-display text-2xl md:text-3xl font-medium text-mh-ink leading-tight">
            Prospecção e relacionamento em escala
          </h1>
          <p className="text-sm text-mh-ink-3 mt-1 max-w-2xl">
            Gerencie leads, campanhas multi-canal e envios com regras anti-ban — tudo integrado aos chips conectados.
          </p>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {kpis.map((k) => (
            <Card key={k.label} className="border-border/60">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start gap-3">
                  <div className="bg-muted/60 rounded-lg p-2 flex-shrink-0">
                    <k.icon className={`h-4 w-4 ${k.tone}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mh-ink-3">{k.label}</div>
                    <div className={`font-serif-display text-2xl font-medium mt-0.5 ${k.tone} tabular-nums`}>
                      {loading ? "—" : k.value.toLocaleString("pt-BR")}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Cards de navegação */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {MENU.map((item) => {
            const a = ACCENT_MAP[item.accent];
            return (
              <Card
                key={item.path}
                className={`cursor-pointer hover:shadow-md transition-all border overflow-hidden group relative hover:${a.ring}`}
                onClick={() => navigate(item.path)}
              >
                <CardContent className="p-0">
                  <div className="flex items-stretch">
                    <div className={`${a.hero} w-20 flex items-center justify-center flex-shrink-0`}>
                      <item.icon className="h-7 w-7" strokeWidth={1.5} />
                    </div>
                    <div className="flex-1 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-serif-display text-lg font-medium text-mh-ink leading-tight">
                            {item.title}
                          </h3>
                          <p className="text-[13px] text-mh-ink-3 mt-1 leading-snug">
                            {item.description}
                          </p>
                        </div>
                        <ArrowRight className="h-4 w-4 text-mh-ink-4 group-hover:text-mh-navy-700 group-hover:translate-x-0.5 transition-all flex-shrink-0 mt-1" />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Saúde dos chips — observabilidade do engine v2 */}
        <ChipSaudeCard />

        {/* Como funciona — estilo briefing institucional */}
        <Card className="border-mh-navy-700/20 bg-mh-navy-50">
          <CardContent className="pt-5 pb-5">
            <div className="flex items-start gap-4">
              <div className="mh-gradient-gold h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0">
                <Send className="h-4 w-4 text-mh-navy-950" />
              </div>
              <div className="space-y-2 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-mh-gold-700">
                  Fluxo recomendado
                </div>
                <ol className="text-sm text-mh-ink-2 space-y-1.5 list-decimal list-inside marker:text-mh-gold-600 marker:font-semibold">
                  <li>Importe leads via CSV na aba <strong className="text-mh-navy-700">Leads</strong></li>
                  <li>Crie campanhas com filtros e mensagens em <strong className="text-mh-navy-700">Campanhas</strong></li>
                  <li>Agende o disparo em <strong className="text-mh-navy-700">Envios</strong> — múltiplos chips rotativos evitam bloqueio</li>
                  <li>Acompanhe resultado em tempo real e bloqueie contatos indesejados em <strong className="text-mh-navy-700">Blacklist</strong></li>
                </ol>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
