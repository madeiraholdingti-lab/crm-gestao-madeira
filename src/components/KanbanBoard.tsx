import { useEffect, useState, useRef } from "react";
import { DndContext, DragEndEvent, useSensor, useSensors, PointerSensor } from "@dnd-kit/core";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Phone, MessageSquare, Clock, Send, UserCircle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DroppableColumn } from "./DroppableColumn";
import { DraggableCard } from "./DraggableCard";
import { ModalAnotacaoTransferencia } from "./ModalAnotacaoTransferencia";

interface Conversa {
  id: string;
  numero_contato: string;
  nome_contato: string | null;
  status: string;
  responsavel_atual: string | null;
  ultima_mensagem: string | null;
  ultima_interacao: string;
  anotacao_transferencia: string | null;
  instancia_id: string | null;
  orig_instance_id: string | null;
  current_instance_id: string | null;
}

interface Mensagem {
  id: string;
  conteudo: string;
  remetente: string;
  tipo_mensagem: string;
  created_at: string;
  enviado_por: string | null;
}

interface InstanciaWhatsApp {
  id: string;
  instancia_id: string;
  nome_instancia: string;
  cor_identificacao: string;
  ativo: boolean;
}

interface Profile {
  id: string;
  nome: string;
  telefone_contato: string | null;
  cor_perfil: string;
}

