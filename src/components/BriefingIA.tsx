import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Brain, RefreshCw, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface LinkAcao {
  label: string;
  href: string;
}

const CACHE_MINUTES = 30;
const COOLDOWN_MINUTES = 5;

export const BriefingIA = () => {
  const { profile } = useCurrentUser();
  const [conteudo, setConteudo] = useState<string | null>(null);
  const [linksAcao, setLinksAcao] = useState<LinkAcao[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastGenerated, setLastGenerated] = useState<Date | null>(null);
  const navigate = useNavigate();

  // Só mostrar para admin_geral e medico
  const isVisible = profile?.role === "admin_geral" || profile?.role === "medico";

  const fetchCachedBriefing = useCallback(async () => {
    if (!profile?.id) return null;

    const cacheLimit = new Date(Date.now() - CACHE_MINUTES * 60 * 1000).toISOString();

    const { data } = await (supabase as any)
      .from("briefings_home")
      .select("conteudo, links_acao, gerado_em")
      .eq("user_id", profile.id)
      .gte("gerado_em", cacheLimit)
      .order("gerado_em", { ascending: false })
      .limit(1)
      .maybeSingle();

    return data;
  }, [profile?.id]);

  const generateBriefing = useCallback(async () => {
    if (!profile?.id) return;

    const { data, error } = await supabase.functions.invoke("gerar-briefing-home", {
      body: { user_id: profile.id },
    });

    if (error) {
      console.error("[BriefingIA] Erro ao gerar:", error);
      toast.error("Erro ao gerar briefing");
      return null;
    }

    return data;
  }, [profile?.id]);

  // Carregar briefing na montagem
  useEffect(() => {
    if (!profile?.id || !isVisible) {
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);

      // Tentar cache primeiro
      const cached = await fetchCachedBriefing();
      if (cached) {
        setConteudo(cached.conteudo);
        setLinksAcao(cached.links_acao || []);
        setLastGenerated(new Date(cached.gerado_em));
        setLoading(false);
        return;
      }

      // Sem cache — gerar novo
      const result = await generateBriefing();
      if (result) {
        setConteudo(result.conteudo);
        setLinksAcao(result.links_acao || []);
        setLastGenerated(new Date());
      }
      setLoading(false);
    };

    load();
  }, [profile?.id, isVisible]);

  const handleRefresh = async () => {
    // Cooldown check
    if (lastGenerated) {
      const minsSinceGenerated = (Date.now() - lastGenerated.getTime()) / (1000 * 60);
      if (minsSinceGenerated < COOLDOWN_MINUTES) {
        const restante = Math.ceil(COOLDOWN_MINUTES - minsSinceGenerated);
        toast.info(`Aguarde ${restante} minuto(s) para atualizar novamente`);
        return;
      }
    }

    setRefreshing(true);
    const result = await generateBriefing();
    if (result) {
      setConteudo(result.conteudo);
      setLinksAcao(result.links_acao || []);
      setLastGenerated(new Date());
      toast.success("Briefing atualizado");
    }
    setRefreshing(false);
  };

  if (!isVisible) return null;

  if (loading) {
    return (
      <Card>
        <CardHeader className="bg-gradient-to-r from-violet-500/10 to-blue-500/10 border-b py-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="h-4 w-4" />
            Briefing IA
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <Skeleton className="h-4 w-3/4 mb-2" />
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="bg-gradient-to-r from-violet-500/10 to-blue-500/10 border-b py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="h-4 w-4" />
            Briefing IA
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="h-7 text-xs"
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${refreshing ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        {conteudo ? (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed whitespace-pre-line">{conteudo}</p>

            {linksAcao.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {linksAcao.map((link, i) => (
                  <Badge
                    key={i}
                    variant="secondary"
                    className="cursor-pointer hover:bg-secondary/80 transition-colors"
                    onClick={() => navigate(link.href)}
                  >
                    {link.label}
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </Badge>
                ))}
              </div>
            )}

            {lastGenerated && (
              <p className="text-[10px] text-muted-foreground">
                Gerado às {lastGenerated.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Não foi possível gerar o briefing. Tente atualizar.
          </p>
        )}
      </CardContent>
    </Card>
  );
};
