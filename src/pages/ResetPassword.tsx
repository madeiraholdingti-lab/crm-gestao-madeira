import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { KeyRound, AlertTriangle, RefreshCw, ArrowLeft, CheckCircle2 } from "lucide-react";
import maykonectLogo from "@/assets/maykonect-logo.png";

type ResetState = "loading" | "ready" | "expired" | "success";

const ResetPassword = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<ResetState>("loading");
  const [loading, setLoading] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    // Check if we have a valid recovery session
    const checkSession = async () => {
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error) {
        console.error("[ResetPassword] Erro ao verificar sessão:", error);
        setState("expired");
        return;
      }

      // Check for recovery type in URL
      const hashParams = new URLSearchParams(
        location.hash?.startsWith("#") ? location.hash.slice(1) : location.hash
      );
      const type = hashParams.get("type");

      if (session?.user) {
        // User is authenticated via recovery link
        setEmail(session.user.email || "");
        setState("ready");
      } else if (type === "recovery") {
        // Has recovery type but no session yet - wait for auth state change
        setState("loading");
      } else {
        // No session and no recovery type - expired or invalid
        setState("expired");
      }
    };

    checkSession();

    // Listen for auth state changes (PASSWORD_RECOVERY event)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("[ResetPassword] Auth event:", event);
      if (event === "PASSWORD_RECOVERY" && session?.user) {
        setEmail(session.user.email || "");
        setState("ready");
      } else if (event === "USER_UPDATED") {
        // Password was updated successfully
        setState("success");
      }
    });

    return () => subscription.unsubscribe();
  }, [location.hash]);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword.length < 6) {
      toast.error("A senha deve ter no mínimo 6 caracteres");
      return;
    }

    if (newPassword !== confirmNewPassword) {
      toast.error("As senhas não coincidem");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        console.error("[ResetPassword] Erro ao atualizar senha:", error);
        if (error.message.includes("expired") || error.message.includes("invalid")) {
          setState("expired");
        } else {
          toast.error("Erro ao atualizar senha: " + error.message);
        }
        return;
      }

      setState("success");
      toast.success("Senha atualizada com sucesso!");
    } catch (error) {
      console.error("[ResetPassword] Erro:", error);
      toast.error("Erro ao atualizar senha");
    } finally {
      setLoading(false);
    }
  };

  const handleRequestNewLink = async () => {
    navigate("/login");
    toast.info("Use 'Esqueci minha senha' para solicitar um novo link");
  };

  const handleGoToLogin = async () => {
    // Sign out before going to login to avoid auto-login
    await supabase.auth.signOut();
    navigate("/login");
  };

  const handleGoToHome = () => {
    navigate("/home");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 font-nunito">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-6">
            <img
              src={maykonectLogo}
              alt="Maikonect Logo"
              className="h-10 w-10 rounded-lg object-contain"
            />
            <h1 className="font-nunito text-2xl font-bold text-foreground tracking-wide">
              Maikonect
            </h1>
          </div>
        </div>

        {/* Loading State */}
        {state === "loading" && (
          <div className="text-center space-y-4">
            <div className="h-12 w-12 mx-auto animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-muted-foreground">Verificando link de recuperação...</p>
          </div>
        )}

        {/* Ready State - Show password form */}
        {state === "ready" && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <KeyRound className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">Redefinir Senha</h2>
              {email && (
                <p className="text-muted-foreground mt-2 text-sm">
                  Conta: <span className="font-medium">{email}</span>
                </p>
              )}
            </div>

            <form onSubmit={handleUpdatePassword} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="newPassword">Nova Senha</Label>
                <Input
                  id="newPassword"
                  type="password"
                  placeholder="Mínimo 6 caracteres"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  className="h-11"
                  minLength={6}
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmNewPassword">Confirmar Nova Senha</Label>
                <Input
                  id="confirmNewPassword"
                  type="password"
                  placeholder="Digite novamente"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  required
                  className="h-11"
                  minLength={6}
                />
              </div>

              {/* Password requirements hint */}
              <p className="text-xs text-muted-foreground">
                A senha deve ter no mínimo 6 caracteres
              </p>

              <Button type="submit" className="w-full h-11" disabled={loading}>
                {loading ? (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                ) : (
                  <>
                    <KeyRound className="mr-2 h-4 w-4" />
                    Salvar Nova Senha
                  </>
                )}
              </Button>
            </form>

            <div className="text-center">
              <button
                type="button"
                onClick={handleGoToLogin}
                className="text-sm text-primary hover:underline inline-flex items-center gap-1"
              >
                <ArrowLeft className="h-3 w-3" />
                Voltar para o login
              </button>
            </div>
          </div>
        )}

        {/* Expired State */}
        {state === "expired" && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-8 w-8 text-destructive" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">Link Expirado</h2>
              <p className="text-muted-foreground mt-2">
                Este link de recuperação de senha é inválido ou já expirou.
              </p>
            </div>

            <div className="space-y-3">
              <Button onClick={handleRequestNewLink} className="w-full h-11" variant="default">
                <RefreshCw className="mr-2 h-4 w-4" />
                Solicitar Novo Link
              </Button>

              <Button onClick={handleGoToLogin} className="w-full h-11" variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Voltar para o Login
              </Button>
            </div>
          </div>
        )}

        {/* Success State */}
        {state === "success" && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">Senha Atualizada!</h2>
              <p className="text-muted-foreground mt-2">
                Sua senha foi redefinida com sucesso.
              </p>
            </div>

            <Button onClick={handleGoToHome} className="w-full h-11">
              Acessar o Sistema
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
