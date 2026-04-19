import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Clock, AlertTriangle, MessageSquare, CheckCircle2 } from "lucide-react";
import { differenceInMinutes, differenceInHours } from "date-fns";
import { useNavigate } from "react-router-dom";
import { getConversaUrgencyColor, getTempoSemResposta } from "@/utils/urgencyHelpers";

interface Conversa {
  id: string;
  responsavel_atual: string | null;
  ultima_interacao: string | null;
  ultima_mensagem: string | null;
  numero_contato: string;
  nome_contato: string | null;
  status: string;
  last_message_from_me: boolean | null;
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
  pendentes: Conversa[];
  respondidasHoje: number;
}

const KEYWORDS_URGENTE = ["receita", "dor", "urgente", "emergência", "emergencia", "cirurgia", "sangue", "febre"];

function getUrgencia(conversa: Conversa): "normal" | "atencao" | "urgente" {
  if (conversa.ultima_mensagem) {
    const msgLower = conversa.ultima_mensagem.toLowerCase();
    if (KEYWORDS_URGENTE.some(kw => msgLower.includes(kw))) return "urgente";
  }
  if (!conversa.ultima_interacao) return "normal";
  const horasSemResposta = differenceInHours(new Date(), new Date(conversa.ultima_interacao));
  if (horasSemResposta >= 4) return "urgente";
  if (horasSemResposta >= 2) return "atencao";
  return "normal";
}

function formatTempoSemResposta(ultimaInteracao: string | null): string {
  if (!ultimaInteracao) return "sem data";
  const minutos = differenceInMinutes(new Date(), new Date(ultimaInteracao));
  if (minutos < 60) return `${minutos}min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas}h`;
  return `${Math.floor(horas / 24)}d`;
}

