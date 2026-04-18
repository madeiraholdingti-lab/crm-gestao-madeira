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
import maykonectLogo from "@/assets/maykonect-logo.png";
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

  const menuItems = [
    { title: "Home", url: "/home", icon: LayoutDashboard, show: true },
    { title: "SDR Zap", url: "/sdr-zap", icon: Target, show: canAccessSDR },
    { title: "Task-Flow", url: "/task-flow", icon: ClipboardList, show: canAccessSDR && !isDisparador },
    { title: "Contatos", url: "/contatos", icon: Users, show: !isDisparador },
    { title: "Hub WhatsApp", url: "/hub-whatsapp", icon: Network, show: canAccessReports },
    { title: "Disparos Agendados", url: "/disparos-automaticos", icon: Clock, show: canAccessDisparos && !isDisparador },
    { title: "Disparos em Massa", url: "/disparos-em-massa", icon: Send, show: canAccessDisparos },
    { title: "Contexto IA", url: "/contexto-ia", icon: BrainCircuit, show: !isDisparador },
    { title: "Configurações Zaps", url: "/zaps", icon: Settings, show: true },
    { title: "Relatórios", url: "/relatorios", icon: BarChart3, show: canAccessReports },
    { title: "Perfil", url: "/perfil", icon: UserCircle, show: true },
    { title: "Usuários", url: "/usuarios", icon: UserCog, show: canAccessTeam },
  ];

  return (
    <Sidebar collapsible="icon" className={state === "collapsed" ? "w-16" : "w-64"}>
      <SidebarHeader className="border-b border-sidebar-border p-3 hidden md:block">
        <div className="flex flex-col items-center gap-2">
          {state !== "collapsed" ? (
            <div className="flex w-full items-center justify-between">
              <div className="flex items-center gap-2">
                <img src={maykonectLogo} alt="Maikonect" className="h-10 w-10 min-w-[40px] min-h-[40px] rounded-lg object-contain" />
                <div>
                  <h2 className="font-nunito text-xl font-semibold text-slate-100 tracking-wide">Maikonect</h2>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <NotificationsDropdown />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleSidebar}
                  className="text-sidebar-foreground hover:bg-sidebar-accent"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </div>
            </div>
          ) : (
            <>
              <img src={maykonectLogo} alt="Maikonect" className="h-8 w-8 min-w-[32px] min-h-[32px] rounded-lg object-contain" />
              <NotificationsDropdown />
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                className="text-sidebar-foreground hover:bg-sidebar-accent"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/70">Menu Principal</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems
                .filter((item) => item.show)
                .map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        className={({ isActive }) =>
                          `flex items-center gap-3 rounded-md px-3 py-2 transition-colors ${
                            isActive
                              ? "bg-sidebar-accent text-sidebar-primary font-medium"
                              : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                          }`
                        }
                      >
                        <item.icon className="h-5 w-5" />
                        {state !== "collapsed" && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
                  >
                    <LogOut className="h-5 w-5" />
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
