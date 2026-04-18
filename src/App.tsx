import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AuthGuard } from "@/components/AuthGuard";
import { Navbar } from "@/components/Navbar";
import { OverlayAppsProvider } from "@/contexts/OverlayAppsContext";
import { AuthLinkRouter } from "@/components/AuthLinkRouter";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import Home from "./pages/Home";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import SDRZap from "./pages/SDRZap";
import Contatos from "./pages/Contatos";
import ConfiguracaoEvolution from "./pages/ConfiguracaoEvolution";
import Relatorios from "./pages/Relatorios";
import Perfil from "./pages/Perfil";
import Usuarios from "./pages/Usuarios";
import DetalheConversa from "./pages/DetalheConversa";
import DisparosAutomaticos from "./pages/DisparosAutomaticos";
import DisparosEmMassa from "./pages/DisparosEmMassa";
import LeadsPage from "./pages/disparos/Leads";
import CampanhasPage from "./pages/disparos/Campanhas";
import EnviosPage from "./pages/disparos/Envios";
import BlacklistPage from "./pages/disparos/Blacklist";
import TaskFlow from "./pages/TaskFlow";
import ContextoIA from "./pages/ContextoIA";
import HubWhatsApp from "./pages/HubWhatsApp";
import AguardandoAprovacao from "./pages/AguardandoAprovacao";
import NotFound from "./pages/NotFound";
import maykonectLogo from "@/assets/maykonect-logo.png";
import { ComandoRapidoModal } from "@/components/ComandoRapidoModal";
import { Sparkles } from "lucide-react";

const queryClient = new QueryClient();

// Rotas permitidas para o role "disparador"
const DISPARADOR_ALLOWED_ROUTES = ["/home", "/sdr-zap", "/zaps", "/disparos-em-massa", "/perfil"];

const RoleGuard = ({ children, allowedRoles }: { children: React.ReactNode; allowedRoles: string[] }) => {
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        supabase.from("user_roles").select("role").eq("user_id", user.id).single().then(({ data }) => {
          setUserRole(data?.role ?? null);
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });
  }, []);

  if (loading) return null;
  if (userRole && !allowedRoles.includes(userRole)) return <Navigate to="/home" replace />;
  return <>{children}</>;
};

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const lockPageScroll = location.pathname.startsWith("/task-flow");
  const [comandoModalOpen, setComandoModalOpen] = useState(false);

  // Cmd/Ctrl + K para abrir comando rápido
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setComandoModalOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <SidebarProvider defaultOpen={true}>
      {/* Mobile Header - only visible on mobile */}
      <header className="fixed top-0 left-0 right-0 z-50 flex h-14 items-center gap-3 border-b bg-sidebar px-4 md:hidden">
        <SidebarTrigger className="text-sidebar-foreground" />
        <img src={maykonectLogo} alt="Maikonect" className="h-8 w-8 rounded-lg object-contain" />
        <span className="font-nunito text-lg font-semibold text-sidebar-foreground">Maikonect</span>
      </header>

      <div
        className={
          "flex w-full pt-14 md:pt-0 " +
          (lockPageScroll ? "h-screen overflow-hidden" : "min-h-screen")
        }
      >
        <Navbar />
        <main
          className={
            "flex-1 bg-background " +
            (lockPageScroll ? "overflow-hidden" : "overflow-auto")
          }
        >
          {children}
        </main>
      </div>

      {/* Botão flutuante Comando Rápido */}
      <button
        onClick={() => setComandoModalOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-110 active:scale-95 md:h-14 md:w-14"
        title="Comando Rápido (Ctrl+K)"
      >
        <Sparkles className="h-5 w-5 md:h-6 md:w-6" />
      </button>

      <ComandoRapidoModal open={comandoModalOpen} onOpenChange={setComandoModalOpen} />
    </SidebarProvider>
  );
};

const NON_DISPARADOR_ROLES = ["admin_geral", "medico", "secretaria_medica", "administrativo"];

const App = () => (
  <QueryClientProvider client={queryClient}>
    <OverlayAppsProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthGuard>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/auth" element={<Login />} />
              <Route path="/auth/reset" element={<ResetPassword />} />
              <Route path="/aguardando-aprovacao" element={<AguardandoAprovacao />} />
              <Route
                path="/home"
                element={
                  <AppLayout>
                    <Home />
                  </AppLayout>
                }
              />
              <Route path="/" element={<AuthLinkRouter />} />
              <Route
                path="/sdr-zap"
                element={
                  <AppLayout>
                    <SDRZap />
                  </AppLayout>
                }
              />
              <Route
                path="/conversa/:id"
                element={<DetalheConversa />}
              />
              <Route
                path="/contatos"
                element={
                  <AppLayout>
                    <RoleGuard allowedRoles={NON_DISPARADOR_ROLES}>
                      <Contatos />
                    </RoleGuard>
                  </AppLayout>
                }
              />
              <Route
                path="/hub-whatsapp"
                element={
                  <AppLayout>
                    <RoleGuard allowedRoles={NON_DISPARADOR_ROLES}>
                      <HubWhatsApp />
                    </RoleGuard>
                  </AppLayout>
                }
              />
              <Route
                path="/zaps"
                element={
                  <AppLayout>
                    <ConfiguracaoEvolution />
                  </AppLayout>
                }
              />
              <Route
                path="/relatorios"
                element={
                  <AppLayout>
                    <RoleGuard allowedRoles={NON_DISPARADOR_ROLES}>
                      <Relatorios />
                    </RoleGuard>
                  </AppLayout>
                }
              />
              <Route
                path="/perfil"
                element={
                  <AppLayout>
                    <Perfil />
                  </AppLayout>
                }
              />
              <Route
                path="/usuarios"
                element={
                  <AppLayout>
                    <Usuarios />
                  </AppLayout>
                }
              />
              <Route
                path="/disparos-automaticos"
                element={
                  <AppLayout>
                    <RoleGuard allowedRoles={NON_DISPARADOR_ROLES}>
                      <DisparosAutomaticos />
                    </RoleGuard>
                  </AppLayout>
                }
              />
              <Route
                path="/disparos-em-massa"
                element={
                  <AppLayout>
                    <DisparosEmMassa />
                  </AppLayout>
                }
              />
              <Route
                path="/disparos-em-massa/leads"
                element={
                  <AppLayout>
                    <LeadsPage />
                  </AppLayout>
                }
              />
              <Route
                path="/disparos-em-massa/campanhas"
                element={
                  <AppLayout>
                    <CampanhasPage />
                  </AppLayout>
                }
              />
              <Route
                path="/disparos-em-massa/envios"
                element={
                  <AppLayout>
                    <EnviosPage />
                  </AppLayout>
                }
              />
              <Route
                path="/disparos-em-massa/blacklist"
                element={
                  <AppLayout>
                    <BlacklistPage />
                  </AppLayout>
                }
              />
              <Route
                path="/task-flow"
                element={
                  <AppLayout>
                    <RoleGuard allowedRoles={NON_DISPARADOR_ROLES}>
                      <TaskFlow />
                    </RoleGuard>
                  </AppLayout>
                }
              />
              <Route
                path="/contexto-ia"
                element={
                  <AppLayout>
                    <RoleGuard allowedRoles={NON_DISPARADOR_ROLES}>
                      <ContextoIA />
                    </RoleGuard>
                  </AppLayout>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthGuard>
        </BrowserRouter>
      </TooltipProvider>
    </OverlayAppsProvider>
  </QueryClientProvider>
);

export default App;