export const KanbanBoard = () => {
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [instancias, setInstancias] = useState<InstanciaWhatsApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingTransfer, setPendingTransfer] = useState<{
    conversaId: string;
    novoResponsavel: string;
    nomeResponsavel: string;
    nomeContato: string;
    numeroContato: string;
  } | null>(null);
  
  // Estados para o chat
  const [conversaSelecionada, setConversaSelecionada] = useState<Conversa | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [instanciaOrigem, setInstanciaOrigem] = useState<InstanciaWhatsApp | null>(null);
  const [instanciaResposta, setInstanciaResposta] = useState<InstanciaWhatsApp | null>(null);
  const [novaMensagem, setNovaMensagem] = useState("");
  const [enviando, setEnviando] = useState(false);
  const mensagensEndRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  useEffect(() => {
    fetchData();
    subscribeToChanges();
  }, []);

  useEffect(() => {
    if (conversaSelecionada) {
      fetchMensagens(conversaSelecionada.id);
      
      // Configurar realtime para mensagens
      const channel = supabase
        .channel('mensagens-realtime')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'mensagens',
            filter: `conversa_id=eq.${conversaSelecionada.id}`
          },
          (payload) => {
            console.log('Nova mensagem recebida:', payload);
            setMensagens(prev => [...prev, payload.new as Mensagem]);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [conversaSelecionada]);

  useEffect(() => {
    scrollToBottom();
  }, [mensagens]);

  const scrollToBottom = () => {
    mensagensEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const fetchData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
      }

      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, nome, telefone_contato, cor_perfil");
      
      if (profilesData) {
        setProfiles(profilesData);
      }

      const { data: instanciasData } = await supabase
        .from("instancias_whatsapp")
        .select("id, instancia_id, nome_instancia, cor_identificacao, ativo")
        .neq("status", "deletada"); // Não mostrar instâncias deletadas
      
      if (instanciasData) {
        setInstancias(instanciasData);
      }

      const { data: conversasData, error } = await supabase
        .from("conversas")
        .select("*")
        .order("ultima_interacao", { ascending: false });

      if (error) throw error;
      setConversas(conversasData || []);
    } catch (error) {
      toast.error("Erro ao carregar conversas");
    } finally {
      setLoading(false);
    }
  };

  const fetchMensagens = async (conversaId: string) => {
    try {
      const { data, error } = await supabase
        .from("mensagens")
        .select("*")
        .eq("conversa_id", conversaId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      setMensagens(data || []);
    } catch (error) {
      console.error("Erro ao carregar mensagens:", error);
      toast.error("Erro ao carregar mensagens");
    }
  };

  const subscribeToChanges = () => {
    const channel = supabase
      .channel("conversas-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversas",
        },
        () => {
          fetchData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const handleSelecionarConversa = async (conversa: Conversa) => {
    setConversaSelecionada(conversa);
    setNovaMensagem("");
    
    // Buscar instância de origem
    if (conversa.orig_instance_id) {
      const instOrigem = instancias.find(i => i.id === conversa.orig_instance_id);
      setInstanciaOrigem(instOrigem || null);
    } else {
      setInstanciaOrigem(null);
    }

    // Buscar instância de resposta atual
    if (conversa.current_instance_id) {
      const instResp = instancias.find(i => i.id === conversa.current_instance_id);
      setInstanciaResposta(instResp || null);
    } else if (conversa.orig_instance_id) {
      // Se não tiver current_instance_id, usar a de origem como padrão
      const instResp = instancias.find(i => i.id === conversa.orig_instance_id);
      setInstanciaResposta(instResp || null);
    } else {
      setInstanciaResposta(null);
    }
  };

  const enviarMensagem = async () => {
    if (!novaMensagem.trim()) {
      toast.error("Digite uma mensagem");
      return;
    }

    if (!instanciaResposta) {
      toast.error("Instância WhatsApp não configurada para esta conversa");
      return;
    }

    if (!conversaSelecionada) {
      toast.error("Conversa não encontrada");
      return;
    }

    setEnviando(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        toast.error("Usuário não autenticado");
        setEnviando(false);
        return;
      }

      // Enviar mensagem via Evolution API usando a instância selecionada para resposta
      const { data, error } = await supabase.functions.invoke("enviar-mensagem-evolution", {
        body: {
          conversa_id: conversaSelecionada.id,
          texto: novaMensagem,
          instancia_whatsapp_id: instanciaResposta.id,
          user_id: user.id,
        },
      });

      if (error) throw error;

      if (!data?.success) {
        const errorMsg = data?.code === "INSTANCE_NOT_FOUND" 
          ? "A instância não está conectada na Evolution API"
          : data?.message || "Falha ao enviar mensagem";
        throw new Error(errorMsg);
      }

      // Atualizar última mensagem e interação da conversa
      await supabase
        .from("conversas")
        .update({
          ultima_mensagem: novaMensagem,
          ultima_interacao: new Date().toISOString(),
        })
        .eq("id", conversaSelecionada.id);

      toast.success("Mensagem enviada!");
      setNovaMensagem("");
    } catch (error: any) {
      console.error("Erro ao enviar mensagem:", error);
      toast.error(error.message || "Falha ao enviar mensagem");
    } finally {
      setEnviando(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviarMensagem();
    }
  };

  const handleAssumir = async (conversaId: string) => {
    try {
      const { error } = await supabase
        .from("conversas")
        .update({
          responsavel_atual: currentUserId,
          status: "em_atendimento",
        })
        .eq("id", conversaId);

      if (error) throw error;
      toast.success("Conversa assumida!");
      
      // Selecionar a conversa após assumir
      const conversa = conversas.find(c => c.id === conversaId);
      if (conversa) {
        handleSelecionarConversa(conversa);
      }
    } catch (error) {
      toast.error("Erro ao assumir conversa");
    }
  };

  const handleDragStart = (event: DragEndEvent) => {
    if (event.active?.id) {
      setActiveId(event.active.id as string);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const conversaId = active.id as string;
    const novoResponsavel = over.id as string;

    // Se for soltar na mesma coluna ou na coluna de não atribuídos, não fazer nada
    if (novoResponsavel === "unassigned") return;

    const conversa = conversas.find((c) => c.id === conversaId);
    if (!conversa) return;

    // Se já está na mesma coluna, não fazer nada
    if (conversa.responsavel_atual === novoResponsavel) return;

    const profile = profiles.find((p) => p.id === novoResponsavel);
    if (!profile) return;

    // Abrir modal para anotação
    setPendingTransfer({
      conversaId,
      novoResponsavel,
      nomeResponsavel: profile.nome,
      nomeContato: conversa.nome_contato || conversa.numero_contato,
      numeroContato: conversa.numero_contato,
    });
    setModalOpen(true);
  };

  const handleConfirmTransfer = async (anotacao: string) => {
    if (!pendingTransfer) return;

    try {
      const { conversaId, novoResponsavel, nomeResponsavel } = pendingTransfer;

      // Atualizar conversa
      const { error: updateError } = await supabase
        .from("conversas")
        .update({
          responsavel_atual: novoResponsavel,
          status: "em_atendimento",
          anotacao_transferencia: anotacao,
        })
        .eq("id", conversaId);

      if (updateError) throw updateError;

      // Buscar dados do novo responsável e da conversa
      const { data: profileData } = await supabase
        .from("profiles")
        .select("telefone_contato")
        .eq("id", novoResponsavel)
        .single();

      const conversa = conversas.find((c) => c.id === conversaId);
      
      if (profileData?.telefone_contato && conversa) {
        // Buscar instância ativa para enviar notificação (exceto deletadas)
        const { data: instanciasAtivas } = await supabase
          .from("instancias_whatsapp")
          .select("instancia_id")
          .eq("ativo", true)
          .neq("status", "deletada")
          .limit(1);

        if (instanciasAtivas && instanciasAtivas.length > 0) {
          // Enviar notificação
          await supabase.functions.invoke("notificar-delegacao", {
            body: {
              telefoneResponsavel: profileData.telefone_contato,
              nomeResponsavel,
              numeroContato: conversa.numero_contato,
              nomeContato: conversa.nome_contato,
              anotacao,
              instanceId: instanciasAtivas[0].instancia_id,
            },
          });
        }
      }

      toast.success(`Conversa transferida para ${nomeResponsavel}!`);
      setModalOpen(false);
      setPendingTransfer(null);
    } catch (error) {
      console.error("Erro ao transferir conversa:", error);
      toast.error("Erro ao transferir conversa");
    }
  };

  const groupedConversas = profiles.reduce((acc, profile) => {
    acc[profile.id] = conversas.filter(
      (c) => c.responsavel_atual === profile.id
    );
    return acc;
  }, {} as Record<string, Conversa[]>);

  const unassignedConversas = conversas.filter((c) => !c.responsavel_atual);

  const getInstanciaInfo = (instanciaId: string | null) => {
    if (!instanciaId) return null;
    return instancias.find((i) => i.id === instanciaId);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex h-screen overflow-hidden">
        {/* ÁREA MESTRE (KANBAN) */}
        <div className="w-[450px] border-r bg-[hsl(var(--master-area))] flex flex-col overflow-hidden">
          <div className="p-4 border-b bg-card flex-shrink-0">
            <h1 className="text-2xl font-bold mb-1">Caixa de Entrada</h1>
            <p className="text-sm text-muted-foreground">
              {conversas.length} conversas ativas
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-6">
              {/* Coluna de não atribuídos */}
              <div className="space-y-3">
                <Card className="border-2 border-dashed">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <UserCircle className="h-5 w-5 text-muted-foreground" />
                      Não Atribuído
                    </CardTitle>
                    <Badge variant="secondary" className="w-fit">
                      {unassignedConversas.length}
                    </Badge>
                  </CardHeader>
                </Card>

                <DroppableColumn id="unassigned">
                  {unassignedConversas.length === 0 ? (
                    <Card className="border-dashed">
                      <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                        Nenhuma conversa pendente
                      </CardContent>
                    </Card>
                  ) : (
                    unassignedConversas.map((conversa) => (
                      <DraggableCard
                        key={conversa.id}
                        id={conversa.id}
                        onClick={() => handleSelecionarConversa(conversa)}
                      >
                        <Card 
                          className={`hover:shadow-md transition-all cursor-pointer ${
                            conversaSelecionada?.id === conversa.id ? 'ring-2 ring-primary' : ''
                          }`}
                        >
                          <CardContent className="pt-4 pb-4">
                            <div className="space-y-2">
                              {conversa.instancia_id && getInstanciaInfo(conversa.instancia_id) && (
                                <div className="flex items-center gap-2 pb-2 border-b">
                                  <span 
                                    className="text-xs font-semibold px-2 py-0.5 rounded"
                                    style={{ 
                                      backgroundColor: getInstanciaInfo(conversa.instancia_id)?.cor_identificacao + '20',
                                      color: getInstanciaInfo(conversa.instancia_id)?.cor_identificacao
                                    }}
                                  >
                                    {getInstanciaInfo(conversa.instancia_id)?.nome_instancia}
                                  </span>
                                </div>
                              )}
                              <div>
                                <h3 className="font-semibold text-sm">
                                  {conversa.nome_contato || "Sem nome"}
                                </h3>
                                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                  <Phone className="h-3 w-3" />
                                  {conversa.numero_contato}
                                </p>
                              </div>

                              {conversa.ultima_mensagem && (
                                <p className="text-xs text-muted-foreground line-clamp-2">
                                  {conversa.ultima_mensagem}
                                </p>
                              )}

                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Clock className="h-3 w-3" />
                                  {new Date(conversa.ultima_interacao).toLocaleTimeString("pt-BR", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </div>

                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAssumir(conversa.id);
                                  }}
                                >
                                  Assumir
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </DraggableCard>
                    ))
                  )}
                </DroppableColumn>
              </div>

              {/* Colunas por responsável */}
              {profiles.map((profile) => (
                <div key={profile.id} className="space-y-3">
                  <Card
                    className="border-2"
                    style={{ borderColor: profile.cor_perfil }}
                  >
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <div
                          className="h-3 w-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: profile.cor_perfil }}
                        />
                        <span className="truncate">{profile.nome}</span>
                      </CardTitle>
                      <Badge variant="secondary" className="w-fit">
                        {groupedConversas[profile.id]?.length || 0}
                      </Badge>
                    </CardHeader>
                  </Card>

                  <DroppableColumn id={profile.id}>
                    {(!groupedConversas[profile.id] ||
                      groupedConversas[profile.id].length === 0) ? (
                      <Card className="border-dashed">
                        <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                          Nenhuma conversa
                        </CardContent>
                      </Card>
                    ) : (
                      groupedConversas[profile.id].map((conversa) => (
                        <DraggableCard
                          key={conversa.id}
                          id={conversa.id}
                          onClick={() => handleSelecionarConversa(conversa)}
                        >
                          <Card 
                            className={`hover:shadow-md transition-all cursor-pointer ${
                              conversaSelecionada?.id === conversa.id ? 'ring-2 ring-primary' : ''
                            }`}
                          >
                            <CardContent className="pt-4 pb-4">
                              <div className="space-y-2">
                                {conversa.instancia_id && getInstanciaInfo(conversa.instancia_id) && (
                                  <div className="flex items-center gap-2 pb-2 border-b">
                                    <span 
                                      className="text-xs font-semibold px-2 py-0.5 rounded"
                                      style={{ 
                                        backgroundColor: getInstanciaInfo(conversa.instancia_id)?.cor_identificacao + '20',
                                        color: getInstanciaInfo(conversa.instancia_id)?.cor_identificacao
                                      }}
                                    >
                                      {getInstanciaInfo(conversa.instancia_id)?.nome_instancia}
                                    </span>
                                  </div>
                                )}
                                <div>
                                  <h3 className="font-semibold text-sm">
                                    {conversa.nome_contato || "Sem nome"}
                                  </h3>
                                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                    <Phone className="h-3 w-3" />
                                    {conversa.numero_contato}
                                  </p>
                                </div>

                                {conversa.ultima_mensagem && (
                                  <p className="text-xs text-muted-foreground line-clamp-2">
                                    {conversa.ultima_mensagem}
                                  </p>
                                )}

                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Clock className="h-3 w-3" />
                                  {new Date(conversa.ultima_interacao).toLocaleTimeString("pt-BR", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        </DraggableCard>
                      ))
                    )}
                  </DroppableColumn>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ÁREA DETALHE (CHAT) */}
        <div className="flex-1 bg-[hsl(var(--detail-area))] flex flex-col overflow-hidden">
          {!conversaSelecionada ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-4">
                <MessageSquare className="h-16 w-16 mx-auto text-muted-foreground/50" />
                <div>
                  <h2 className="text-2xl font-semibold mb-2">Selecione uma conversa</h2>
                  <p className="text-muted-foreground">
                    Clique em um card à esquerda para começar
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Header do Chat */}
              <div className="border-b bg-card p-4 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold">
                      {conversaSelecionada.nome_contato || "Sem nome"}
                    </h2>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      {conversaSelecionada.numero_contato}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {instanciaOrigem && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">Origem: </span>
                        <Badge variant="outline">
                          {instanciaOrigem.nome_instancia}
                        </Badge>
                      </div>
                    )}
                    <Badge variant="secondary">
                      {conversaSelecionada.status === "novo" && "Novo"}
                      {conversaSelecionada.status === "Aguardando Contato" && "Aguardando Contato"}
                      {conversaSelecionada.status === "Em Atendimento" && "Em Atendimento"}
                      {conversaSelecionada.status === "Finalizado" && "Finalizado"}
                      {conversaSelecionada.status === "Perdido" && "Perdido"}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Mensagens */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {mensagens.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-muted-foreground">Nenhuma mensagem ainda</p>
                  </div>
                ) : (
                  mensagens.map((mensagem) => (
                    <div
                      key={mensagem.id}
                      className={`flex ${
                        mensagem.remetente === "enviada" ? "justify-end" : "justify-start"
                      }`}
                    >
                      <Card
                        className={`max-w-[70%] ${
                          mensagem.remetente === "enviada"
                            ? "bg-primary text-primary-foreground"
                            : "bg-card"
                        }`}
                      >
                        <CardContent className="p-3">
                          <p className="text-sm whitespace-pre-wrap">{mensagem.conteudo}</p>
                          <div className="flex items-center gap-1 mt-1">
                            <Clock className="h-3 w-3 opacity-70" />
                            <span className="text-xs opacity-70">
                              {format(new Date(mensagem.created_at), "HH:mm", {
                                locale: ptBR,
                              })}
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  ))
                )}
                <div ref={mensagensEndRef} />
              </div>

              {/* Input de Mensagem */}
              <div className="border-t bg-card p-4 flex-shrink-0 space-y-3">
                {/* Dropdown para selecionar instância de resposta */}
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-muted-foreground min-w-fit">
                    Responder via:
                  </label>
                  <select
                    value={instanciaResposta?.id || ""}
                    onChange={async (e) => {
                      const novaInstanciaId = e.target.value;
                      const novaInstancia = instancias.find(i => i.id === novaInstanciaId);
                      setInstanciaResposta(novaInstancia || null);
                      
                      // Atualizar current_instance_id no banco
                      if (conversaSelecionada && novaInstanciaId) {
                        const { error } = await supabase
                          .from("conversas")
                          .update({ current_instance_id: novaInstanciaId })
                          .eq("id", conversaSelecionada.id);
                        
                        if (error) {
                          console.error("Erro ao atualizar instância de resposta:", error);
                          toast.error("Erro ao atualizar instância");
                        } else {
                          toast.success("Instância de resposta atualizada");
                        }
                      }
                    }}
                    className="flex-1 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    disabled={enviando}
                  >
                    <option value="">Selecione uma instância</option>
                    {instancias
                      .filter(i => i.ativo)
                      .map(instancia => (
                        <option key={instancia.id} value={instancia.id}>
                          {instancia.nome_instancia}
                        </option>
                      ))
                    }
                  </select>
                </div>

                <div className="flex gap-2">
                  <Textarea
                    placeholder="Digite sua mensagem..."
                    value={novaMensagem}
                    onChange={(e) => setNovaMensagem(e.target.value)}
                    onKeyPress={handleKeyPress}
                    className="min-h-[60px] max-h-[200px] resize-none"
                    disabled={enviando || !instanciaResposta}
                  />
                  <Button
                    onClick={enviarMensagem}
                    disabled={enviando || !novaMensagem.trim() || !instanciaResposta}
                    size="icon"
                    className="h-[60px] w-[60px] flex-shrink-0"
                  >
                    <Send className="h-5 w-5" />
                  </Button>
                </div>
                {!instanciaResposta && (
                  <p className="text-sm text-destructive">
                    Selecione uma instância para enviar mensagens
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <ModalAnotacaoTransferencia
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setPendingTransfer(null);
        }}
        onConfirm={handleConfirmTransfer}
        nomeResponsavel={pendingTransfer?.nomeResponsavel || ""}
        nomeContato={pendingTransfer?.nomeContato || ""}
      />
    </DndContext>
  );
};
