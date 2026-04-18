import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Clock, AlertTriangle, MessageSquare } from "lucide-react";
import { differenceInMinutes, differenceInHours } from "date-fns";
import { useNavigate } from "react-router-dom";

interface Conversa {
  id: string;
  responsavel_atual: string | null;
  ultima_interacao: string | null;
  ultima_mensagem: string | null;
  numero_contato: string;
  nome_contato: string | null;
  status: string;
}

interface Profile {
  id: string;
  nome: string;
  cor_perfil: string;
}

interface SecretariaCard {
  userId: string;
  nome: string;
  cor: string;
  conversasAbertas: Conversa[];
  respondidasHoje: number;
}

const KEYWORDS_URGENTE = ["receita", "dor", "urgente", "emergência", "emergencia", "cirurgia", "sangue", "febre"];

function getUrgencia(conversa: Conversa): "normal" | "atencao" | "urgente" {
  const agora = new Date();
  const ultimaInteracao = conversa.ultima_interacao ? new Date(conversa.ultima_interacao) : null;

  // Keywords urgentes na última mensagem
  if (conversa.ultima_mensagem) {
    const msgLower = conversa.ultima_mensagem.toLowerCase();
    if (KEYWORDS_URGENTE.some(kw => msgLower.includes(kw))) {
      return "urgente";
    }
  }

  if (!ultimaInteracao) return "normal";

  const horasSemResposta = differenceInHours(agora, ultimaInteracao);

  if (horasSemResposta >= 4) return "urgente";
  if (horasSemResposta >= 2) return "atencao";
  return "normal";
}

function formatTempoSemResposta(ultimaInteracao: string | null): string {
  if (!ultimaInteracao) return "sem data";

  const agora = new Date();
  const ultima = new Date(ultimaInteracao);
  const minutos = differenceInMinutes(agora, ultima);

  if (minutos < 60) return `${minutos}min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas}h`;
  const dias = Math.floor(horas / 24);
  return `${dias}d`;
}

export const MonitorSecretarias = () => {
  const { profile: currentUser } = useCurrentUser();
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchData = async () => {
    try {
      // Buscar conversas abertas
      const { data: conversasData } = await supabase
        .from("conversas")
        .select("id, responsavel_atual, ultima_interacao, ultima_mensagem, numero_contato, nome_contato, status")
        .in("status", ["novo", "Aguardando Contato", "Em Atendimento"])
        .not("responsavel_atual", "is", null)
        .order("ultima_interacao", { ascending: true })
        .limit(200);

      // Buscar perfis ativos (para mapear nome/cor)
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, nome, cor_perfil")
        .eq("ativo", true);

      setConversas(conversasData || []);
      setProfiles(profilesData || []);
    } catch (err) {
      console.error("[MonitorSecretarias] Erro ao buscar dados:", err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch inicial
  useEffect(() => {
    fetchData();
  }, []);

  // Realtime: atualizar quando conversas mudam
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setupChannel = async () => {
      channel = supabase
        .channel("monitor-secretarias")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "conversas" },
          () => fetchData()
        )
        .subscribe();
    };

    setupChannel();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  // Agrupar conversas por responsável
  const cards: SecretariaCard[] = useMemo(() => {
    if (!profiles.length) return [];

    const profileMap = new Map(profiles.map(p => [p.id, p]));
    const agora = new Date();
    const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());

    // Agrupar
    const grupos = new Map<string, Conversa[]>();
    for (const conv of conversas) {
      if (!conv.responsavel_atual) continue;
      const lista = grupos.get(conv.responsavel_atual) || [];
      lista.push(conv);
      grupos.set(conv.responsavel_atual, lista);
    }

    // Filtrar por role: secretária vê só as próprias
    const isSecretaria = currentUser?.role === "secretaria_medica";
    const isDisparador = currentUser?.role === "disparador";
    if (isDisparador) return [];

    const result: SecretariaCard[] = [];

    for (const [userId, convs] of grupos) {
      if (isSecretaria && userId !== currentUser?.id) continue;

      const profile = profileMap.get(userId);
      if (!profile) continue;

      // Contar respondidas hoje (conversas com ultima_interacao hoje que não estão abertas)
      // Simplificação: contar conversas desse responsável com interação hoje
      const respondidasHoje = conversas.filter(c =>
        c.responsavel_atual === userId &&
        c.ultima_interacao &&
        new Date(c.ultima_interacao) >= inicioHoje
      ).length;

      result.push({
        userId,
        nome: profile.nome,
        cor: profile.cor_perfil || "#3B82F6",
        conversasAbertas: convs,
        respondidasHoje,
      });
    }

    // Ordenar por quem tem mais conversas urgentes
    return result.sort((a, b) => {
      const urgentesA = a.conversasAbertas.filter(c => getUrgencia(c) === "urgente").length;
      const urgentesB = b.conversasAbertas.filter(c => getUrgencia(c) === "urgente").length;
      return urgentesB - urgentesA;
    });
  }, [conversas, profiles, currentUser]);

  if (loading) {
    return (
      <Card>
        <CardHeader className="bg-gradient-to-r from-primary/10 to-primary/5 border-b py-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Monitor de Atendimento
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-primary/10 to-primary/5 border-b py-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          Monitor de Atendimento
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-3 overflow-y-auto max-h-[calc(100vh-20rem)]">
        {cards.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Nenhuma conversa aberta no momento
          </p>
        ) : (
          cards.map((card) => (
            <div
              key={card.userId}
              className="rounded-lg border p-3 space-y-2"
              style={{ borderLeftColor: card.cor, borderLeftWidth: "4px" }}
            >
              {/* Header do card */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: card.cor }}
                  />
                  <span className="font-medium text-sm">{card.nome}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MessageSquare className="h-3 w-3" />
                  {card.respondidasHoje} hoje
                </div>
              </div>

              {/* Conversas abertas */}
              {card.conversasAbertas.length === 0 ? (
                <p className="text-xs text-muted-foreground">Tudo em dia</p>
              ) : (
                <div className="space-y-1.5">
                  {card.conversasAbertas.map((conv) => {
                    const urgencia = getUrgencia(conv);
                    const tempo = formatTempoSemResposta(conv.ultima_interacao);

                    return (
                      <div
                        key={conv.id}
                        className="flex items-center justify-between text-xs cursor-pointer hover:bg-muted/50 rounded px-1.5 py-1 transition-colors"
                        onClick={() => navigate(`/conversa/${conv.id}`)}
                      >
                        <span className="truncate max-w-[60%]">
                          {conv.nome_contato || conv.numero_contato}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground flex items-center gap-0.5">
                            <Clock className="h-3 w-3" />
                            {tempo}
                          </span>
                          {urgencia === "urgente" && (
                            <Badge variant="destructive" className="text-[10px] px-1 py-0">
                              <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                              urgente
                            </Badge>
                          )}
                          {urgencia === "atencao" && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 text-yellow-600 border-yellow-400">
                              atenção
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Resumo */}
              <div className="text-[10px] text-muted-foreground pt-1 border-t">
                {card.conversasAbertas.length} aberta{card.conversasAbertas.length !== 1 ? "s" : ""}
                {card.conversasAbertas.filter(c => getUrgencia(c) !== "normal").length > 0 && (
                  <span className="text-destructive ml-2">
                    {card.conversasAbertas.filter(c => getUrgencia(c) !== "normal").length} precisa{card.conversasAbertas.filter(c => getUrgencia(c) !== "normal").length !== 1 ? "m" : ""} de atenção
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
};
