import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Clock, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import maykonectLogo from "@/assets/maykonect-logo.png";

export default function AguardandoAprovacao() {
  const navigate = useNavigate();

  useEffect(() => {
    // Verificar periodicamente se o usuário foi aprovado
    const checkApproval = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate("/login");
        return;
      }

      // Verificar se o usuário agora tem uma role
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      if (roleData?.role) {
        // Usuário foi aprovado, redirecionar para home
        navigate("/home");
      }
    };

    // Verificar a cada 30 segundos (era 10s)
    const interval = setInterval(checkApproval, 30000);
    
    // Verificar imediatamente ao carregar
    checkApproval();

    return () => clearInterval(interval);
  }, [navigate]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-card rounded-2xl shadow-xl p-8 text-center border border-border/50">
        <img 
          src={maykonectLogo} 
          alt="Maikonect"
          className="h-12 mx-auto mb-6"
        />
        
        <div className="w-20 h-20 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-6">
          <Clock className="w-10 h-10 text-amber-500" />
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-3">
          Aguardando Aprovação
        </h1>
        
        <p className="text-muted-foreground mb-6">
          Sua conta foi criada com sucesso! Um administrador precisa aprovar seu acesso antes que você possa utilizar o sistema.
        </p>

        <div className="bg-muted/50 rounded-lg p-4 mb-6">
          <p className="text-sm text-muted-foreground">
            Esta página será atualizada automaticamente quando sua conta for aprovada.
          </p>
        </div>

        <Button 
          variant="outline" 
          onClick={handleLogout}
          className="w-full"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Sair e voltar ao login
        </Button>
      </div>
    </div>
  );
}