export const MonitorSecretarias = () => {
  const { profile: currentUser } = useCurrentUser();
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchData = async () => {
    try {
      const { data: conversasData } = await supabase
        .from("conversas")
        .select("id, responsavel_atual, ultima_interacao, ultima_mensagem, numero_contato, nome_contato, status, last_message_from_me")
        .in("status", ["novo", "Aguardando Contato", "Em Atendimento"])
        .order("ultima_interacao", { ascending: true })
        .limit(200);

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

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    const channel = supabase
      .channel("monitor-secretarias")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversas" }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const cards: SecretariaCard[] = useMemo(() => {
    if (!profiles.length) return [];
    const profileMap = new Map(profiles.map(p => [p.id, p]));
    const inicioHoje = new Date();
    inicioHoje.setHours(0, 0, 0, 0);

    const grupos = new Map<string, Conversa[]>();
    for (const conv of conversas) {
      if (!conv.responsavel_atual) continue;
      const lista = grupos.get(conv.responsavel_atual) || [];
      lista.push(conv);
      grupos.set(conv.responsavel_atual, lista);
    }

    const isSecretaria = currentUser?.role === "secretaria_medica";
    const isDisparador = currentUser?.role === "disparador";
    if (isDisparador) return [];

    const result: SecretariaCard[] = [];
    for (const [userId, convs] of grupos) {
      if (isSecretaria && userId !== currentUser?.id) continue;
      const profile = profileMap.get(userId);
      if (!profile) continue;

      const pendentes = convs.filter(c => c.last_message_from_me === false);
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
        pendentes,
        respondidasHoje,
      });
    }

    return result.sort((a, b) => {
      const urgA = a.pendentes.filter(c => getUrgencia(c) === "urgente").length;
      const urgB = b.pendentes.filter(c => getUrgencia(c) === "urgente").length;
      return urgB - urgA;
    });
  }, [conversas, profiles, currentUser]);

  const top5Urgentes = useMemo(() => {
    return conversas
      .filter(c => c.last_message_from_me === false)
      .sort((a, b) => new Date(a.ultima_interacao || 0).getTime() - new Date(b.ultima_interacao || 0).getTime())
      .slice(0, 5);
  }, [conversas]);

  const totalPendentes = conversas.filter(c => c.last_message_from_me === false).length;

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
          <Skeleton className="h-16" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-primary/10 to-primary/5 border-b py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Monitor de Atendimento
          </CardTitle>
          {totalPendentes > 0 && (
            <Badge variant="destructive" className="text-xs">
              {totalPendentes} pendente{totalPendentes !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-4 overflow-y-auto max-h-[calc(100vh-20rem)]">

        {/* Cards resumo por secretária */}
        {cards.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {cards.map(card => {
              const urgentes = card.pendentes.filter(c => getUrgencia(c) === "urgente");
              const maxUrgency = urgentes.length > 0 ? '#EF4444' : card.pendentes.length > 0 ? '#F59E0B' : '#22C55E';
              return (
                <div
                  key={card.userId}
                  className="rounded-lg border p-3 text-center transition-all hover:shadow-md cursor-pointer"
                  style={{ borderTopColor: maxUrgency, borderTopWidth: '3px' }}
                  onClick={() => navigate('/sdr-zap')}
                >
                  <p className="text-xs font-medium truncate">{card.nome}</p>
                  <p className="text-2xl font-bold" style={{ color: maxUrgency }}>
                    {card.pendentes.length}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {card.pendentes.length === 0 ? 'em dia' : `pendente${card.pendentes.length !== 1 ? 's' : ''}`}
                    {urgentes.length > 0 && (
                      <span className="text-destructive"> ({urgentes.length} urgente{urgentes.length !== 1 ? 's' : ''})</span>
                    )}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    <MessageSquare className="h-2.5 w-2.5 inline mr-0.5" />
                    {card.respondidasHoje} hoje
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* Top 5 conversas sem resposta */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-xs font-medium">Aguardando resposta</span>
            {top5Urgentes.length > 0 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {totalPendentes}
              </Badge>
            )}
          </div>

          {top5Urgentes.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-green-600 bg-green-50 dark:bg-green-950/30 rounded-lg p-3">
              <CheckCircle2 className="h-4 w-4" />
              Todas as conversas respondidas
            </div>
          ) : (
            <div className="space-y-1">
              {top5Urgentes.map(conv => {
                const urgencia = getUrgencia(conv);
                const tempo = formatTempoSemResposta(conv.ultima_interacao);
                const urgColor = getConversaUrgencyColor(conv.last_message_from_me, conv.ultima_interacao);
                const responsavelNome = profiles.find(p => p.id === conv.responsavel_atual)?.nome || '';

                return (
                  <div
                    key={conv.id}
                    className="flex items-center justify-between text-xs cursor-pointer hover:bg-muted/50 rounded-md px-2 py-1.5 transition-colors border"
                    style={{ borderLeftColor: urgColor, borderLeftWidth: '3px' }}
                    onClick={() => navigate(`/sdr-zap`)}
                  >
                    <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                      <span className="truncate font-medium">
                        {conv.nome_contato || conv.numero_contato}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-muted-foreground text-[10px]">{responsavelNome || 'Sem atribuição'}</span>
                      <span className="font-medium flex items-center gap-0.5" style={{ color: urgColor }}>
                        <Clock className="h-3 w-3" />
                        {tempo}
                      </span>
                      {urgencia === "urgente" && (
                        <Badge variant="destructive" className="text-[9px] px-1 py-0">!</Badge>
                      )}
                    </div>
                  </div>
                );
              })}
              {totalPendentes > 5 && (
                <button
                  className="text-[10px] text-primary hover:underline w-full text-center py-1"
                  onClick={() => navigate('/sdr-zap')}
                >
                  Ver todas ({totalPendentes})
                </button>
              )}
            </div>
          )}
        </div>

        {/* Cards detalhados por secretária */}
        {cards.map((card) => (
          <div
            key={card.userId}
            className="rounded-lg border p-3 space-y-2"
            style={{ borderLeftColor: card.cor, borderLeftWidth: "4px" }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: card.cor }} />
                <span className="font-medium text-sm">{card.nome}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <MessageSquare className="h-3 w-3" />
                {card.respondidasHoje} hoje
              </div>
            </div>

            {card.pendentes.length === 0 ? (
              <p className="text-xs text-green-600">
                <CheckCircle2 className="h-3 w-3 inline mr-1" />
                Tudo em dia
              </p>
            ) : (
              <div className="space-y-1.5">
                {card.pendentes.slice(0, 5).map((conv) => {
                  const urgencia = getUrgencia(conv);
                  const tempo = formatTempoSemResposta(conv.ultima_interacao);
                  const urgColor = getConversaUrgencyColor(conv.last_message_from_me, conv.ultima_interacao);

                  return (
                    <div
                      key={conv.id}
                      className="flex items-center justify-between text-xs cursor-pointer hover:bg-muted/50 rounded px-1.5 py-1 transition-colors"
                      onClick={() => navigate(`/sdr-zap`)}
                    >
                      <span className="truncate max-w-[60%]">
                        {conv.nome_contato || conv.numero_contato}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="flex items-center gap-0.5" style={{ color: urgColor }}>
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
                {card.pendentes.length > 5 && (
                  <p className="text-[10px] text-muted-foreground text-center">
                    +{card.pendentes.length - 5} mais
                  </p>
                )}
              </div>
            )}

            <div className="text-[10px] text-muted-foreground pt-1 border-t">
              {card.conversasAbertas.length} aberta{card.conversasAbertas.length !== 1 ? "s" : ""}
              {card.pendentes.length > 0 && (
                <span className="text-destructive ml-2">
                  {card.pendentes.length} sem resposta
                </span>
              )}
            </div>
          </div>
        ))}

        {cards.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Nenhuma conversa aberta no momento
          </p>
        )}
      </CardContent>
    </Card>
  );
};
