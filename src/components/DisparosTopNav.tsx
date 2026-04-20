import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Users, Target, Send, Home, Ban } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Sub-nav do módulo Disparos — tab com underline dourado no ativo
 * + contadores reais por recurso. Identidade Madeira Holding.
 */
const menuItems = [
  { title: "Visão Geral", path: "/disparos-em-massa", icon: Home, exact: true, countKey: null as null | "leads" | "campanhas" | "envios" | "blacklist" },
  { title: "Leads", path: "/disparos-em-massa/leads", icon: Users, exact: false, countKey: "leads" as const },
  { title: "Campanhas", path: "/disparos-em-massa/campanhas", icon: Target, exact: false, countKey: "campanhas" as const },
  { title: "Envios", path: "/disparos-em-massa/envios", icon: Send, exact: false, countKey: "envios" as const },
  { title: "Blacklist", path: "/disparos-em-massa/blacklist", icon: Ban, exact: false, countKey: "blacklist" as const },
];

async function fetchCounts() {
  const [leads, campanhas, envios, blacklist] = await Promise.all([
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("ativo", true),
    supabase.from("campanhas_disparo").select("id", { count: "exact", head: true }),
    supabase.from("campanha_envios").select("id", { count: "exact", head: true }),
    supabase.from("lead_blacklist").select("id", { count: "exact", head: true }),
  ]);
  return {
    leads: leads.count ?? 0,
    campanhas: campanhas.count ?? 0,
    envios: envios.count ?? 0,
    blacklist: blacklist.count ?? 0,
  };
}

function formatCount(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

export default function DisparosTopNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: counts } = useQuery({
    queryKey: ["disparos-topnav-counts"],
    queryFn: fetchCounts,
    staleTime: 60_000,
  });

  const isActive = (path: string, exact: boolean) =>
    exact ? location.pathname === path : location.pathname.startsWith(path);

  return (
    <nav className="sticky top-0 z-30 bg-card border-b border-border -mx-4 md:-mx-6 px-4 md:px-6 mb-4">
      <div className="flex items-end gap-0.5 overflow-x-auto scrollbar-none">
        {menuItems.map((item) => {
          const active = isActive(item.path, item.exact);
          const count = item.countKey && counts ? counts[item.countKey] : null;

          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                "group inline-flex items-center gap-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors relative whitespace-nowrap -mb-px border-b-2",
                active
                  ? "border-mh-gold-500 text-mh-ink font-semibold"
                  : "border-transparent text-mh-ink-3 hover:text-mh-ink hover:bg-muted/40"
              )}
            >
              <item.icon className={cn("h-3.5 w-3.5", active && "text-mh-navy-700")} />
              {item.title}
              {count !== null && count > 0 && (
                <span
                  className={cn(
                    "inline-flex items-center justify-center min-w-[20px] h-[18px] rounded-full px-1.5 text-[10px] font-semibold",
                    active
                      ? "bg-mh-navy-700 text-white"
                      : "bg-muted text-mh-ink-3"
                  )}
                >
                  {formatCount(count)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
