import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { LogIn, UserPlus, KeyRound, Mail, ArrowLeft } from "lucide-react";
import { z } from "zod";
import maykonectLogo from "@/assets/maykonect-logo.png";
import loginBackground from "@/assets/login-background.webp";
import AnimatedDoctorMascot from "@/components/AnimatedDoctorMascot";

const loginSchema = z.object({
  email: z.string().email({ message: "Email inválido" }),
  password: z.string().min(6, { message: "Senha deve ter no mínimo 6 caracteres" })
});

const signupSchema = loginSchema.extend({
  nome: z.string().min(2, { message: "Nome deve ter no mínimo 2 caracteres" }),
  confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
  message: "As senhas não coincidem",
  path: ["confirmPassword"]
});

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isLogin, setIsLogin] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nome, setNome] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  // Detectar recovery via URL (hash/search) e também via evento de auth
  useEffect(() => {
    const hashParams = new URLSearchParams(
      location.hash?.startsWith("#") ? location.hash.slice(1) : location.hash
    );
    const searchParams = new URLSearchParams(location.search);
    const type = hashParams.get("type") || searchParams.get("type");

    if (type === "recovery" && !isPasswordRecovery) {
      setIsPasswordRecovery(true);
      setIsForgotPassword(false);
      setIsLogin(true);
      toast.info("Digite sua nova senha");
    }
  }, [location.hash, location.search, isPasswordRecovery]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsPasswordRecovery(true);
        setIsForgotPassword(false);
        setIsLogin(true);
        toast.info("Digite sua nova senha");
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      loginSchema.parse({ email, password });
      setLoading(true);

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        toast.error("Email ou senha incorretos");
        return;
      }

      if (data.user) {
        toast.success("Login realizado com sucesso!");
        navigate("/home");
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      signupSchema.parse({ email, password, nome, confirmPassword });
      setLoading(true);

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/home`,
          data: {
            nome: nome,
            funcao: 'secretaria_medica',
          }
        }
      });

      if (error) {
        toast.error("Não foi possível criar a conta. Tente novamente.");
        return;
      }

      if (data.user) {
        toast.success("Cadastro realizado com sucesso!");
        navigate("/home");
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
      }
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setIsLogin(!isLogin);
    setIsPasswordRecovery(false);
    setIsForgotPassword(false);
    setEmail("");
    setPassword("");
    setNome("");
    setConfirmPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const emailValidation = z.string().email({ message: "Email inválido" });
    try {
      emailValidation.parse(email);
    } catch {
      toast.error("Digite um email válido");
      return;
    }
    
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset`,
      });
      
      if (error) {
        const code = (error as any)?.code as string | undefined;
        if (code === "over_email_send_rate_limit") {
          toast.info("Aguarde alguns segundos e tente novamente.");
        } else {
          toast.error("Erro ao enviar email de recuperação");
        }
        return;
      }
      
      toast.success("Email de recuperação enviado! Verifique sua caixa de entrada.");
      setIsForgotPassword(false);
    } catch (error) {
      console.error('[Login] Erro:', error);
      toast.error("Erro ao solicitar recuperação de senha");
    } finally {
      setLoading(false);
    }
  };

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
        password: newPassword
      });
      
      if (error) {
        console.error('[Login] Erro ao atualizar senha:', error);
        toast.error("Erro ao atualizar senha: " + error.message);
        return;
      }
      
      toast.success("Senha atualizada com sucesso!");
      setIsPasswordRecovery(false);
      navigate("/home");
    } catch (error) {
      console.error('[Login] Erro:', error);
      toast.error("Erro ao atualizar senha");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-background p-4 font-nunito">
      {/* Left side - Background Image with Doctor */}
      <div 
        className="hidden lg:flex lg:w-[70%] rounded-2xl overflow-hidden relative items-end justify-center"
      >
        <img
          src={loginBackground}
          alt=""
          fetchPriority="high"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <AnimatedDoctorMascot 
          isPasswordFocused={isPasswordFocused}
          className="w-[400px] h-auto relative z-10"
        />
      </div>

      {/* Right side - Login Form */}
      <div className="w-full lg:w-[30%] flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-md space-y-8">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <div className="flex items-center justify-center gap-2 mb-2">
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

          <div className="text-center">
            <h2 className="text-2xl font-bold text-foreground">
              {isPasswordRecovery 
                ? "Redefinir Senha" 
                : isForgotPassword
                  ? "Recuperar Senha"
                  : isLogin 
                    ? "Bem-vindo de volta" 
                    : "Criar nova conta"}
            </h2>
            <p className="text-muted-foreground mt-2">
              {isPasswordRecovery
                ? "Digite sua nova senha"
                : isForgotPassword
                  ? "Digite seu email para receber o link de recuperação"
                  : isLogin 
                    ? "Entre com suas credenciais para acessar"
                    : "Preencha os dados para criar sua conta"}
            </p>
          </div>

          {isForgotPassword ? (
            <form onSubmit={handleForgotPassword} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="recoveryEmail">Email</Label>
                <Input
                  id="recoveryEmail"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-11"
                />
              </div>

              <Button
                type="submit"
                className="w-full h-11"
                disabled={loading}
              >
                {loading ? (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                ) : (
                  <>
                    <Mail className="mr-2 h-4 w-4" />
                    Enviar Link de Recuperação
                  </>
                )}
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setIsForgotPassword(false);
                    setEmail("");
                  }}
                  className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Voltar para o login
                </button>
              </div>
            </form>
          ) : isPasswordRecovery ? (
            <form onSubmit={handleUpdatePassword} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="newPassword">Nova Senha</Label>
                <Input
                  id="newPassword"
                  type="password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  onFocus={() => setIsPasswordFocused(true)}
                  onBlur={() => setIsPasswordFocused(false)}
                  required
                  className="h-11"
                  minLength={6}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmNewPassword">Confirmar Nova Senha</Label>
                <Input
                  id="confirmNewPassword"
                  type="password"
                  placeholder="••••••••"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  onFocus={() => setIsPasswordFocused(true)}
                  onBlur={() => setIsPasswordFocused(false)}
                  required
                  className="h-11"
                  minLength={6}
                />
              </div>

              <Button
                type="submit"
                className="w-full h-11"
                disabled={loading}
              >
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
          ) : (
            <form onSubmit={isLogin ? handleLogin : handleSignup} className="space-y-5">
              {!isLogin && (
                <div className="space-y-2">
                  <Label htmlFor="nome">Nome Completo</Label>
                  <Input
                    id="nome"
                    type="text"
                    placeholder="Seu nome"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    required={!isLogin}
                    className="h-11"
                  />
                </div>
              )}
              
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Senha</Label>
                  {isLogin && (
                    <button
                      type="button"
                      onClick={() => setIsForgotPassword(true)}
                      className="text-xs text-primary hover:underline"
                    >
                      Esqueci minha senha
                    </button>
                  )}
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setIsPasswordFocused(true)}
                  onBlur={() => setIsPasswordFocused(false)}
                  required
                  className="h-11"
                />
              </div>

              {!isLogin && (
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirmar Senha</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onFocus={() => setIsPasswordFocused(true)}
                    onBlur={() => setIsPasswordFocused(false)}
                    required
                    className="h-11"
                  />
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-11"
                disabled={loading}
              >
                {loading ? (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                ) : (
                  <>
                    {isLogin ? (
                      <>
                        <LogIn className="mr-2 h-4 w-4" />
                        Entrar
                      </>
                    ) : (
                      <>
                        <UserPlus className="mr-2 h-4 w-4" />
                        Cadastrar
                      </>
                    )}
                  </>
                )}
              </Button>
            </form>
          )}

          {!isPasswordRecovery && !isForgotPassword && (
            <div className="text-center">
              <button
                type="button"
                onClick={resetForm}
                className="text-sm text-primary hover:underline"
              >
                {isLogin 
                  ? "Não tem uma conta? Cadastre-se"
                  : "Já tem uma conta? Faça login"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;
