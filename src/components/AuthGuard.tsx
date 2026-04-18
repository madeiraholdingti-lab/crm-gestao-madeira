import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { User, Session } from "@supabase/supabase-js";

interface AuthGuardProps {
  children: React.ReactNode;
}

// Rotas que não precisam de autenticação
const PUBLIC_ROUTES = ["/login", "/auth", "/auth/reset"];
// Rotas que precisam de autenticação mas NÃO precisam de role aprovada
const PENDING_ROUTES = ["/aguardando-aprovacao"];

export const AuthGuard = ({ children }: AuthGuardProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasRole, setHasRole] = useState<boolean | null>(null);

  const isPasswordRecoveryFlow = () => {
    // Supabase recovery links typically come as hash params: #access_token=...&type=recovery
    const hashParams = new URLSearchParams(
      location.hash?.startsWith("#") ? location.hash.slice(1) : location.hash
    );
    const searchParams = new URLSearchParams(location.search);
    const type = hashParams.get("type") || searchParams.get("type");
    return type === "recovery";
  };

  // If a recovery link lands on another route (/, /home, etc.), force it onto /auth/reset
  // while preserving the hash/query so the client can finalize the recovery session.
  useEffect(() => {
    if (isPasswordRecoveryFlow() && location.pathname !== "/auth/reset") {
      navigate(
        {
          pathname: "/auth/reset",
          search: location.search,
          hash: location.hash,
        },
        { replace: true }
      );
    }
  }, [location.pathname, location.hash, location.search, navigate]);

  const checkUserRole = async (userId: string) => {
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();

    return !!roleData?.role;
  };

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        // IMPORTANT: during password recovery, do not redirect away (we must preserve hash/search)
        if (
          isPasswordRecoveryFlow() &&
          (PUBLIC_ROUTES.includes(location.pathname) || location.pathname === "/")
        ) {
          setHasRole(null);
          setLoading(false);
          return;
        }

        if (!session) {
          // Allow the app to stay on the page when the URL contains a recovery token.
          // Otherwise a redirect would drop the hash parameters.
          if (isPasswordRecoveryFlow()) {
            setHasRole(null);
            setLoading(false);
            return;
          }

          setHasRole(null);
          if (!PUBLIC_ROUTES.includes(location.pathname)) {
            navigate("/login");
          }
          setLoading(false);
          return;
        }

        // Verificar role usando setTimeout para evitar deadlock
        setTimeout(async () => {
          const userHasRole = await checkUserRole(session.user.id);
          setHasRole(userHasRole);

          // NEVER redirect away from /auth/reset - user must complete password reset
          if (location.pathname === "/auth/reset") {
            setLoading(false);
            return;
          }

          if (PUBLIC_ROUTES.includes(location.pathname)) {
            // Usuário logado na página de login
            if (userHasRole) {
              navigate("/home");
            } else {
              navigate("/aguardando-aprovacao");
            }
          } else if (!PENDING_ROUTES.includes(location.pathname) && !userHasRole) {
            // Usuário sem role tentando acessar página protegida
            navigate("/aguardando-aprovacao");
          } else if (PENDING_ROUTES.includes(location.pathname) && userHasRole) {
            // Usuário com role na página de aguardando
            navigate("/home");
          }

          setLoading(false);
        }, 0);
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);

      // IMPORTANT: during password recovery, do not redirect away from /auth
      if (session && PUBLIC_ROUTES.includes(location.pathname) && isPasswordRecoveryFlow()) {
        setHasRole(null);
        setLoading(false);
        return;
      }

      if (!session) {
        // Allow the app to stay on the page when the URL contains a recovery token.
        if (isPasswordRecoveryFlow()) {
          setHasRole(null);
          setLoading(false);
          return;
        }

        setHasRole(null);
        if (!PUBLIC_ROUTES.includes(location.pathname)) {
          navigate("/login");
        }
        setLoading(false);
        return;
      }

      setTimeout(async () => {
        const userHasRole = await checkUserRole(session.user.id);
        setHasRole(userHasRole);

        // NEVER redirect away from /auth/reset - user must complete password reset
        if (location.pathname === "/auth/reset") {
          setLoading(false);
          return;
        }

        if (PUBLIC_ROUTES.includes(location.pathname)) {
          if (userHasRole) {
            navigate("/home");
          } else {
            navigate("/aguardando-aprovacao");
          }
        } else if (!PENDING_ROUTES.includes(location.pathname) && !userHasRole) {
          navigate("/aguardando-aprovacao");
        } else if (PENDING_ROUTES.includes(location.pathname) && userHasRole) {
          navigate("/home");
        }

        setLoading(false);
      }, 0);
    });

    return () => subscription.unsubscribe();
  }, [navigate, location.pathname, location.hash, location.search]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
};
