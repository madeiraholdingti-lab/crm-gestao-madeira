import { NavLink, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  MessageSquare,
  UserCircle,
  Users,
  Settings,
  BarChart3,
  LogOut,
  Menu,
  Target,
  LayoutDashboard,
  UserCog,
  Clock,
  Send,
  ClipboardList,
  BrainCircuit,
  Network,
} from "lucide-react";
import { MHMark } from "@/components/MHMark";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { NotificationsDropdown } from "@/components/NotificationsDropdown";

interface UserRole {
  role: string;
}

export function Navbar() {
  const navigate = useNavigate();
  const { state, toggleSidebar } = useSidebar();
  const [userRole, setUserRole] = useState<string>("");

  useEffect(() => {
    const fetchUserRole = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: roleData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .single();
        
        if (roleData) {
          setUserRole((roleData as UserRole).role);
        }
      }
    };
    
    fetchUserRole();
  }, []);

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Erro ao sair");
    } else {
      toast.success("Logout realizado com sucesso");
      navigate("/login");
    }
  };

  const isDisparador = userRole === "disparador";
  const canAccessSDR = userRole === "secretaria_medica" || userRole === "administrativo" || userRole === "medico" || userRole === "admin_geral" || userRole === "disparador";
  const canAccessReports = userRole === "medico" || userRole === "admin_geral" || userRole === "administrativo" || userRole === "secretaria_medica";
  const canAccessTeam = userRole === "admin_geral";
  const canAccessDisparos = userRole === "admin_geral" || userRole === "disparador" || userRole === "secretaria_medica";
  const canAccessContatos = !isDisparador;
  const canAccessPerfil = true;
  const canAccessZaps = !isDisparador || true; // disparador tem acesso a zaps

  // Agrupado como no design: Operação (dia-a-dia) vs Inteligência & Config
  const menuItemsOperacao = [
    { title: "Home", url: "/home", icon: LayoutDashboard, show: true },
    { title: "SDR Zap", url: "/sdr-zap", icon: Target, show: canAccessSDR },
    { title: "Task-Flow", url: "/task-flow", icon: ClipboardList, show: canAccessSDR && !isDisparador },
    { title: "Contatos", url: "/contatos", icon: Users, show: !isDisparador },
    { title: "Hub WhatsApp", url: "/hub-whatsapp", icon: Network, show: canAccessReports },
    { title: "Disparos em Massa", url: "/disparos-em-massa", icon: Send, show: canAccessDisparos },
    { title: "Disparos Agendados", url: "/disparos-automaticos", icon: Clock, show: canAccessDisparos && !isDisparador },
    { title: "Configurações Zaps", url: "/zaps", icon: Settings, show: true },
  ];

  const menuItemsInteligencia = [
    { title: "Contexto IA", url: "/contexto-ia", icon: BrainCircuit, show: !isDisparador },
    { title: "Relatórios", url: "/relatorios", icon: BarChart3, show: canAccessReports },
    { title: "Perfil", url: "/perfil", icon: UserCircle, show: true },
    { title: "Usuários", url: "/usuarios", icon: UserCog, show: canAccessTeam },
  ];

  return (
    <Sidebar collapsible="icon" className={state === "collapsed" ? "w-16" : "w-64"}>
      <SidebarHeader className="border-b border-white/[0.06] p-4 hidden md:block">
        {state !== "collapsed" ? (
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <MHMark size={36} className="flex-shrink-0" />
              <div className="min-w-0">
                <h2 className="font-serif-display text-base font-semibold leading-none text-sidebar-foreground tracking-tight">
                  Maikonect
                </h2>
                <div className="text-[10px] mt-1 font-semibold uppercase tracking-[0.12em] text-mh-gold-300">
                  Madeira Holding
                </div>
              </div>
            </div>
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <NotificationsDropdown />
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                className="h-8 w-8 text-sidebar-foreground hover:bg-white/[0.08]"
              >
                <Menu className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <MHMark size={32} />
            <NotificationsDropdown />
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              className="h-8 w-8 text-sidebar-foreground hover:bg-white/[0.08]"
            >
              <Menu className="h-4 w-4" />
            </Button>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          {state !== "collapsed" && (
            <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/50">
              Operação
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItemsOperacao
                .filter((item) => item.show)
                .map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        className={({ isActive }) =>
                          `group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                            isActive
                              ? "bg-sidebar-accent text-sidebar-foreground font-semibold"
                              : "text-sidebar-foreground/75 hover:bg-white/[0.04] hover:text-sidebar-foreground"
                          }`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && (
                              <span className="absolute -left-2 top-1.5 bottom-1.5 w-[3px] rounded-r bg-mh-gold-500" />
                            )}
                            <item.icon className={`h-[18px] w-[18px] flex-shrink-0 ${isActive ? "text-mh-gold-300" : ""}`} />
                            {state !== "collapsed" && <span className="flex-1 truncate">{item.title}</span>}
                          </>
                        )}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          {state !== "collapsed" && (
            <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/50">
              Inteligência
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItemsInteligencia
                .filter((item) => item.show)
                .map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        className={({ isActive }) =>
                          `group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                            isActive
                              ? "bg-sidebar-accent text-sidebar-foreground font-semibold"
                              : "text-sidebar-foreground/75 hover:bg-white/[0.04] hover:text-sidebar-foreground"
                          }`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && (
                              <span className="absolute -left-2 top-1.5 bottom-1.5 w-[3px] rounded-r bg-mh-gold-500" />
                            )}
                            <item.icon className={`h-[18px] w-[18px] flex-shrink-0 ${isActive ? "text-mh-gold-300" : ""}`} />
                            {state !== "collapsed" && <span className="flex-1 truncate">{item.title}</span>}
                          </>
                        )}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-auto border-t border-white/[0.06] pt-2">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/75 hover:bg-white/[0.04] hover:text-sidebar-foreground transition-colors"
                  >
                    <LogOut className="h-[18px] w-[18px]" />
                    {state !== "collapsed" && <span>Sair</span>}
                  </button>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
