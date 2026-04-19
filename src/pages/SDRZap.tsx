import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useConversas } from "@/hooks/useConversas";
import { useInstancias } from "@/hooks/useInstancias";
import { ConversationList } from "@/components/sdr-zap/ConversationList";
import { PERFIS_PROFISSIONAIS } from "@/utils/constants";
import { toast } from "sonner";
import { Phone, MessageSquare, User, ChevronDown, Pencil, ArrowRight, FileText, Image as ImageIcon, Video, Mic, Paperclip, Download, Play, ExternalLink, ZoomIn, ZoomOut, X, ChevronLeft, ChevronRight, Search, Plus, UserPlus, MoreVertical, RotateCcw, AlertCircle, Loader2, Camera, RefreshCw, UserCheck, MapPin, Copy, Trash2, Pin, Ban, Clock } from "lucide-react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { DndContext, DragEndEvent, DragOverlay, useSensor, useSensors, PointerSensor, pointerWithin } from "@dnd-kit/core";
import { DraggableCard } from "@/components/DraggableCard";
import { DroppableColumn } from "@/components/DroppableColumn";
import { transferirConversa } from "@/utils/transferirConversa";
import { DragDropInstanceOverlay } from "@/components/DragDropInstanceOverlay";
import { MessageStatusIcon } from "@/components/MessageStatusIcon";
import { ChatInput } from "@/components/ChatInput";
import { MessageActions, ReplyingTo } from "@/components/MessageActions";
import { ReplyContext } from "@/components/ChatInput";
import { useCalendarAction, CalendarVerifyPayload, CalendarConfirmPayload } from "@/hooks/useCalendarAction";
import { CalendarConfirmModal } from "@/components/CalendarConfirmModal";
import { useOverlayApps } from "@/contexts/OverlayAppsContext";
import { getConversaUrgencyColor, getTempoSemResposta } from "@/utils/urgencyHelpers";

interface Contact {
  id: string;
  jid: string;
  phone: string;
  name: string | null;
  created_at?: string;
  updated_at?: string;
  profile_picture_url?: string | null;
  perfil_profissional?: string | null;
  especialidade?: string | null;
  instituicao?: string | null;
  perfil_sugerido_ia?: string | null;
  perfil_confirmado?: boolean | null;
}

interface Conversa {
  id: string;
  contact: Contact;
  instancia_id: string;
  orig_instance_id: string | null;
  current_instance_id: string | null;
  responsavel_atual: string | null;
  ultima_mensagem: string | null;
  ultima_interacao: string | null;
  nome_contato: string | null;
  numero_contato: string;
  foto_contato?: string | null;
  total_mensagens?: number;
  status?: string;
  status_qualificacao?: string;
  tags?: string[];
  unread_count?: number;
  last_message_status?: string;
  last_message_from_me?: boolean;
  fixada?: boolean;
}

interface InstanciaWhatsApp {
  id: string;
  instancia_id: string;
  nome_instancia: string;
  numero_chip: string | null;
  cor_identificacao: string;
  ativo: boolean;
  status: 'ativa' | 'inativa' | 'deletada';
}

interface Mensagem {
  id: string;
  text: string | null;
  from_me: boolean;
  wa_timestamp: number;
  created_at: string;
  status: string;
  message_type: string;
  instancia_whatsapp_id?: string;
  raw_payload?: any;
  media_url?: string | null;
  media_mime_type?: string | null;
  wa_message_id?: string | null;
  sender_jid?: string | null;
  message_context_info?: any;
  is_edited?: boolean;
  // Campos para envio otimista
  _sending?: boolean;
  _error?: boolean;
  _progress?: number; // 0-100 para upload de mídia
  _localMediaUrl?: string; // URL local para preview imediato
  _retryData?: {
    text?: string;
    replyContext?: ReplyContext;
    // Para mídia
    file?: File;
    mediaType?: 'image' | 'video' | 'document' | 'audio';
    caption?: string;
  };
}

interface MessageReaction {
  id: string;
  message_wa_id: string;
  emoji: string;
  from_me: boolean;
  reacted_at: string;
}

export default function SDRZap() {
  const { profile: userProfile } = useCurrentUser();
  const queryClient = useQueryClient();

  // Hooks TanStack Query (substituem useState + fetchInstancias/fetchConversas)
  const { data: instancias = [] } = useInstancias();
  const {
    data: conversasPorInstancia = {},
    isLoading: loading,
    invalidate: invalidateConversas,
  } = useConversas();

  const [conversaSelecionada, setConversaSelecionada] = useState<Conversa | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [messageReactions, setMessageReactions] = useState<Record<string, MessageReaction[]>>({});
  const [novaMensagem, setNovaMensagem] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [instanciasSelecionadasCol1, setInstanciasSelecionadasCol1] = useState<string[]>([]);
  const [nomeColuna1, setNomeColuna1] = useState("Todos");
  const [editandoColuna1, setEditandoColuna1] = useState(false);
  const [tempNomeCol1, setTempNomeCol1] = useState("");
  const [editandoNomeContato, setEditandoNomeContato] = useState(false);
  const [novoNomeContato, setNovoNomeContato] = useState("");
  const [instanciaSelecionada, setInstanciaSelecionada] = useState<string | null>(null);
  const [instanciasEnvio, setInstanciasEnvio] = useState<InstanciaWhatsApp[]>([]);
  const [erroInstancia, setErroInstancia] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragCounterCol3, setDragCounterCol3] = useState(0);
  const [externalFilesCol3, setExternalFilesCol3] = useState<File[]>([]);
  const [imagePreview, setImagePreview] = useState<{ src: string; index: number } | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  
  // Estados para nova conversa (busca e filter pills agora são internos ao ConversationList)
  const [modalNovaConversa, setModalNovaConversa] = useState(false);
  const [numeroNovaConversa, setNumeroNovaConversa] = useState("");
  const [verificandoNumero, setVerificandoNumero] = useState(false);
  const [sincronizandoFotos, setSincronizandoFotos] = useState(false);
  const [sincronizandoNomes, setSincronizandoNomes] = useState(false);
  const [sincronizandoHistorico, setSincronizandoHistorico] = useState(false);
  const [carregandoMaisHistorico, setCarregandoMaisHistorico] = useState(false);
  const [historicoPage, setHistoricoPage] = useState(1);
  const [historicoTotalPages, setHistoricoTotalPages] = useState<number | null>(null);
  // Estados para tamanho dos painéis (responsividade)
  const [col1Size, setCol1Size] = useState(28);
  const [col2Size, setCol2Size] = useState(28);
  const [col1Minimizada, setCol1Minimizada] = useState(false);
  
  // Estado para reply WhatsApp style
  const [replyingTo, setReplyingTo] = useState<ReplyingTo | null>(null);

  // Hook para ações do calendário e configurações de apps
  const calendarAction = useCalendarAction();
  const { isAppEnabled, mainWebhookUrl } = useOverlayApps();
  const [calendarModalOpen, setCalendarModalOpen] = useState(false);
  const [calendarConversaId, setCalendarConversaId] = useState<string | null>(null);

  // Follow-up
  const [followUpConversaId, setFollowUpConversaId] = useState<string | null>(null);
  const [followUpData, setFollowUpData] = useState("");
  const [followUpNota, setFollowUpNota] = useState("");

  // Função para minimizar/expandir coluna 1
  const toggleCol1 = () => {
    setCol1Minimizada(!col1Minimizada);
  };
  
  // Modifier para centralizar a bolinha no cursor usando posição do mouse
  const snapCenterToCursor = ({ activatorEvent, draggingNodeRect, transform }: any) => {
    if (activatorEvent && draggingNodeRect) {
      const activatorCoordinates = {
        x: (activatorEvent as MouseEvent).pageX,
        y: (activatorEvent as MouseEvent).pageY,
      };

      const offsetX = activatorCoordinates.x - draggingNodeRect.left - draggingNodeRect.width / 2;
      const offsetY = activatorCoordinates.y - draggingNodeRect.top - draggingNodeRect.height / 2;

      return {
        ...transform,
        x: transform.x + offsetX,
        y: transform.y + offsetY,
      };
    }

    return transform;
  };
  
  // Configurar sensores para drag & drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );
  
  // Coleções separadas para lógica futura
  const [conversasMinhaInstancia, setConversasMinhaInstancia] = useState<Conversa[]>([]);
  const [conversasOutrasInstancias, setConversasOutrasInstancias] = useState<Conversa[]>([]);
  
  const mensagensEndRef = useRef<HTMLDivElement>(null);

  // Carregar filtros e nome da coluna salvos do localStorage ao montar o componente
  useEffect(() => {
    const filtrosSalvos = localStorage.getItem('sdrzap_filtros_col1');
    if (filtrosSalvos) {
      try {
        const filtros = JSON.parse(filtrosSalvos);
        setInstanciasSelecionadasCol1(filtros);
      } catch (error) {
        console.error('Erro ao carregar filtros salvos:', error);
      }
    }

    const nomeColunaSalvo = localStorage.getItem('sdrzap_nome_col1');
    if (nomeColunaSalvo) {
      setNomeColuna1(nomeColunaSalvo);
    }
  }, []);

  // Salvar filtros no localStorage sempre que mudarem
  useEffect(() => {
    // Sempre salvar o estado dos filtros, mesmo quando vazio
    localStorage.setItem('sdrzap_filtros_col1', JSON.stringify(instanciasSelecionadasCol1));
  }, [instanciasSelecionadasCol1]);

  // Salvar nome da coluna no localStorage sempre que mudar
  useEffect(() => {
    if (nomeColuna1 !== "Todos") {
      localStorage.setItem('sdrzap_nome_col1', nomeColuna1);
    }
  }, [nomeColuna1]);

  // Realtime global removido: useConversas já mantém a lista sincronizada via
  // seu próprio canal "conversas-realtime" com debounce interno.
  // Sincronização inicial de instâncias + fetch de instanciasEnvio acontece abaixo.
  useEffect(() => {
    sincronizarInstancias();
    fetchInstanciasEnvio();
  }, []);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let reactionsChannel: ReturnType<typeof supabase.channel> | null = null;
    let isMounted = true;

    const loadConversaMessages = async () => {
      if (!conversaSelecionada) {
        console.log('[SDRZap] Nenhuma conversa selecionada');
        return;
      }

      const conversaId = conversaSelecionada.id;
      const contactId = conversaSelecionada.contact.id;
      // Usar sempre o ID REAL da instância do WhatsApp (uuid), mesmo para instâncias deletadas
      const instanciaId =
        conversaSelecionada.current_instance_id ||
        conversaSelecionada.orig_instance_id ||
        (conversaSelecionada.instancia_id === 'DELETED_INSTANCES'
          ? null
          : conversaSelecionada.instancia_id);

      if (!instanciaId) {
        console.warn('[SDRZap] Nenhuma instanciaId válida encontrada para a conversa, carregando mensagens sem filtrar por instância');
      }

      console.log('[SDRZap] Carregando mensagens para conversa:', { conversaId, contactId, instanciaId });

      // Detectar se é conversa interna (entre duas instâncias ativas diferentes)
      const numeroContato = conversaSelecionada.numero_contato;
      const instanciaDestinataria = instancias.find(
        inst => inst.numero_chip?.replace(/\D/g, '') === numeroContato && 
                inst.id !== instanciaId && // Não é a mesma instância
                inst.ativo === true // Está ativa
      );
      const isConversaInterna = !!instanciaDestinataria;

      console.log('[SDRZap] Conversa interna?', { 
        isConversaInterna, 
        numeroContato,
        instanciaDestinataria: instanciaDestinataria?.nome_instancia 
      });

      // Helper: monta a query de mensagens (compartilhada entre load inicial e re-fetch pós-sync)
      const buildMessagesQuery = () => {
        let q = supabase
          .from("messages")
          .select("id, text, from_me, wa_timestamp, created_at, status, message_type, instancia_whatsapp_id, media_url, media_mime_type, wa_message_id, sender_jid, raw_payload, is_edited")
          .eq("contact_id", contactId) as any;

        if (isConversaInterna && instanciaId && instanciaDestinataria) {
          q = q.or(`instancia_whatsapp_id.eq.${instanciaId},instancia_whatsapp_id.eq.${instanciaDestinataria.id}`);
        } else if (instanciaId) {
          q = q.eq("instancia_whatsapp_id", instanciaId);
        }
        return q.order("created_at", { ascending: true });
      };

      // 1. CARREGA IMEDIATAMENTE do banco (sem esperar Evolution API)
      const { data, error } = await buildMessagesQuery();

      if (!isMounted) {
        console.log('[SDRZap] Componente desmontado, abortando');
        return;
      }

      if (error) {
        console.error('[SDRZap] Erro ao buscar mensagens:', error);
        toast.error("Erro ao carregar mensagens");
        return;
      }

      console.log('[SDRZap] Mensagens carregadas (DB):', data?.length || 0);
      setMensagens(data || []);

      // 2. SINCRONIZAÇÃO EM BACKGROUND com Evolution API (não bloqueia a UI)
      //    Se retornar mensagens novas, faz re-fetch silencioso para atualizar.
      if (instanciaId && !isConversaInterna) {
        setSincronizandoHistorico(true);
        (async () => {
          try {
            const { data: syncResult, error: syncError } = await supabase.functions.invoke(
              "sincronizar-historico-mensagens",
              {
                body: {
                  contact_id: contactId,
                  instancia_id: instanciaId,
                  limit: 50,
                  page: 1,
                }
              }
            );

            if (syncError) {
              console.error('[SDRZap] Erro ao sincronizar histórico:', syncError);
              return;
            }

            if (!isMounted) return;
            setHistoricoPage(syncResult?.currentPage ?? 1);
            setHistoricoTotalPages(syncResult?.pages ?? null);

            if (syncResult?.novas_inseridas > 0) {
              console.log(`[SDRZap] Sincronização: ${syncResult.novas_inseridas} novas mensagens — re-fetching`);
              const { data: fresh } = await buildMessagesQuery();
              if (isMounted && fresh) setMensagens(fresh);
            }
          } catch (syncErr) {
            console.error('[SDRZap] Erro na sincronização:', syncErr);
          } finally {
            if (isMounted) setSincronizandoHistorico(false);
          }
        })();
      }

      // 1.5. Buscar reações para as mensagens carregadas
      if (data && data.length > 0) {
        const waMessageIds = data.filter(m => m.wa_message_id).map(m => m.wa_message_id!);
        if (waMessageIds.length > 0) {
          const { data: reactions, error: reactionsError } = await supabase
            .from("message_reactions")
            .select("id, message_wa_id, emoji, from_me, reacted_at")
            .in("message_wa_id", waMessageIds);
          
          if (reactionsError) {
            console.error("[SDRZap] Erro ao buscar reações:", reactionsError);
          } else if (reactions && reactions.length > 0) {
            console.log('[SDRZap] Reações carregadas:', reactions.length);
            const reactionsMap: Record<string, MessageReaction[]> = {};
            reactions.forEach(r => {
              if (!reactionsMap[r.message_wa_id]) {
                reactionsMap[r.message_wa_id] = [];
              }
              reactionsMap[r.message_wa_id].push(r);
            });
            setMessageReactions(reactionsMap);
          }
        }
      }

      // 2. Configurar Realtime para inserções e deleções
      const channelName = `messages-${contactId}-${instanciaId}`;
      console.log('[SDRZap] Configurando canal realtime:', channelName);

      channel = supabase
        .channel(channelName)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `contact_id=eq.${contactId}`,
          },
          (payload) => {
            console.log('[SDRZap] Nova mensagem recebida via realtime:', payload);
            const newMsg = payload.new as any;
            
            // Para conversas internas, aceitar mensagens de ambas as instâncias
            const shouldAddMessage = isConversaInterna 
              ? (newMsg.instancia_whatsapp_id === instanciaId || 
                 newMsg.instancia_whatsapp_id === instanciaDestinataria?.id)
              : (newMsg.instancia_whatsapp_id === instanciaId);
            
            if (shouldAddMessage) {
              setMensagens((prev) => {
                // Verificar se a mensagem já existe (evitar duplicatas)
                const existingIndex = prev.findIndex(m => 
                  m.id === newMsg.id || 
                  m.wa_message_id === newMsg.wa_message_id
                );
                
                const newMsgFormatted = {
                  id: newMsg.id,
                  text: newMsg.text,
                  from_me: newMsg.from_me,
                  wa_timestamp: newMsg.wa_timestamp,
                  created_at: newMsg.created_at,
                  status: newMsg.status,
                  message_type: newMsg.message_type,
                  media_url: newMsg.media_url,
                  media_mime_type: newMsg.media_mime_type,
                  wa_message_id: newMsg.wa_message_id,
                  message_context_info: newMsg.message_context_info,
                  instancia_whatsapp_id: newMsg.instancia_whatsapp_id,
                };
                
                if (existingIndex !== -1) {
                  const existingMsg = prev[existingIndex];
                  // Se a mensagem nova tem reply context e a existente não, substituir
                  const newHasReply = !!newMsgFormatted.message_context_info?.quotedMessageId;
                  const existingHasReply = !!existingMsg.message_context_info?.quotedMessageId;
                  
                  if (newHasReply && !existingHasReply) {
                    console.log('[SDRZap] Substituindo mensagem sem reply por mensagem com reply');
                    const updated = [...prev];
                    updated[existingIndex] = newMsgFormatted;
                    return updated;
                  }
                  
                  console.log('[SDRZap] Mensagem já existe, ignorando duplicata');
                  return prev;
                }
                
                // Verificar se é uma mensagem enviada que substitui uma otimista pendente
                // Mensagens otimistas têm IDs que começam com "temp-" ou "sent-"
                if (newMsg.from_me) {
                  const optimisticIndex = prev.findIndex(m => {
                    const isOptimistic = m.id?.toString().startsWith('temp-') || 
                                         m.wa_message_id?.toString().startsWith('sent-');
                    if (!isOptimistic) return false;

                    // Preferir casar por tipo + instância + proximidade de timestamp
                    const sameType = m.message_type === newMsg.message_type;
                    const sameInstance = m.instancia_whatsapp_id === newMsg.instancia_whatsapp_id;
                    const sameText = m.text === newMsg.text;
                    const closeInTime = Math.abs((m.wa_timestamp || 0) - (newMsg.wa_timestamp || 0)) < 120; // 2 min

                    return m.from_me && sameType && sameInstance && (closeInTime || sameText);
                  });

                  if (optimisticIndex !== -1) {
                    console.log('[SDRZap] Substituindo mensagem otimista pela real');
                    const optimistic = prev[optimisticIndex];
                    const updated = [...prev];

                    updated[optimisticIndex] = {
                      ...optimistic,
                      ...newMsgFormatted,
                      // Manter preview local se a mensagem real ainda não veio com URL
                      media_url: newMsgFormatted.media_url || optimistic.media_url || optimistic._localMediaUrl,
                      _localMediaUrl: optimistic._localMediaUrl,
                      _sending: false,
                      _error: false,
                      _progress: 100,
                      _retryData: undefined,
                    };

                    return updated;
                  }
                }
                
                console.log('[SDRZap] Adicionando nova mensagem ao histórico existente');
                return [...prev, newMsgFormatted];
              });
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "messages",
            filter: `contact_id=eq.${contactId}`,
          },
          (payload) => {
            console.log('[SDRZap] Mensagem deletada via realtime:', payload);
            const deletedMsg = payload.old as any;
            setMensagens((prev) => {
              console.log('[SDRZap] Removendo mensagem do histórico');
              return prev.filter(msg => msg.id !== deletedMsg.id);
            });
          }
        )
        .subscribe((status) => {
          console.log('[SDRZap] Status do canal realtime (messages):', status);
        });
      
      // Canal para reações em tempo real
      reactionsChannel = supabase
        .channel(`reactions-${contactId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "message_reactions",
          },
          (payload) => {
            console.log('[SDRZap] Evento de reação via realtime:', payload);
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              const reaction = payload.new as any;
              setMessageReactions((prev) => {
                const updated = { ...prev };
                if (!updated[reaction.message_wa_id]) {
                  updated[reaction.message_wa_id] = [];
                }
                // Remove existing reaction from same user if exists
                updated[reaction.message_wa_id] = updated[reaction.message_wa_id].filter(
                  r => r.from_me !== reaction.from_me
                );
                updated[reaction.message_wa_id].push(reaction);
                return updated;
              });
            } else if (payload.eventType === 'DELETE') {
              const deleted = payload.old as any;
              setMessageReactions((prev) => {
                const updated = { ...prev };
                if (updated[deleted.message_wa_id]) {
                  updated[deleted.message_wa_id] = updated[deleted.message_wa_id].filter(
                    r => r.id !== deleted.id
                  );
                }
                return updated;
              });
            }
          }
        )
        .subscribe((status) => {
          console.log('[SDRZap] Status do canal realtime (reactions):', status);
        });
    };

    loadConversaMessages();

    return () => {
      console.log('[SDRZap] Cleanup - removendo canais');
      isMounted = false;
      if (channel) {
        supabase.removeChannel(channel);
      }
      if (reactionsChannel) {
        supabase.removeChannel(reactionsChannel);
      }
    };
  }, [conversaSelecionada?.id]);

  useEffect(() => {
    // Resetar paginação do histórico ao trocar de conversa
    setHistoricoPage(1);
    setHistoricoTotalPages(null);
  }, [conversaSelecionada?.id]);

  useEffect(() => {
    mensagensEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens]);
  // Polling para atualizar status das instâncias em tempo real
  useEffect(() => {
    const interval = setInterval(() => {
      fetchInstanciasEnvio();
    }, 60000); // A cada 60 segundos (era 5s — reduzido para economizar queries)

    return () => clearInterval(interval);
  }, []);

  // Substitui o canal Realtime "instancias-changes" removido: quando a lista de
  // instâncias (do useInstancias) muda, ressincroniza o estado local de envio.
  const instanciasSignature = useMemo(
    () => instancias.map(i => i.id).sort().join(','),
    [instancias]
  );
  useEffect(() => {
    if (instanciasSignature) fetchInstanciasEnvio();
  }, [instanciasSignature]);

  // Setar instância selecionada quando conversa é selecionada
  useEffect(() => {
    if (conversaSelecionada) {
      // Usar current_instance_id ou orig_instance_id como fallback
      const instanciaId = conversaSelecionada.current_instance_id || conversaSelecionada.orig_instance_id;
      console.log('[SDRZap] Setando instância selecionada:', instanciaId);
      setInstanciaSelecionada(instanciaId);
    } else {
      setInstanciaSelecionada(null);
    }
  }, [conversaSelecionada?.id]);

  // Separar conversas por instância do usuário logado
  useEffect(() => {
    if (!userProfile?.instancia_padrao_id) {
      // Se usuário não tem instância padrão, todas vão para "outras"
      const todasConversas = Object.values(conversasPorInstancia).flat();
      setConversasMinhaInstancia([]);
      setConversasOutrasInstancias(todasConversas);
      return;
    }

    const minhas: Conversa[] = [];
    const outras: Conversa[] = [];

    Object.entries(conversasPorInstancia).forEach(([instanciaId, conversas]) => {
      conversas.forEach(conversa => {
        // Verificar se a conversa pertence à instância do usuário
        const pertenceAoUsuario = conversa.instancia_id === userProfile.instancia_padrao_id;
        
        if (pertenceAoUsuario) {
          minhas.push(conversa);
        } else {
          outras.push(conversa);
        }
      });
    });

    setConversasMinhaInstancia(minhas);
    setConversasOutrasInstancias(outras);

    console.log('[SDRZap] Conversas separadas:', {
      minhas: minhas.length,
      outras: outras.length,
      instanciaPadraoUsuario: userProfile.instancia_padrao_id,
    });
  }, [conversasPorInstancia, userProfile]);

  const sincronizarInstancias = async () => {
    try {
      // Buscar instâncias da Evolution API
      const { data: evolutionData } = await supabase.functions.invoke("listar-instancias-evolution");
      
      if (!evolutionData?.instances) return;

      // Buscar instâncias locais não deletadas
      const { data: localData } = await supabase
        .from("instancias_whatsapp")
        .select("id, instancia_id, nome_instancia, status")
        .neq("status", "deletada");

      if (!localData) return;

      // Obter IDs das instâncias que existem na Evolution
      const evolutionInstanceIds = evolutionData.instances.map((evol: any) => 
        evol.name || evol.instance?.instanceName || evol.instanceName
      );

      // Atualizar status de conexão das instâncias que não existem na Evolution
      // NÃO marcar como deletada - apenas atualizar connection_status
      for (const localInst of localData) {
        const existeNaEvolution = evolutionInstanceIds.includes(localInst.instancia_id) || 
                                   evolutionInstanceIds.includes(localInst.nome_instancia);
        
        if (!existeNaEvolution && localInst.status !== 'deletada') {
          // Apenas atualizar connection_status para disconnected, NÃO deletar
          // Instância só deve ser marcada como deletada quando usuário explicitamente deletar
          console.log(`[SDRZap] Instância ${localInst.nome_instancia} não encontrada na Evolution - marcando como desconectada`);
          await supabase
            .from("instancias_whatsapp")
            .update({ connection_status: 'disconnected' })
            .eq("id", localInst.id);
        }
      }
    } catch (error) {
      console.error("Erro ao sincronizar instâncias:", error);
    }
  };

  const fetchMensagens = async (contactId: string, _instanciaWhatsappId?: string) => {
    try {
      // Buscar TODAS as mensagens do contato, independente da instância
      // Isso permite ver o histórico completo mesmo quando conversas são transferidas
      const { data, error } = await supabase
        .from("messages")
        .select("id, text, from_me, wa_timestamp, created_at, status, message_type, raw_payload, instancia_whatsapp_id, media_url, media_mime_type, wa_message_id, message_context_info, is_edited")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      setMensagens(data || []);
      
      // Buscar reações para todas as mensagens
      if (data && data.length > 0) {
        const waMessageIds = data.filter(m => m.wa_message_id).map(m => m.wa_message_id!);
        if (waMessageIds.length > 0) {
          const { data: reactions, error: reactionsError } = await supabase
            .from("message_reactions")
            .select("id, message_wa_id, emoji, from_me, reacted_at")
            .in("message_wa_id", waMessageIds);
          
          if (reactionsError) {
            console.error("Erro ao buscar reações:", reactionsError);
          } else if (reactions) {
            // Agrupar reações por message_wa_id
            const reactionsMap: Record<string, MessageReaction[]> = {};
            reactions.forEach(r => {
              if (!reactionsMap[r.message_wa_id]) {
                reactionsMap[r.message_wa_id] = [];
              }
              reactionsMap[r.message_wa_id].push(r);
            });
            setMessageReactions(reactionsMap);
          }
        }
      }
    } catch (error) {
      console.error("Erro ao buscar mensagens:", error);
      toast.error("Erro ao carregar mensagens");
    }
  };

  const handleSelecionarConversa = async (conversa: Conversa) => {
    // Toggle: se clicar no mesmo contato, desseleciona
    if (conversaSelecionada?.id === conversa.id) {
      console.log('[SDRZap] Conversa desselecionada:', conversa.id);
      setConversaSelecionada(null);
      setEditandoNomeContato(false);
      setNovoNomeContato("");
      setInstanciaSelecionada(null);
    } else {
      console.log('[SDRZap] Conversa selecionada:', conversa.id);
      setConversaSelecionada(conversa);
      setEditandoNomeContato(false);
      setNovoNomeContato("");
      
      // Marcar mensagens como lidas
      if (conversa.unread_count && conversa.unread_count > 0) {
        try {
          await supabase.functions.invoke('marcar-mensagens-lidas', {
            body: { conversaId: conversa.id }
          });

          // Atualizar contador localmente no cache do TanStack Query
          queryClient.setQueryData<Record<string, Conversa[]>>(['conversas'], (old) => {
            if (!old) return old;
            const updated: Record<string, Conversa[]> = {};
            Object.keys(old).forEach(instId => {
              updated[instId] = old[instId].map(c =>
                c.id === conversa.id ? { ...c, unread_count: 0 } : c
              );
            });
            return updated;
          });
        } catch (error) {
          console.error('Erro ao marcar mensagens como lidas:', error);
        }
      }

      // Sincronizar foto e nome do contato automaticamente (em background)
      if (conversa.contact?.id) {
        supabase.functions.invoke('sincronizar-contato-individual', {
          body: { contact_id: conversa.contact.id }
        }).then(({ data }) => {
          if (data?.updated_photo || data?.updated_name) {
            console.log('[SDRZap] Contato atualizado:', data);
            // Atualizar estado local com os novos dados
            const updatedContact = { ...conversa.contact };
            if (data.new_photo) updatedContact.profile_picture_url = data.new_photo;
            if (data.new_name) updatedContact.name = data.new_name;
            
            setConversaSelecionada(prev => prev ? {
              ...prev,
              contact: updatedContact,
              foto_contato: data.new_photo || prev.foto_contato,
              nome_contato: data.new_name || prev.nome_contato,
            } : null);

            // Atualizar nas listas
            invalidateConversas();
          }
        }).catch(err => {
          console.error('[SDRZap] Erro ao sincronizar contato:', err);
        });
      }
    }
  };

  const handleSalvarNomeContato = async () => {
    if (!conversaSelecionada || !novoNomeContato.trim()) return;

    try {
      const { error } = await supabase
        .from("contacts")
        .update({ name: novoNomeContato.trim() })
        .eq("id", conversaSelecionada.contact.id);

      if (error) throw error;

      // Atualizar estado local
      setConversaSelecionada({
        ...conversaSelecionada,
        contact: {
          ...conversaSelecionada.contact,
          name: novoNomeContato.trim()
        }
      });

      // Atualizar conversas na lista (cache TanStack Query)
      queryClient.setQueryData<Record<string, Conversa[]>>(['conversas'], (old) => {
        if (!old) return old;
        const updated: Record<string, Conversa[]> = {};
        Object.keys(old).forEach(instanciaId => {
          updated[instanciaId] = old[instanciaId].map(conv =>
            conv.id === conversaSelecionada.id
              ? {
                  ...conv,
                  contact: {
                    ...conv.contact,
                    name: novoNomeContato.trim()
                  }
                }
              : conv
          );
        });
        return updated;
      });

      setEditandoNomeContato(false);
      setNovoNomeContato("");
      toast.success("Nome atualizado com sucesso");
    } catch (error) {
      console.error("Erro ao atualizar nome:", error);
      toast.error("Erro ao atualizar nome do contato");
    }
  };

  const enviarMensagem = async () => {
    if (!novaMensagem.trim() || !conversaSelecionada) return;

    // Validar se há instância selecionada
    if (!instanciaSelecionada) {
      setErroInstancia(true);
      toast.error("Selecione uma instância para enviar a mensagem");
      
      // Remover o efeito de piscar após a animação
      setTimeout(() => {
        setErroInstancia(false);
      }, 1000);
      return;
    }

    // Avisar se a instância está desconectada, mas permitir tentativa
    const instanciaAtiva = instanciasEnvio.find(i => i.id === instanciaSelecionada);
    if (instanciaAtiva && !instanciaAtiva.ativo) {
      toast.warning("⚠️ A instância está desconectada. O envio pode falhar.");
    }

    setEnviando(true);
    try {
      console.log('[SDRZap] Enviando mensagem...');
      
      // Buscar conversa_id na tabela conversas usando a instância selecionada
      const { data: conversaDb, error: conversaError } = await supabase
        .from('conversas')
        .select('id, numero_contato, current_instance_id')
        .eq('numero_contato', conversaSelecionada.contact.phone)
        .eq('current_instance_id', instanciaSelecionada)
        .maybeSingle();

      let conversa_id: string;

      if (conversaError || !conversaDb) {
        // Se não existe conversa na tabela conversas, criar uma
        console.log('[SDRZap] Criando nova conversa no banco...');
        const { data: novaConversa, error: criarError } = await supabase
          .from('conversas')
          .insert({
            numero_contato: conversaSelecionada.contact.phone,
            nome_contato: conversaSelecionada.contact.name,
            current_instance_id: instanciaSelecionada,
            orig_instance_id: conversaSelecionada.instancia_id,
            status: 'novo',
            ultima_mensagem: novaMensagem,
            ultima_interacao: new Date().toISOString()
          })
          .select()
          .single();

        if (criarError || !novaConversa) {
          console.error('[SDRZap] Erro ao criar conversa:', criarError);
          throw new Error('Erro ao criar conversa no banco');
        }

        conversa_id = novaConversa.id;
        console.log('[SDRZap] Conversa criada com ID:', conversa_id);
      } else {
        conversa_id = conversaDb.id;
        console.log('[SDRZap] Usando conversa existente:', conversa_id);
      }

      // Enviar via edge function (que usa conversa_id e instancia_whatsapp_id)
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        toast.error("Usuário não autenticado");
        setEnviando(false);
        return;
      }

      // Log detalhado antes de enviar - incluindo dados da instância
      const instanciaDados = instanciasEnvio.find(i => i.id === instanciaSelecionada);
      console.log('[SDRZap] Enviando mensagem:', {
        conversa_id,
        instancia_selecionada_uuid: instanciaSelecionada,
        instancia_dados: instanciaDados ? {
          id: instanciaDados.id,
          instancia_id: instanciaDados.instancia_id,
          nome: instanciaDados.nome_instancia,
          ativo: instanciaDados.ativo,
          status: instanciaDados.status
        } : 'NÃO ENCONTRADA',
        numero_contato: conversaSelecionada.contact.phone,
        user_id: user.id
      });

      const { data, error } = await supabase.functions.invoke("enviar-mensagem-evolution", {
        body: {
          conversa_id: conversa_id,
          texto: novaMensagem,
          instancia_whatsapp_id: instanciaSelecionada, // UUID da instância selecionada no dropdown
          user_id: user.id,
        },
      });

      console.log('[SDRZap] Resposta da edge function:', data);

      if (error) {
        console.error('[SDRZap] Erro da edge function:', error);
        throw error;
      }

      // Verificar se houve erro no retorno
      if (data && !data.success) {
        // Log detalhado do erro
        console.error('[SDRZap] Erro no envio:', {
          code: data.code,
          message: data.message,
          details: data.details,
          instance: data.instance
        });
        
        const errorMessages: Record<string, string> = {
          'MISSING_FIELDS': 'Campos obrigatórios não fornecidos',
          'CONVERSA_NAO_ENCONTRADA': 'Conversa não encontrada no banco',
          'SEM_INSTANCIA': 'Nenhuma instância WhatsApp especificada para envio',
          'INSTANCIA_NAO_ENCONTRADA': 'Instância WhatsApp não encontrada',
          'INSTANCIA_INATIVA': 'A instância selecionada está inativa',
          'EVOLUTION_INSTANCE_NOT_FOUND': 'A instância não está conectada na Evolution API. Verifique se o WhatsApp está ativo.',
          'CONFIG_ERROR': 'Erro ao buscar configuração da Evolution API',
          'MISSING_API_KEY': 'Evolution API Key não configurada',
          'EVOLUTION_SEND_ERROR': `Erro ao enviar via Evolution API (status ${data.status || 'desconhecido'})`,
          'INTERNAL_ERROR': 'Erro interno no servidor',
        };
        
        const friendlyMessage = errorMessages[data.code] || data.message || 'Erro desconhecido ao enviar mensagem';
        toast.error(friendlyMessage, {
          description: data.details ? `Detalhes: ${JSON.stringify(data.details).substring(0, 100)}...` : undefined,
          duration: 6000,
        });
        setEnviando(false);
        return;
      }

      // A edge function já registra a mensagem no banco (tabela mensagens)
      // O webhook da Evolution também registra na tabela messages
      // Não precisamos inserir manualmente aqui para evitar duplicação

      setNovaMensagem("");
      toast.success("Mensagem enviada com sucesso!");
      console.log('[SDRZap] Mensagem enviada e registrada');
    } catch (error) {
      console.error("[SDRZap] Erro ao enviar mensagem:", error);
      toast.error("Erro ao enviar mensagem. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  };

  const handleSendMedia = async (file: File, type: 'image' | 'video' | 'document' | 'audio', caption?: string, tempMsgId?: string) => {
    if (!conversaSelecionada) {
      toast.error("Selecione uma conversa");
      return;
    }

    if (!instanciaSelecionada) {
      setErroInstancia(true);
      toast.error("Selecione uma instância para enviar");
      return;
    }

    const instancia = instanciasEnvio.find((i) => i.id === instanciaSelecionada);
    const timestamp = Math.floor(Date.now() / 1000);
    const optimisticMsgId = tempMsgId || `temp-media-${Date.now()}-${Math.random()}`;
    
    // Criar URL local para preview imediato
    const localMediaUrl = URL.createObjectURL(file);
    
    // ENVIO OTIMISTA: Adicionar mensagem imediatamente com status PENDING
    if (!tempMsgId) {
      setMensagens(prev => [...prev, {
        id: optimisticMsgId,
        text: caption || (type === 'image' ? '📷 Foto' : type === 'video' ? '🎬 Vídeo' : type === 'audio' ? '🎤 Áudio' : `📎 ${file.name}`),
        from_me: true,
        wa_timestamp: timestamp,
        created_at: new Date().toISOString(),
        status: "PENDING",
        message_type: type,
        instancia_whatsapp_id: instancia?.id,
        wa_message_id: optimisticMsgId,
        media_url: localMediaUrl,
        media_mime_type: file.type,
        _sending: true,
        _progress: 0,
        _localMediaUrl: localMediaUrl,
        _retryData: { file, mediaType: type, caption }
      }]);
    } else {
      // Retry: Atualizar mensagem para estado de envio
      setMensagens(prev => prev.map(m => 
        m.id === tempMsgId ? { ...m, _sending: true, _error: false, _progress: 0, status: "PENDING" } : m
      ));
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Usuário não autenticado");
        setMensagens(prev => prev.map(m => 
          m.id === optimisticMsgId ? { ...m, _sending: false, _error: true, status: "FAILED" } : m
        ));
        return;
      }

      // Buscar ou criar conversa
      let conversa_id = conversaSelecionada.id;
      const { data: conversaDb } = await supabase
        .from("conversas")
        .select("id")
        .eq("numero_contato", conversaSelecionada.contact.phone)
        .maybeSingle();
      
      if (!conversaDb) {
        const { data: novaConversa } = await supabase
          .from("conversas")
          .insert({
            numero_contato: conversaSelecionada.contact.phone,
            nome_contato: conversaSelecionada.contact.name,
            contact_id: conversaSelecionada.contact.id,
            orig_instance_id: instanciaSelecionada,
            current_instance_id: instanciaSelecionada,
            instancia_id: instanciaSelecionada,
            status: "ativo",
          })
          .select("id")
          .single();
        if (novaConversa) conversa_id = novaConversa.id;
      } else {
        conversa_id = conversaDb.id;
      }

      // Atualizar progresso para 30% (preparação concluída)
      setMensagens(prev => prev.map(m => 
        m.id === optimisticMsgId ? { ...m, _progress: 30 } : m
      ));

      const formData = new FormData();
      formData.append('conversa_id', conversa_id);
      formData.append('instancia_whatsapp_id', instanciaSelecionada);
      formData.append('user_id', user.id);
      formData.append('media_type', type);
      formData.append('file', file);
      if (caption) {
        formData.append('caption', caption);
      }

      // Atualizar progresso para 50% (iniciando upload)
      setMensagens(prev => prev.map(m => 
        m.id === optimisticMsgId ? { ...m, _progress: 50 } : m
      ));

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/enviar-midia-evolution`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: formData
        }
      );

      // Atualizar progresso para 80% (upload concluído, aguardando resposta)
      setMensagens(prev => prev.map(m => 
        m.id === optimisticMsgId ? { ...m, _progress: 80 } : m
      ));

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'Erro ao enviar mídia');
      }

      // Sucesso: Atualizar mensagem para SENT
      setMensagens(prev => prev.map(m => 
        m.id === optimisticMsgId ? { 
          ...m, 
          _sending: false, 
          _error: false, 
          _progress: 100,
          status: "SENT",
          _retryData: undefined,
          // Ajudar o realtime a deduplicar/substituir a mensagem otimista
          wa_message_id: data?.waMessageId || m.wa_message_id,
          // Se a função retornou URL pública, já atualizar (senão mantém preview local)
          media_url: data?.mediaUrl || m.media_url,
        } : m
      ));
      
      // Limpar URL local após um tempo
      setTimeout(() => {
        URL.revokeObjectURL(localMediaUrl);
      }, 5000);
      
    } catch (error) {
      console.error("[SDRZap] Erro ao enviar mídia:", error);
      // Marcar mensagem como erro para permitir retry
      setMensagens(prev => prev.map(m => 
        m.id === optimisticMsgId ? { ...m, _sending: false, _error: true, _progress: 0, status: "FAILED" } : m
      ));
    }
  };

  // Função para reenviar mídia que falhou
  const handleRetryMedia = (msg: Mensagem) => {
    if (msg._retryData?.file && msg._retryData?.mediaType) {
      handleSendMedia(msg._retryData.file, msg._retryData.mediaType, msg._retryData.caption, msg.id);
    }
  };

  // Drag and Drop handlers para Coluna 3 - redireciona para ChatInput
  const isDraggingFileCol3 = dragCounterCol3 > 0;

  const handleDragEnterCol3 = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounterCol3(prev => prev + 1);
  };

  const handleDragOverCol3 = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeaveCol3 = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounterCol3(prev => prev - 1);
  };

  const handleDropCol3 = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounterCol3(0);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    // Passa os arquivos para o ChatInput via externalFiles
    setExternalFilesCol3(files);
  };

  const handleExternalFilesProcessed = () => {
    setExternalFilesCol3([]);
  };

  const handleSendMessage = async (text: string, replyContext?: ReplyContext, tempMsgId?: string) => {
    if (!conversaSelecionada) {
      toast.error("Selecione uma conversa");
      return;
    }

    if (!instanciaSelecionada) {
      setErroInstancia(true);
      toast.error("Selecione uma instância para enviar");
      return;
    }

    const instancia = instanciasEnvio.find((i) => i.id === instanciaSelecionada);
    const timestamp = Math.floor(Date.now() / 1000);
    const optimisticMsgId = tempMsgId || `temp-${Date.now()}-${Math.random()}`;

    // ENVIO OTIMISTA: Adicionar mensagem imediatamente com status PENDING
    if (!tempMsgId) {
      setMensagens(prev => [...prev, {
        id: optimisticMsgId,
        text: text,
        from_me: true,
        wa_timestamp: timestamp,
        created_at: new Date().toISOString(),
        status: "PENDING",
        message_type: "conversation",
        instancia_whatsapp_id: instancia?.id,
        wa_message_id: optimisticMsgId,
        message_context_info: replyContext ? { quotedMessageId: replyContext.waMessageId } : undefined,
        _sending: true,
        _retryData: { text, replyContext }
      }]);
    } else {
      // Retry: Atualizar mensagem para estado de envio
      setMensagens(prev => prev.map(m => 
        m.id === tempMsgId ? { ...m, _sending: true, _error: false, status: "PENDING" } : m
      ));
    }

    try {
      // Buscar ou criar conversa
      let conversa_id = conversaSelecionada.id;
      const { data: conversaDb } = await supabase
        .from("conversas")
        .select("id")
        .eq("numero_contato", conversaSelecionada.contact.phone)
        .maybeSingle();

      if (!conversaDb) {
        const { data: novaConversa } = await supabase
          .from("conversas")
          .insert({
            numero_contato: conversaSelecionada.contact.phone,
            nome_contato: conversaSelecionada.contact.name,
            contact_id: conversaSelecionada.contact.id,
            orig_instance_id: instanciaSelecionada,
            current_instance_id: instanciaSelecionada,
            instancia_id: instanciaSelecionada,
            status: "ativo",
          })
          .select("id")
          .single();
        if (novaConversa) conversa_id = novaConversa.id;
      } else {
        conversa_id = conversaDb.id;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Usuário não autenticado");
        setMensagens(prev => prev.map(m => 
          m.id === optimisticMsgId ? { ...m, _sending: false, _error: true, status: "FAILED" } : m
        ));
        return;
      }

      // Se tiver replyContext, usar a edge function de reply
      if (replyContext) {
        const { data, error } = await supabase.functions.invoke("message-actions-evolution", {
          body: {
            action: 'reply',
            instancia_whatsapp_id: instanciaSelecionada,
            remote_jid: replyContext.remoteJid,
            message_id: replyContext.waMessageId,
            from_me: replyContext.fromMe,
            reply_text: text,
            conversa_id: conversa_id,
            user_id: user.id,
          },
        });

        if (error) throw error;

        if (data && !data.success) {
          // Marcar mensagem como erro
          setMensagens(prev => prev.map(m => 
            m.id === optimisticMsgId ? { ...m, _sending: false, _error: true, status: "FAILED" } : m
          ));
          return;
        }

        // Sucesso: Apenas atualizar estado local
        // NÃO salvar no banco aqui - o webhook do Evolution já faz isso
        // para evitar duplicatas
        if (instancia) {
          // Atualizar mensagem local para sucesso
          // O realtime listener vai substituir pela mensagem real quando chegar do webhook
          setMensagens(prev => prev.map(m => 
            m.id === optimisticMsgId ? { ...m, _sending: false, _error: false, status: "SENT", _retryData: undefined } : m
          ));
        }

        setReplyingTo(null);
        return;
      }

      const { data, error } = await supabase.functions.invoke("enviar-mensagem-evolution", {
        body: {
          conversa_id: conversa_id,
          texto: text,
          instancia_whatsapp_id: instanciaSelecionada,
          user_id: user.id,
        },
      });

      if (error) throw error;

      if (data && !data.success) {
        // Marcar mensagem como erro
        setMensagens(prev => prev.map(m => 
          m.id === optimisticMsgId ? { ...m, _sending: false, _error: true, status: "FAILED" } : m
        ));
        return;
      }

      // Sucesso: Apenas atualizar estado local
      // NÃO salvar no banco aqui - o webhook do Evolution já faz isso
      // para evitar duplicatas
      if (instancia) {
        // Atualizar mensagem local para sucesso
        // O realtime listener vai substituir pela mensagem real quando chegar do webhook
        setMensagens(prev => prev.map(m => 
          m.id === optimisticMsgId ? { ...m, _sending: false, _error: false, status: "SENT", _retryData: undefined } : m
        ));
      }
    } catch (error) {
      console.error("[SDRZap] Erro ao enviar mensagem:", error);
      // Marcar mensagem como erro para permitir retry
      setMensagens(prev => prev.map(m => 
        m.id === optimisticMsgId ? { ...m, _sending: false, _error: true, status: "FAILED" } : m
      ));
    }
  };

  // Função para reenviar mensagem que falhou (texto ou mídia)
  const handleRetryMessage = (msg: Mensagem) => {
    if (msg._retryData) {
      // Se for mídia
      if (msg._retryData.file && msg._retryData.mediaType) {
        handleRetryMedia(msg);
      } else if (msg._retryData.text) {
        // Se for texto
        handleSendMessage(msg._retryData.text, msg._retryData.replyContext, msg.id);
      }
    }
  };

  const fetchInstanciasEnvio = async () => {
    try {
      // Buscar dados em tempo real da Evolution API
      const { data: evolutionData } = await supabase.functions.invoke("listar-instancias-evolution");
      
      // Buscar configurações locais
      const { data: localData, error } = await supabase
        .from("instancias_whatsapp")
        .select("*")
        .neq("status", "deletada")
        .order("nome_instancia", { ascending: true });

      if (error) throw error;

      // Mesclar dados da Evolution com configurações locais
      const instanciasEvolution = evolutionData?.instances || [];
      const instanciasMescladas = (localData || []).map(local => {
        const evol = instanciasEvolution.find((e: any) => 
          (e.name || e.instance?.instanceName || e.instanceName) === local.instancia_id ||
          (e.name || e.instance?.instanceName || e.instanceName) === local.nome_instancia
        );
        
        return {
          ...local,
          ativo: evol ? evol.connectionStatus === 'open' : false, // Status real da Evolution API
          statusReal: evol?.connectionStatus || 'unknown'
        };
      });

      // Ordenar: conectadas primeiro
      instanciasMescladas.sort((a, b) => {
        if (a.ativo && !b.ativo) return -1;
        if (!a.ativo && b.ativo) return 1;
        return a.nome_instancia.localeCompare(b.nome_instancia);
      });

      console.log('[SDRZap] Instâncias de envio sincronizadas:', instanciasMescladas.map(i => ({
        id: i.id,
        instancia_id: i.instancia_id,
        nome: i.nome_instancia,
        ativo: i.ativo,
        statusReal: i.statusReal
      })));

      setInstanciasEnvio(instanciasMescladas as InstanciaWhatsApp[]);
    } catch (error) {
      console.error("[SDRZap] Erro ao buscar instâncias para envio:", error);
    }
  };

  const atualizarInstanciaConversa = async (novaInstanciaId: string) => {
    if (!conversaSelecionada) return;

    try {
      // Buscar a conversa no banco
      const { data: conversaExistente } = await supabase
        .from('conversas')
        .select('id')
        .eq('numero_contato', conversaSelecionada.contact.phone)
        .maybeSingle();

      if (conversaExistente) {
        // Atualizar current_instance_id
        const { error } = await supabase
          .from('conversas')
          .update({ current_instance_id: novaInstanciaId })
          .eq('id', conversaExistente.id);

        if (error) {
          console.error('Erro ao atualizar instância da conversa:', error);
          toast.error("Não foi possível atualizar a instância");
          return;
        }
      }

      setInstanciaSelecionada(novaInstanciaId);
      toast.success("Instância de resposta atualizada");
    } catch (error) {
      console.error('Erro ao atualizar instância:', error);
      toast.error("Erro ao atualizar instância");
    }
  };

  const toggleInstanciaCol1 = (instanciaId: string) => {
    setInstanciasSelecionadasCol1(prev => 
      prev.includes(instanciaId) 
        ? prev.filter(id => id !== instanciaId)
        : [...prev, instanciaId]
    );
  };

  // Função auxiliar para obter nome da instância
  const getInstanciaNome = (instanciaId: string | null): string => {
    if (!instanciaId) return 'Sem instância';
    if (instanciaId === 'DELETED_INSTANCES') return '🗑️ Instâncias Deletadas';
    const instancia = instancias.find(i => i.id === instanciaId);
    return instancia ? instancia.nome_instancia : 'Deletada';
  };

  // Função auxiliar para obter cor da instância
  const getInstanciaCor = (instanciaId: string | null): string => {
    if (!instanciaId) return '#6366f1';
    const instancia = instancias.find(i => i.id === instanciaId);
    return instancia?.cor_identificacao || '#6366f1';
  };

  // Handler para drag & drop
  const handleDragStart = (event: DragEndEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const conversaId = event.active.id as string;
    const overId = event.over?.id as string;

    setActiveId(null);

    // Verificar se foi solto sobre um app do círculo de ações
    if (overId && overId.startsWith('action-app-')) {
      const appId = overId.replace('action-app-', '');
      console.log('[SDRZap] Card solto em app:', { conversaId, appId });
      handleActionCircleDrop(appId, conversaId);
      return;
    }

    // Ignorar drop na zona do círculo (apenas para expandir)
    if (overId === 'action-circle-zone') {
      console.log('[SDRZap] Drop na zona do círculo - ignorando');
      return;
    }

    // Verificar se foi solto sobre uma instância
    if (!overId || !overId.startsWith('instance-')) {
      console.log('[SDRZap] Drag cancelado - não foi solto em uma instância');
      return;
    }

    // Extrair o ID da instância
    const novaInstanciaId = overId.replace('instance-', '');
    console.log('[SDRZap] Transferindo conversa:', { conversaId, novaInstanciaId });

    // Buscar a conversa completa
    const conversa = [...conversasCol1, ...conversasCol2].find(c => c.id === conversaId);
    if (!conversa) {
      console.error('[SDRZap] Conversa não encontrada:', conversaId);
      toast.error('Erro ao encontrar conversa');
      return;
    }

    // Buscar usuário responsável pela nova instância (se houver)
    const { data: profilesData } = await supabase
      .from('profiles')
      .select('id')
      .eq('instancia_padrao_id', novaInstanciaId)
      .limit(1);

    const novoResponsavelId = profilesData && profilesData.length > 0 
      ? profilesData[0].id 
      : null;

    // Transferir a conversa
    const sucesso = await transferirConversa(
      conversaId,
      novaInstanciaId,
      novoResponsavelId
    );

    if (sucesso) {
      console.log('[SDRZap] Conversa transferida com sucesso');
      // Recarregar conversas para refletir as mudanças
      await invalidateConversas();
      
      // Se a conversa transferida era a selecionada, manter seleção
      if (conversaSelecionada?.id === conversaId) {
        // Buscar a conversa atualizada
        const conversasAtualizadas = [...conversasCol1, ...conversasCol2];
        const conversaAtualizada = conversasAtualizadas.find(c => c.id === conversaId);
        if (conversaAtualizada) {
          setConversaSelecionada(conversaAtualizada);
        }
      }
    }
  };

  // Handler para drop no círculo de ações
  const handleActionCircleDrop = async (appId: string, cardId: string) => {
    // Buscar a conversa que foi solta
    const conversa = [...conversasCol1, ...conversasCol2].find(c => c.id === cardId);
    
    console.log('[SDRZap] Ação do círculo:', { 
      appId, 
      cardId, 
      conversa: conversa?.contact?.name || conversa?.numero_contato 
    });

    // Verificar se o app está habilitado nas configurações
    if (!isAppEnabled(appId)) {
      console.log('[SDRZap] App desabilitado:', appId);
      toast.warning(`O app "${appId}" está desabilitado. Ative-o nas configurações.`);
      return;
    }

    // Verificar se há webhook configurado
    if (!mainWebhookUrl) {
      console.warn('[SDRZap] Webhook URL não configurada');
      toast.error('Webhook URL não configurada. Configure nas Configurações → Config Apps.');
      return;
    }

    // Tratamento especial para o app Calendar
    if (appId === 'calendar' && conversa) {
      setCalendarConversaId(cardId);
      setCalendarModalOpen(true);
      
      // Buscar últimas 10 mensagens da conversa para o payload
      const { data: lastMessages } = await supabase
        .from('messages')
        .select('text, from_me, created_at')
        .eq('contact_id', conversa.contact.id)
        .order('created_at', { ascending: false })
        .limit(10);

      // Formatar mensagens com content, role/sender e timestamp no horário local do Brasil
      const messagesPayload = (lastMessages || []).map(m => {
        // Converter UTC para horário local do Brasil (formato legível)
        const date = new Date(m.created_at);
        const formattedTimestamp = format(date, "yyyy-MM-dd'T'HH:mm:ss", { locale: ptBR });
        
        return {
          text: m.text || '',
          from_me: m.from_me,
          timestamp: formattedTimestamp,
        };
      }).reverse(); // Inverter para ordem cronológica

      // Montar payload de verificação
      const verifyPayload: CalendarVerifyPayload = {
        tipo: "calendar",
        subtipo: "verify",
        messages: messagesPayload,
        contato: conversa.contact.name || conversa.contact.phone || conversa.numero_contato,
        origem: "whatsapp",
        timezone: "America/Sao_Paulo",
        id_conversa: cardId,
      };

      console.log('[SDRZap] Enviando verify payload:', verifyPayload);

      // Chamar verificação do calendário (usa webhook configurado via edge function)
      await calendarAction.verifyCalendar(verifyPayload);
      return;
    }

    // Para outros apps, apenas mostrar toast
    toast.info(`Ação "${appId}" executada para conversa: ${conversa?.contact?.name || conversa?.numero_contato || cardId}`);
  };

  // Handler para confirmar agendamento
  const handleCalendarConfirm = async (evento: { inicio: string; fim: string; titulo: string; descricao: string }) => {
    if (!calendarConversaId) return;

    const conversa = [...conversasCol1, ...conversasCol2].find(c => c.id === calendarConversaId);
    if (!conversa) return;

    const confirmPayload: CalendarConfirmPayload = {
      tipo: "calendar",
      subtipo: "confirmed",
      action: calendarAction.state.action || "create",
      ...(calendarAction.state.eventId && { event_id: calendarAction.state.eventId }),
      ...(calendarAction.state.idAgenda && { id_agenda: calendarAction.state.idAgenda }),
      inicio: evento.inicio,
      fim: evento.fim,
    };

    const success = await calendarAction.confirmCalendar(confirmPayload);
    
    if (success) {
      // Aguardar um pouco para mostrar o sucesso antes de fechar
      setTimeout(() => {
        setCalendarModalOpen(false);
        setCalendarConversaId(null);
        calendarAction.resetState();
      }, 1500);
    }
  };

  // Handler para fechar modal do calendário
  const handleCalendarModalClose = () => {
    setCalendarModalOpen(false);
    setCalendarConversaId(null);
    calendarAction.resetState();
  };

  // Função auxiliar para filtrar conversas por busca
  const filtrarPorBusca = (conversas: Conversa[], busca: string) => {
    if (!busca.trim()) return conversas;
    const termoBusca = busca.toLowerCase().trim();
    const termoBuscaDigits = busca.replace(/\D/g, ''); // Extrai apenas dígitos para busca por número
    return conversas.filter(c => {
      const nome = (c.contact?.name || c.nome_contato || '').toLowerCase();
      const numero = (c.contact?.phone || c.numero_contato || '').replace(/\D/g, '');
      // Busca por nome OU por número (usando apenas dígitos)
      return nome.includes(termoBusca) || (termoBuscaDigits && numero.includes(termoBuscaDigits));
    });
  };

  // === Ações do menu de contexto das conversas ===
  const handleFixarConversa = async (conversaId: string, fixada: boolean) => {
    try {
      const { error } = await supabase
        .from('conversas')
        .update({ fixada: !fixada })
        .eq('id', conversaId);
      if (error) throw error;
      toast.success(fixada ? 'Conversa desafixada' : 'Conversa fixada');
      invalidateConversas();
    } catch (error) {
      console.error('Erro ao fixar conversa:', error);
      toast.error('Erro ao fixar conversa');
    }
  };

  const handleExcluirConversa = async (conversaId: string) => {
    if (!confirm('Tem certeza que deseja excluir esta conversa?')) return;
    try {
      const { error } = await supabase
        .from('conversas')
        .delete()
        .eq('id', conversaId);
      if (error) throw error;
      toast.success('Conversa excluída');
      if (conversaSelecionada?.id === conversaId) setConversaSelecionada(null);
      invalidateConversas();
    } catch (error) {
      console.error('Erro ao excluir conversa:', error);
      toast.error('Erro ao excluir conversa. Apenas admins podem excluir.');
    }
  };

  // Follow-up handlers (state já declarado no topo)


  const handleDefinirFollowUp = async () => {
    if (!followUpConversaId || !followUpData) {
      toast.error("Selecione uma data para o follow-up");
      return;
    }
    try {
      const { error } = await (supabase.from('conversas') as any)
        .update({
          follow_up_em: new Date(followUpData).toISOString(),
          follow_up_nota: followUpNota || null,
        })
        .eq('id', followUpConversaId);
      if (error) throw error;
      toast.success("Follow-up definido");
      setFollowUpConversaId(null);
      setFollowUpData("");
      setFollowUpNota("");
      invalidateConversas();
    } catch (error) {
      console.error("Erro ao definir follow-up:", error);
      toast.error("Erro ao definir follow-up");
    }
  };

  const handleRemoverFollowUp = async (conversaId: string) => {
    try {
      const { error } = await (supabase.from('conversas') as any)
        .update({ follow_up_em: null, follow_up_nota: null })
        .eq('id', conversaId);
      if (error) throw error;
      toast.success("Follow-up removido");
      invalidateConversas();
    } catch (error) {
      toast.error("Erro ao remover follow-up");
    }
  };

  const handleEnviarBlacklist = async (conversa: Conversa) => {
    const telefone = conversa.numero_contato;
    if (!confirm(`Enviar ${conversa.contact.name || telefone} para a blacklist?`)) return;
    try {
      // Buscar lead pelo telefone
      const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('telefone', telefone)
        .maybeSingle();

      if (!lead) {
        // Criar lead primeiro
        const { data: novoLead, error: leadError } = await supabase
          .from('leads')
          .insert({ telefone, nome: conversa.contact.name })
          .select('id')
          .single();
        if (leadError) throw leadError;
        
        const { error: blError } = await supabase
          .from('lead_blacklist')
          .insert({ lead_id: novoLead.id, adicionado_por: userProfile?.id, motivo: 'Adicionado via SDR Zap' });
        if (blError) throw blError;
      } else {
        // Verificar se já está na blacklist
        const { data: existing } = await supabase
          .from('lead_blacklist')
          .select('id')
          .eq('lead_id', lead.id)
          .maybeSingle();
        
        if (existing) {
          toast.info('Contato já está na blacklist');
          return;
        }

        const { error: blError } = await supabase
          .from('lead_blacklist')
          .insert({ lead_id: lead.id, adicionado_por: userProfile?.id, motivo: 'Adicionado via SDR Zap' });
        if (blError) throw blError;
      }
      toast.success('Contato adicionado à blacklist');
    } catch (error) {
      console.error('Erro ao adicionar à blacklist:', error);
      toast.error('Erro ao adicionar à blacklist');
    }
  };

  // Deriva lista de Col1 a partir do cache + filtro multi-select de instâncias.
  // Ordenação/busca/quick-filter agora são internos ao ConversationList.
  const conversasCol1 = useMemo<Conversa[]>(() => {
    if (instanciasSelecionadasCol1.length === 0) return [];
    const todas: Conversa[] = [];
    instanciasSelecionadasCol1.forEach(instanciaId => {
      const arr = conversasPorInstancia[instanciaId];
      if (arr) todas.push(...arr);
    });
    return Array.from(new Map(todas.map(c => [c.id, c])).values());
  }, [conversasPorInstancia, instanciasSelecionadasCol1]);

  // Deriva Col2: conversas da instância padrão do user OU atribuídas a ele.
  const conversasCol2 = useMemo<Conversa[]>(() => {
    if (!userProfile?.id) return [];
    const minhaInstanciaId = userProfile.instancia_padrao_id;
    const todas = Object.values(conversasPorInstancia).flat();
    const unicas = Array.from(new Map(todas.map(c => [c.id, c])).values());
    return unicas.filter(c =>
      c.orig_instance_id === minhaInstanciaId ||
      c.current_instance_id === minhaInstanciaId ||
      c.responsavel_atual === userProfile.id
    );
  }, [conversasPorInstancia, userProfile?.id, userProfile?.instancia_padrao_id]);

  // Resolve cor da instância para cada card (usado pelo ConversationList).
  const getCorInstancia = useCallback((c: Conversa) => {
    const inst = instancias.find(
      (i) => i.id === (c.current_instance_id || c.orig_instance_id)
    );
    return inst?.cor_identificacao || '#3B82F6';
  }, [instancias]);

  // Adapter para o dropdown "Blacklist" do card (contrato da ConversationList: onBlacklist(id)).
  const findConversaById = useCallback((id: string): Conversa | undefined => {
    for (const arr of Object.values(conversasPorInstancia)) {
      const found = arr.find(c => c.id === id);
      if (found) return found;
    }
    return undefined;
  }, [conversasPorInstancia]);

  // Função para iniciar nova conversa por número
  const handleNovaConversa = async () => {
    if (!numeroNovaConversa.trim()) {
      toast.error("Digite um número de telefone");
      return;
    }

    const numeroLimpo = numeroNovaConversa.replace(/\D/g, '');
    if (numeroLimpo.length < 10) {
      toast.error("Número inválido. Digite com DDD.");
      return;
    }

    setVerificandoNumero(true);
    try {
      // Verificar se já existe conversa com esse número
      const todasConversas = Object.values(conversasPorInstancia).flat();
      const conversaExistente = todasConversas.find(c => {
        const numConversa = (c.contact?.phone || c.numero_contato || '').replace(/\D/g, '').replace('@s.whatsapp.net', '');
        return numConversa.includes(numeroLimpo) || numeroLimpo.includes(numConversa);
      });

      if (conversaExistente) {
        // Se existe, selecionar a conversa
        handleSelecionarConversa(conversaExistente);
        setModalNovaConversa(false);
        setNumeroNovaConversa("");
        toast.success("Conversa encontrada!");
        return;
      }

      // Se não existe, criar nova conversa
      // Primeiro, buscar ou criar o contato
      const jid = `${numeroLimpo}@s.whatsapp.net`;
      
      let { data: contato, error: contatoError } = await supabase
        .from('contacts')
        .select('*')
        .eq('jid', jid)
        .maybeSingle();

      if (!contato) {
        // Criar novo contato
        const { data: novoContato, error: criarContatoError } = await supabase
          .from('contacts')
          .insert({
            jid,
            phone: numeroLimpo,
            name: null
          })
          .select()
          .single();

        if (criarContatoError) throw criarContatoError;
        contato = novoContato;
      }

      // Criar nova conversa vinculada à instância padrão do usuário
      const instanciaId = userProfile?.instancia_padrao_id || instancias[0]?.id;
      
      if (!instanciaId) {
        toast.error("Nenhuma instância disponível");
        return;
      }

      const { data: novaConversa, error: conversaError } = await supabase
        .from('conversas')
        .insert({
          contact_id: contato.id,
          numero_contato: numeroLimpo,
          nome_contato: contato.name,
          orig_instance_id: instanciaId,
          current_instance_id: instanciaId,
          instancia_id: instanciaId,
          status: 'novo',
          ultima_interacao: new Date().toISOString()
        })
        .select(`
          *,
          contact:contacts(*)
        `)
        .single();

      if (conversaError) throw conversaError;

      // Selecionar a nova conversa
      handleSelecionarConversa(novaConversa as Conversa);
      setModalNovaConversa(false);
      setNumeroNovaConversa("");
      toast.success("Nova conversa criada!");

    } catch (error) {
      console.error('Erro ao criar conversa:', error);
      toast.error("Erro ao criar conversa");
    } finally {
      setVerificandoNumero(false);
    }
  };

  // Função para sincronizar fotos dos contatos
  const handleSincronizarFotos = async () => {
    if (sincronizandoFotos) return;
    
    setSincronizandoFotos(true);
    try {
      toast.info("Sincronizando fotos de todas as instâncias conectadas...");

      const { data, error } = await supabase.functions.invoke('sincronizar-fotos-contatos', {
        body: { limit: 100 }
      });

      if (error) throw error;

      const instanciasUsadas = data?.instanciasUsadas?.join(', ') || 'nenhuma';
      toast.success(`Fotos sincronizadas: ${data?.successCount || 0} atualizadas (${instanciasUsadas})`);
      
      // Recarregar conversas para mostrar as fotos
      await invalidateConversas();
    } catch (error) {
      console.error('Erro ao sincronizar fotos:', error);
      toast.error("Erro ao sincronizar fotos dos contatos");
    } finally {
      setSincronizandoFotos(false);
    }
  };

  // Função para sincronizar nomes dos contatos via Evolution API (todas instâncias conectadas)
  const handleSincronizarNomes = async () => {
    if (sincronizandoNomes) return;
    
    setSincronizandoNomes(true);
    try {
      toast.info("Limpando nomes de instância e sincronizando...");

      const { data, error } = await supabase.functions.invoke('sincronizar-nomes-contatos', {
        body: { limit: 150 }
      });

      if (error) throw error;

      const cleanedCount = data?.cleanedCount || 0;
      const successCount = data?.successCount || 0;
      
      if (cleanedCount > 0 || successCount > 0) {
        toast.success(`Limpos: ${cleanedCount} | Atualizados: ${successCount} contatos`);
      } else {
        toast.info(`Sincronização concluída. ${data?.processed || 0} verificados, nenhuma atualização necessária.`);
      }
      
      // Recarregar conversas para mostrar os nomes atualizados
      await invalidateConversas();
    } catch (error) {
      console.error('Erro ao sincronizar nomes:', error);
      toast.error("Erro ao sincronizar nomes dos contatos");
    } finally {
      setSincronizandoNomes(false);
    }
  };

  // Flag derivada: conversa aberta foi respondida por mais de uma instância?
  // Usada para decidir se mostra o header "quem respondeu" acima de cada bolha.
  // DEVE ficar ANTES de qualquer early return para preservar a ordem dos hooks.
  const conversaTemMultiplasInstancias = useMemo(() => {
    const instanciasEnviadoras = new Set<string>();
    for (const m of mensagens) {
      if (m.from_me && (m as any).instancia_whatsapp_id) {
        instanciasEnviadoras.add((m as any).instancia_whatsapp_id);
        if (instanciasEnviadoras.size > 1) return true;
      }
    }
    return false;
  }, [mensagens]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  // Buscar conversa sendo arrastada
  const activeConversa = activeId
    ? [...conversasCol1, ...conversasCol2].find(c => c.id === activeId)
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="h-screen overflow-hidden flex flex-col">
      {/* Overlay de instâncias para drag & drop */}
      <DragDropInstanceOverlay 
        instancias={instancias.filter(i => i.status !== 'deletada')}
        isDragging={!!activeId}
        onActionDrop={handleActionCircleDrop}
      />

      <ResizablePanelGroup direction="horizontal" className="flex-1 overflow-hidden">
        {/* COLUNA 1: Todos */}
        <ResizablePanel 
          defaultSize={col1Minimizada ? 3 : 28} 
          minSize={col1Minimizada ? 3 : 15} 
          maxSize={col1Minimizada ? 3 : 40} 
          onResize={(size) => !col1Minimizada && setCol1Size(size)}
        >
          {col1Minimizada ? (
            <div className="h-full flex items-center justify-center bg-muted/30 border-r">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full bg-background border shadow-sm hover:bg-muted"
                onClick={toggleCol1}
                title="Expandir coluna"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          ) : (
          <div className="border-r bg-muted/30 overflow-hidden min-w-0 flex flex-col h-full">
            <ConversationList
              conversas={conversasCol1}
              selectedId={conversaSelecionada?.id ?? null}
              getCorInstancia={getCorInstancia}
              dropZoneId="coluna-1"
              draggable
              onSelect={handleSelecionarConversa}
              onPin={handleFixarConversa}
              onFollowUp={(id) => setFollowUpConversaId(id)}
              onBlacklist={(id) => {
                const c = findConversaById(id);
                if (c) handleEnviarBlacklist(c);
              }}
              onDelete={handleExcluirConversa}
              header={
                <div className="p-2 border-b bg-card flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden">
                      <h2 className="font-semibold text-sm truncate">{nomeColuna1}</h2>
                      {userProfile?.role === 'admin_geral' && (
                        <Dialog open={editandoColuna1} onOpenChange={setEditandoColuna1}>
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 flex-shrink-0"
                              onClick={() => setTempNomeCol1(nomeColuna1)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="sm:max-w-[425px]">
                            <DialogHeader>
                              <DialogTitle>Editar nome da coluna</DialogTitle>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                              <div className="grid gap-2">
                                <Label htmlFor="nome-col1">Nome da coluna</Label>
                                <Input
                                  id="nome-col1"
                                  value={tempNomeCol1}
                                  onChange={(e) => setTempNomeCol1(e.target.value)}
                                  placeholder="Digite o nome da coluna"
                                />
                              </div>
                            </div>
                            <div className="flex justify-end gap-2">
                              <Button variant="outline" onClick={() => setEditandoColuna1(false)}>
                                Cancelar
                              </Button>
                              <Button onClick={() => {
                                setNomeColuna1(tempNomeCol1);
                                setEditandoColuna1(false);
                              }}>
                                Salvar
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                      )}
                      <span className="text-xs text-muted-foreground flex-shrink-0">({conversasCol1.length})</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2"
                        onClick={handleSincronizarNomes}
                        disabled={sincronizandoNomes}
                        title="Sincronizar nomes dos contatos via WhatsApp"
                      >
                        {sincronizandoNomes ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2"
                        onClick={handleSincronizarFotos}
                        disabled={sincronizandoFotos}
                        title="Sincronizar fotos dos contatos"
                      >
                        {sincronizandoFotos ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="h-7">
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64 bg-card z-50">
                          <DropdownMenuLabel>Filtrar Instâncias</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <div className="p-2 space-y-2">
                            {conversasPorInstancia["DELETED_INSTANCES"] && conversasPorInstancia["DELETED_INSTANCES"].length > 0 && (
                              <>
                                <div
                                  className="p-2 cursor-pointer border-b border-border pb-3"
                                  onClick={() => toggleInstanciaCol1("DELETED_INSTANCES")}
                                >
                                  <div
                                    className={`flex items-center gap-2 px-3 py-2 rounded-md border-2 transition-all ${
                                      instanciasSelecionadasCol1.includes("DELETED_INSTANCES")
                                        ? 'bg-black text-white border-black'
                                        : 'bg-transparent border-black hover:bg-black/10'
                                    }`}
                                  >
                                    <span className="text-sm font-medium flex-1">Instâncias Deletadas</span>
                                    <Badge
                                      variant="outline"
                                      className={`text-xs ${
                                        instanciasSelecionadasCol1.includes("DELETED_INSTANCES") ? 'text-white border-white' : ''
                                      }`}
                                    >
                                      {conversasPorInstancia["DELETED_INSTANCES"].length}
                                    </Badge>
                                  </div>
                                </div>
                                <div className="text-xs text-muted-foreground px-2 py-1 font-medium">Instâncias Ativas</div>
                              </>
                            )}
                            {instancias.map((instancia) => (
                              <div
                                key={instancia.id}
                                className="p-2 cursor-pointer"
                                onClick={() => toggleInstanciaCol1(instancia.id)}
                              >
                                <div
                                  className={`flex items-center gap-2 px-3 py-2 rounded-md border-2 transition-all ${
                                    instanciasSelecionadasCol1.includes(instancia.id) ? 'text-white' : 'bg-transparent hover:opacity-80'
                                  }`}
                                  style={{
                                    borderColor: instancia.cor_identificacao || '#3B82F6',
                                    backgroundColor: instanciasSelecionadasCol1.includes(instancia.id)
                                      ? (instancia.cor_identificacao || '#3B82F6')
                                      : 'transparent'
                                  }}
                                >
                                  <span className="text-sm font-medium flex-1">{instancia.nome_instancia}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              }
            />
          </div>
          )}
        </ResizablePanel>

        {/* Handle com botão de minimizar coluna 1 */}
        <div className="relative h-full">
          <ResizableHandle withHandle className="h-full" />
          {!col1Minimizada && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-6 w-6 rounded-full bg-background border shadow-sm z-10 hover:bg-muted"
              onClick={toggleCol1}
              title="Minimizar coluna"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* COLUNA 2: Minha Instância */}
        <ResizablePanel
          defaultSize={28}
          minSize={15}
          maxSize={40}
          onResize={setCol2Size}
        >
          <div className="border-r bg-muted/30 overflow-hidden min-w-0 flex flex-col h-full">
            <ConversationList
              conversas={conversasCol2}
              selectedId={conversaSelecionada?.id ?? null}
              getCorInstancia={getCorInstancia}
              dropZoneId="coluna-2"
              draggable
              onSelect={handleSelecionarConversa}
              onPin={handleFixarConversa}
              onFollowUp={(id) => setFollowUpConversaId(id)}
              onBlacklist={(id) => {
                const c = findConversaById(id);
                if (c) handleEnviarBlacklist(c);
              }}
              onDelete={handleExcluirConversa}
              header={
                <div className="p-2 border-b bg-card flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden">
                      <h2 className="font-semibold text-sm truncate">
                        {userProfile?.instancia_padrao_id
                          ? instancias.find(i => i.id === userProfile.instancia_padrao_id)?.nome_instancia || 'Minha Instância'
                          : 'Minha Instância'
                        }
                      </h2>
                      <span className="text-xs text-muted-foreground flex-shrink-0">({conversasCol2.length})</span>
                    </div>

                    <Dialog open={modalNovaConversa} onOpenChange={setModalNovaConversa}>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" title="Nova conversa">
                          <UserPlus className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-[400px]">
                        <DialogHeader>
                          <DialogTitle>Nova conversa</DialogTitle>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                          <div className="grid gap-2">
                            <Label htmlFor="numero-nova">Número do telefone</Label>
                            <Input
                              id="numero-nova"
                              value={numeroNovaConversa}
                              onChange={(e) => setNumeroNovaConversa(e.target.value)}
                              placeholder="Ex: 5547999999999"
                              onKeyDown={(e) => e.key === 'Enter' && handleNovaConversa()}
                            />
                            <p className="text-xs text-muted-foreground">
                              Digite o número com código do país e DDD
                            </p>
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" onClick={() => setModalNovaConversa(false)}>
                            Cancelar
                          </Button>
                          <Button onClick={handleNovaConversa} disabled={verificandoNumero}>
                            {verificandoNumero ? "Verificando..." : "Iniciar conversa"}
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
              }
            />
          </div>
        </ResizablePanel>

        {/* Handle entre coluna 2 e 3 */}
        <div className="relative h-full">
          <ResizableHandle withHandle className="h-full" />
        </div>

        {/* COLUNA 3: Área de Chat */}
        <ResizablePanel defaultSize={col1Minimizada ? 54 : 44} minSize={25} maxSize={col1Minimizada ? 80 : 60}>
          <div 
            className={`relative flex flex-col h-full bg-background overflow-hidden min-w-0 transition-colors ${isDraggingFileCol3 ? 'ring-2 ring-primary ring-inset' : ''}`}
        onDragEnter={handleDragEnterCol3}
        onDragOver={handleDragOverCol3}
        onDragLeave={handleDragLeaveCol3}
        onDrop={handleDropCol3}
      >
        {/* Drag overlay para Coluna 3 */}
        {isDraggingFileCol3 && (
          <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex items-center justify-center z-50 pointer-events-none">
            <div className="text-center">
              <FileText className="h-12 w-12 mx-auto text-primary mb-2" />
              <p className="text-lg font-medium">Solte o arquivo aqui</p>
              <p className="text-sm text-muted-foreground">Imagem, vídeo, documento ou áudio</p>
            </div>
          </div>
        )}

        {/* Header do Chat - FIXO */}
        <div className="flex-shrink-0 p-2 border-b bg-card h-[76px] flex items-center">
          <div className="flex items-center justify-between gap-2 min-w-0 w-full">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {(() => {
                const foto = conversaSelecionada?.foto_contato || conversaSelecionada?.contact?.profile_picture_url;
                if (foto && foto !== 'NO_PICTURE') {
                  return (
                    <img 
                      src={foto}
                      alt=""
                      className="h-8 w-8 rounded-full flex-shrink-0 object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const placeholder = e.currentTarget.nextElementSibling as HTMLElement;
                        if (placeholder) placeholder.classList.remove('hidden');
                      }}
                    />
                  );
                }
                return null;
              })()}
              <div className={`flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 flex-shrink-0 ${
                conversaSelecionada && 
                (conversaSelecionada.foto_contato || conversaSelecionada.contact?.profile_picture_url) && 
                (conversaSelecionada.foto_contato !== 'NO_PICTURE' && conversaSelecionada.contact?.profile_picture_url !== 'NO_PICTURE') 
                  ? 'hidden' : ''
              }`}>
                <User className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                {conversaSelecionada ? (
                  <>
                    {editandoNomeContato ? (
                      <div className="flex items-center gap-1">
                        <Input
                          value={novoNomeContato}
                          onChange={(e) => setNovoNomeContato(e.target.value)}
                          placeholder="Nome do contato"
                          className="h-7 text-xs"
                          autoFocus
                        />
                        <Button size="sm" className="h-7 px-2 text-xs" onClick={handleSalvarNomeContato}>
                          OK
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            setEditandoNomeContato(false);
                            setNovoNomeContato("");
                          }}
                        >
                          X
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-0">
                        <div className="flex items-center gap-1 min-w-0">
                          <h2 className="font-semibold text-sm truncate">
                            {conversaSelecionada.contact.name || conversaSelecionada.contact.phone.replace('@s.whatsapp.net', '')}
                          </h2>
                          <Button 
                            size="icon" 
                            variant="ghost" 
                            className="h-5 w-5"
                            onClick={() => {
                              setEditandoNomeContato(true);
                              setNovoNomeContato(conversaSelecionada.contact.name || "");
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground min-w-0">
                          <Phone className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{conversaSelecionada.contact.phone.replace('@s.whatsapp.net', '')}</span>
                          <span className="mx-1">|</span>
                          <span className="truncate">{instancias.find(i => i.id === conversaSelecionada.instancia_id)?.nome_instancia || 'N/A'}</span>
                        </div>
                        {conversaSelecionada.contact?.perfil_profissional && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 border-violet-400 text-violet-700 bg-violet-50"
                            >
                              {PERFIS_PROFISSIONAIS.find(p => p.value === conversaSelecionada.contact.perfil_profissional)?.label || conversaSelecionada.contact.perfil_profissional}
                            </Badge>
                            {conversaSelecionada.contact.especialidade && (
                              <span className="text-[10px] text-muted-foreground truncate">
                                {conversaSelecionada.contact.especialidade}
                              </span>
                            )}
                            {conversaSelecionada.contact.instituicao && (
                              <span className="text-[10px] text-muted-foreground truncate">
                                · {conversaSelecionada.contact.instituicao}
                              </span>
                            )}
                            {!conversaSelecionada.contact.perfil_confirmado && (
                              <span className="text-[9px] text-amber-600" title="Sugestão da IA — ainda não confirmado">
                                (IA)
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col">
                    <h2 className="font-semibold text-sm text-muted-foreground">
                      Nenhum contato selecionado
                    </h2>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      <span>---</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Seletor de instância integrado no header */}
            {conversaSelecionada && (
              <div className="flex-shrink-0">
                <select
                  value={instanciaSelecionada || ''}
                  onChange={(e) => {
                    atualizarInstanciaConversa(e.target.value);
                    setErroInstancia(false);
                  }}
                  style={{
                    backgroundColor: instanciaSelecionada 
                      ? instanciasEnvio.find(i => i.id === instanciaSelecionada)?.cor_identificacao || '#dc2626'
                      : '#dc2626',
                    borderColor: instanciaSelecionada 
                      ? instanciasEnvio.find(i => i.id === instanciaSelecionada)?.cor_identificacao || '#dc2626'
                      : '#dc2626',
                    color: '#ffffff'
                  }}
                  className={`h-8 w-32 rounded border-2 px-2 text-xs font-medium transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-current ${
                    erroInstancia ? 'animate-blink-error' : ''
                  }`}
                >
                  <option value="" style={{ backgroundColor: '#dc2626', color: '#ffffff' }}>Obrigatório</option>
                  {instanciasEnvio.map((inst) => (
                    <option
                      key={inst.id}
                      value={inst.id}
                      style={{ 
                        backgroundColor: inst.cor_identificacao, 
                        color: '#ffffff'
                      }}
                    >
                      {inst.nome_instancia} {!inst.ativo && '(desconectada)'}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Mensagens - ÁREA COM SCROLL (fundo estilo WhatsApp) */}
        <div className="flex-1 overflow-y-auto p-4 bg-[#EFEAE2] dark:bg-[#0B141A]">
          <div className="space-y-4">
            {conversaSelecionada ? (
              <>
                {/* Botão para carregar mais histórico */}
                <div className="flex justify-center mb-4">
                  {sincronizandoHistorico ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Sincronizando histórico...</span>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        if (!conversaSelecionada || carregandoMaisHistorico) return;
                        
                        const contactId = conversaSelecionada.contact.id;
                        const instanciaId = conversaSelecionada.current_instance_id || conversaSelecionada.orig_instance_id;
                        
                        if (!instanciaId) {
                          toast.error("Instância não encontrada");
                          return;
                        }

                        const nextPage = historicoPage + 1;
                        if (historicoTotalPages && nextPage > historicoTotalPages) {
                          toast.info("Sem mais histórico para carregar");
                          return;
                        }
                        
                        setCarregandoMaisHistorico(true);
                        
                        try {
                          const { data: syncResult, error: syncError } = await supabase.functions.invoke(
                            "sincronizar-historico-mensagens",
                            {
                              body: {
                                contact_id: contactId,
                                instancia_id: instanciaId,
                                limit: 50,
                                page: nextPage,
                              }
                            }
                          );
                          
                          if (syncError) {
                            console.error('[SDRZap] Erro ao carregar mais histórico:', syncError);
                            toast.error("Erro ao carregar histórico");
                          } else {
                            setHistoricoPage(syncResult?.currentPage ?? nextPage);
                            setHistoricoTotalPages(syncResult?.pages ?? historicoTotalPages);

                            if (syncResult?.novas_inseridas > 0) {
                              toast.success(`${syncResult.novas_inseridas} novas mensagens carregadas`);
                            } else {
                              toast.info("Nenhuma mensagem nova encontrada");
                            }

                            // Recarregar mensagens do banco para refletir imediatamente
                            const { data: refreshed, error: refreshError } = await supabase
                              .from("messages")
                              .select("id, text, from_me, wa_timestamp, created_at, status, message_type, instancia_whatsapp_id, media_url, media_mime_type, wa_message_id, sender_jid, raw_payload, is_edited")
                              .eq("contact_id", contactId)
                              .eq("instancia_whatsapp_id", instanciaId)
                              .order("created_at", { ascending: true });

                            if (!refreshError) setMensagens(refreshed || []);
                          }
                        } catch (err) {
                          console.error('[SDRZap] Erro:', err);
                          toast.error("Erro ao carregar histórico");
                        } finally {
                          setCarregandoMaisHistorico(false);
                        }
                      }}
                      disabled={carregandoMaisHistorico}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      {carregandoMaisHistorico ? (
                        <>
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          Carregando...
                        </>
                      ) : (
                        <>
                          <RotateCcw className="h-3 w-3 mr-1" />
                          Carregar mais histórico
                        </>
                      )}
                    </Button>
                  )}
                </div>

                {mensagens.map((msg, index) => {
                  // Detectar se é conversa interna (entre duas instâncias ativas diferentes)
                  const numeroContato = conversaSelecionada.numero_contato;
                  const instanciaAtualId = conversaSelecionada.current_instance_id || conversaSelecionada.orig_instance_id;
                  const instanciaDestinataria = instancias.find(
                    inst => inst.numero_chip?.replace(/\D/g, '') === numeroContato && 
                            inst.id !== instanciaAtualId && // Não é a mesma instância
                            inst.ativo === true // Está ativa
                  );
                  const isConversaInterna = !!instanciaDestinataria;
                  
                  // Para conversas internas, inverter a perspectiva baseado na instância
                  const instanciaAtual = instancias.find(i => i.id === conversaSelecionada.current_instance_id);
                  const instanciaMensagem = instancias.find(i => i.id === (msg as any).instancia_whatsapp_id);
                  
                  // Se for interna, mensagem é "minha" se veio da instância atual
                  const isMinhaMsg = isConversaInterna 
                    ? (msg as any).instancia_whatsapp_id === conversaSelecionada.current_instance_id
                    : msg.from_me;
                  
                  const nomeRemetente = isConversaInterna 
                    ? instanciaMensagem?.nome_instancia || 'Instância'
                    : (conversaSelecionada?.contact?.name || conversaSelecionada?.nome_contato || conversaSelecionada?.numero_contato);
                  
                  // Identificar quem enviou baseado no sender_jid (para mensagens from_me)
                  const getNomeEnviador = () => {
                    if (!msg.from_me) return null;
                    if (!msg.sender_jid) return null;
                    const senderPhone = msg.sender_jid.replace('@s.whatsapp.net', '').replace('@lid', '');
                    // Cruzar com numero_chip das instâncias para identificar o captador
                    const instanciaSender = instancias.find(i => 
                      i.numero_chip && (
                        i.numero_chip === senderPhone ||
                        // Variação com/sem 9
                        i.numero_chip.replace(/^55(\d{2})9(\d{8})$/, '55$1$2') === senderPhone ||
                        senderPhone.replace(/^55(\d{2})9(\d{8})$/, '55$1$2') === i.numero_chip?.replace(/^55(\d{2})9(\d{8})$/, '55$1$2')
                      )
                    );
                    return instanciaSender?.nome_instancia || null;
                  };
                  const nomeEnviador = getNomeEnviador();

                  // Obter o JID do contato para as ações
                  const contactJid = conversaSelecionada?.contact?.jid || 
                    `${conversaSelecionada?.numero_contato}@s.whatsapp.net`;
                  
                  // Obter o wa_message_id da mensagem
                  const waMessageId = msg.wa_message_id || msg.raw_payload?.key?.id;

                  // ======= SEPARADOR DE DATA =======
                  const msgDate = new Date(msg.wa_timestamp ? msg.wa_timestamp * 1000 : msg.created_at);
                  const prevMsg = index > 0 ? mensagens[index - 1] : null;
                  const prevMsgDate = prevMsg ? new Date(prevMsg.wa_timestamp ? prevMsg.wa_timestamp * 1000 : prevMsg.created_at) : null;
                  
                  // Verificar se mudou o dia
                  const showDateSeparator = !prevMsgDate || 
                    msgDate.toDateString() !== prevMsgDate.toDateString();
                  
                  // Formatar data para exibição
                  const formatDateSeparator = (date: Date) => {
                    const today = new Date();
                    const yesterday = new Date(today);
                    yesterday.setDate(yesterday.getDate() - 1);
                    
                    if (date.toDateString() === today.toDateString()) {
                      return 'Hoje';
                    } else if (date.toDateString() === yesterday.toDateString()) {
                      return 'Ontem';
                    } else {
                      return format(date, "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
                    }
                  };

                  return (
                    <div key={msg.id}>
                      {/* Separador de Data */}
                      {showDateSeparator && (
                        <div className="flex items-center justify-center my-4">
                          <div className="bg-muted px-4 py-1 rounded-full">
                            <span className="text-xs font-medium text-muted-foreground">
                              {formatDateSeparator(msgDate)}
                            </span>
                          </div>
                        </div>
                      )}
                      
                      <div
                        id={`msg-${msg.id}`}
                        className={`flex ${isMinhaMsg ? 'justify-end' : 'justify-start'} group transition-all duration-300`}
                      >
                      {/* Actions button for sent messages (left side) */}
                      {isMinhaMsg && (
                        <div className="flex items-center mr-1">
                          <MessageActions
                            messageId={msg.id}
                            waMessageId={waMessageId}
                            remoteJid={contactJid}
                            fromMe={msg.from_me}
                            instanciaWhatsappId={msg.instancia_whatsapp_id || conversaSelecionada?.current_instance_id || ''}
                            conversaId={conversaSelecionada?.id || ''}
                            userId={userProfile?.id || ''}
                            messageText={msg.text}
                            messageType={msg.message_type}
                            senderName={isMinhaMsg ? 'Você' : nomeRemetente}
                            onStartReply={(reply) => setReplyingTo(reply)}
                            onMessageEdited={(newText) => {
                              // Atualizar o texto e marcar como editada localmente
                              setMensagens(prev => prev.map(m => 
                                m.wa_message_id === waMessageId ? { ...m, text: newText, is_edited: true } : m
                              ));
                            }}
                          />
                        </div>
                      )}
                      <div className={`max-w-[70%] ${isMinhaMsg ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                        {isMinhaMsg && nomeEnviador && conversaTemMultiplasInstancias && (
                          <p className="text-xs font-semibold text-right text-muted-foreground px-1">
                            {nomeEnviador}
                          </p>
                        )}
                        {isConversaInterna && (
                          <p className="text-xs font-semibold text-muted-foreground px-1">
                            {nomeRemetente}
                          </p>
                        )}
                        <div
                          className={`relative rounded-lg p-3 shadow-sm ${
                            isMinhaMsg
                              ? msg._error
                                ? 'bg-[#D9FDD3]/70 dark:bg-[#005C4B]/70 text-gray-900 dark:text-gray-50 border-2 border-destructive'
                                : msg._sending
                                  ? 'bg-[#D9FDD3]/80 dark:bg-[#005C4B]/80 text-gray-900 dark:text-gray-50'
                                  : 'bg-[#D9FDD3] dark:bg-[#005C4B] text-gray-900 dark:text-gray-50'
                              : 'bg-white dark:bg-[#202C33] text-gray-900 dark:text-gray-100'
                          } ${msg.wa_message_id && messageReactions[msg.wa_message_id]?.length > 0 ? 'mb-4' : ''}`}
                        >
                          {!isMinhaMsg && !isConversaInterna && (
                            <p className="text-xs font-semibold mb-1 text-muted-foreground">
                              {nomeRemetente}
                            </p>
                          )}
                          {/* Quoted Message (Reply Context) - WhatsApp style */}
                          {(() => {
                            const quotedMsgId = msg.message_context_info?.quotedMessageId || 
                              msg.raw_payload?.message?.extendedTextMessage?.contextInfo?.stanzaId ||
                              msg.raw_payload?.contextInfo?.stanzaId;
                            
                            if (!quotedMsgId) return null;
                            
                            const quotedMsg = mensagens.find(m => m.wa_message_id === quotedMsgId);
                            const quotedMsgType = quotedMsg?.message_type || 'text';
                            
                            // Determinar texto/conteúdo da mensagem citada
                            let quotedText = quotedMsg?.text || 
                              msg.raw_payload?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation ||
                              msg.raw_payload?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text;
                            
                            // Formatar texto com base no tipo de mídia
                            const getQuotedDisplay = () => {
                              if (quotedMsgType === 'audio') {
                                return { icon: <Mic className="w-3 h-3 inline mr-1" />, text: 'Áudio' };
                              }
                              if (quotedMsgType === 'image') {
                                return { icon: <ImageIcon className="w-3 h-3 inline mr-1" />, text: quotedText || 'Foto' };
                              }
                              if (quotedMsgType === 'video') {
                                return { icon: <Video className="w-3 h-3 inline mr-1" />, text: quotedText || 'Vídeo' };
                              }
                              if (quotedMsgType === 'document') {
                                return { icon: <FileText className="w-3 h-3 inline mr-1" />, text: quotedText || 'Documento' };
                              }
                              if (quotedMsgType === 'sticker') {
                                return { icon: null, text: '🎭 Sticker' };
                              }
                              return { icon: null, text: quotedText || 'Mensagem citada' };
                            };
                            
                            const quotedDisplay = getQuotedDisplay();
                            
                            const quotedFromMe = quotedMsg?.from_me ?? 
                              msg.raw_payload?.message?.extendedTextMessage?.contextInfo?.participant?.includes('@');
                            
                            const quotedSenderName = quotedFromMe ? 'Você' : 
                              (conversaSelecionada?.contact?.name || conversaSelecionada?.nome_contato || 'Contato');
                            
                            const scrollToQuoted = () => {
                              if (quotedMsg) {
                                const element = document.getElementById(`msg-${quotedMsg.id}`);
                                if (element) {
                                  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                  element.classList.add('ring-2', 'ring-primary', 'ring-offset-2');
                                  setTimeout(() => {
                                    element.classList.remove('ring-2', 'ring-primary', 'ring-offset-2');
                                  }, 2000);
                                }
                              }
                            };
                            
                            return (
                              <div
                                onClick={scrollToQuoted}
                                className={`mb-2 p-2 rounded cursor-pointer border-l-4 transition-colors ${
                                  isMinhaMsg
                                    ? 'bg-black/5 dark:bg-white/10 border-[#005C4B] dark:border-[#D9FDD3] hover:bg-black/10 dark:hover:bg-white/20'
                                    : 'bg-black/5 dark:bg-white/5 border-[#005C4B] dark:border-[#D9FDD3] hover:bg-black/10 dark:hover:bg-white/10'
                                }`}
                              >
                                <p className="text-xs font-semibold text-[#005C4B] dark:text-[#D9FDD3]">
                                  {quotedSenderName}
                                </p>
                                <p className={`text-xs truncate flex items-center ${
                                  isMinhaMsg ? 'text-gray-700 dark:text-gray-300' : 'text-gray-600 dark:text-gray-400'
                                }`}>
                                  {quotedDisplay.icon}
                                  {quotedDisplay.text}
                                </p>
                              </div>
                            );
                          })()}
                          {/* Render media types */}
                          {(() => {
                            // PRIORIDADE: usar media_url do banco (já processado pela edge function)
                            // Fallback: extrair do raw_payload
                            const getMediaUrl = () => {
                              // Primeiro, verificar se temos media_url no banco
                              if (msg.media_url) return msg.media_url;
                              
                              // Fallback: extrair do raw_payload
                              const message = msg.raw_payload?.message;
                              if (!message) return null;
                              
                              if (msg.message_type === 'audio') {
                                return message.audioMessage?.url || message.pttMessage?.url || null;
                              }
                              if (msg.message_type === 'image') {
                                return message.imageMessage?.url || null;
                              }
                              if (msg.message_type === 'video') {
                                return message.videoMessage?.url || null;
                              }
                              if (msg.message_type === 'document') {
                                return message.documentMessage?.url || null;
                              }
                              if (msg.message_type === 'sticker') {
                                return message.stickerMessage?.url || null;
                              }
                              return null;
                            };
                            
                            const getMediaBase64 = () => {
                              // Se temos media_url, não precisamos de base64
                              if (msg.media_url) return null;
                              
                              const message = msg.raw_payload?.message;
                              if (!message) return null;
                              
                              if (msg.message_type === 'audio') {
                                const base64 = message.audioMessage?.base64 || message.pttMessage?.base64;
                                const mimetype = message.audioMessage?.mimetype || message.pttMessage?.mimetype || 'audio/ogg';
                                return base64 ? `data:${mimetype};base64,${base64}` : null;
                              }
                              if (msg.message_type === 'image') {
                                const base64 = message.imageMessage?.base64;
                                const mimetype = message.imageMessage?.mimetype || 'image/jpeg';
                                return base64 ? `data:${mimetype};base64,${base64}` : null;
                              }
                              if (msg.message_type === 'video') {
                                const base64 = message.videoMessage?.base64;
                                const mimetype = message.videoMessage?.mimetype || 'video/mp4';
                                return base64 ? `data:${mimetype};base64,${base64}` : null;
                              }
                              if (msg.message_type === 'document') {
                                const base64 = message.documentMessage?.base64;
                                const mimetype = message.documentMessage?.mimetype || 'application/octet-stream';
                                return base64 ? `data:${mimetype};base64,${base64}` : null;
                              }
                              return null;
                            };
                            
                            const mediaUrl = getMediaUrl();
                            const mediaBase64 = getMediaBase64();
                            const mediaSrc = mediaUrl || mediaBase64;
                            // Parse raw_payload se for string
                            const parsedPayload = typeof msg.raw_payload === 'string' ? (() => { try { return JSON.parse(msg.raw_payload); } catch { return msg.raw_payload; } })() : msg.raw_payload;
                            const docFileName = parsedPayload?.data?.message?.documentMessage?.fileName || parsedPayload?.message?.documentMessage?.fileName;

                            if (msg.message_type === 'audio') {
                              return mediaSrc ? (
                                <div className="flex flex-col gap-2">
                                  <audio controls className="max-w-[250px] h-10" preload="metadata">
                                    <source src={mediaSrc} type={msg.raw_payload?.message?.audioMessage?.mimetype || 'audio/ogg'} />
                                    Seu navegador não suporta áudio.
                                  </audio>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                                    isMinhaMsg ? 'bg-primary-foreground/20' : 'bg-muted-foreground/20'
                                  }`}>
                                    <Mic className="h-4 w-4" />
                                  </div>
                                  <div className="flex-1">
                                    <div className={`h-1 rounded-full w-24 ${
                                      isMinhaMsg ? 'bg-primary-foreground/40' : 'bg-muted-foreground/40'
                                    }`} />
                                    <p className="text-xs mt-1 opacity-70">Áudio</p>
                                  </div>
                                </div>
                              );
                            }
                            
                            if (msg.message_type === 'image') {
                              const caption = msg.raw_payload?.message?.imageMessage?.caption || msg.text;
                              // Encontrar índice da imagem atual entre todas as imagens
                              const allImages = mensagens
                                .filter(m => m.message_type === 'image')
                                .map(m => {
                                  const message = m.raw_payload?.message;
                                  const url = message?.imageMessage?.url;
                                  const base64 = message?.imageMessage?.base64;
                                  const mimetype = message?.imageMessage?.mimetype || 'image/jpeg';
                                  return base64 ? `data:${mimetype};base64,${base64}` : url;
                                })
                                .filter(Boolean);
                              const currentImageIndex = allImages.findIndex(src => src === mediaSrc);
                              
                              return (
                                <div className="space-y-2">
                                  {mediaSrc ? (
                                    <div 
                                      className="relative group cursor-pointer"
                                      onClick={() => {
                                        if (!msg._sending) {
                                          setImagePreview({ src: mediaSrc, index: currentImageIndex >= 0 ? currentImageIndex : 0 });
                                          setImageZoom(1);
                                        }
                                      }}
                                    >
                                      <img 
                                        src={mediaSrc} 
                                        alt="Imagem" 
                                        className={`rounded-lg max-w-[250px] max-h-[300px] object-contain transition-opacity ${msg._sending ? 'opacity-70' : 'hover:opacity-90'}`}
                                        loading="lazy"
                                      />
                                      {/* Progress overlay for uploading */}
                                      {msg._sending && typeof msg._progress === 'number' && (
                                        <div className="absolute inset-0 bg-black/50 rounded-lg flex flex-col items-center justify-center">
                                          <Loader2 className="h-8 w-8 animate-spin text-white mb-2" />
                                          <div className="w-3/4 bg-white/30 rounded-full h-2 overflow-hidden">
                                            <div 
                                              className="h-full bg-white rounded-full transition-all duration-300"
                                              style={{ width: `${msg._progress}%` }}
                                            />
                                          </div>
                                          <span className="text-white text-xs mt-1">{msg._progress}%</span>
                                        </div>
                                      )}
                                      {!msg._sending && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
                                          <ZoomIn className="h-8 w-8 text-white" />
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className={`flex items-center gap-2 p-2 rounded ${
                                      isMinhaMsg ? 'bg-primary-foreground/10' : 'bg-background/50'
                                    }`}>
                                      <ImageIcon className="h-5 w-5" />
                                      <span className="text-sm">Imagem não disponível</span>
                                    </div>
                                  )}
                                  {caption && !caption.startsWith('📷') && (
                                    <p className="text-sm whitespace-pre-wrap break-words">{caption}</p>
                                  )}
                                </div>
                              );
                            }
                            
                            if (msg.message_type === 'video') {
                              const caption = msg.raw_payload?.message?.videoMessage?.caption || msg.text;
                              return (
                                <div className="space-y-2 relative">
                                  {mediaSrc ? (
                                    <div className="relative">
                                      <video 
                                        controls={!msg._sending}
                                        className={`rounded-lg max-w-[250px] max-h-[300px] ${msg._sending ? 'opacity-70' : ''}`}
                                        preload="metadata"
                                      >
                                        <source src={mediaSrc} type={msg.raw_payload?.message?.videoMessage?.mimetype || 'video/mp4'} />
                                        Seu navegador não suporta vídeo.
                                      </video>
                                      {/* Progress overlay for uploading */}
                                      {msg._sending && typeof msg._progress === 'number' && (
                                        <div className="absolute inset-0 bg-black/50 rounded-lg flex flex-col items-center justify-center">
                                          <Loader2 className="h-8 w-8 animate-spin text-white mb-2" />
                                          <div className="w-3/4 bg-white/30 rounded-full h-2 overflow-hidden">
                                            <div 
                                              className="h-full bg-white rounded-full transition-all duration-300"
                                              style={{ width: `${msg._progress}%` }}
                                            />
                                          </div>
                                          <span className="text-white text-xs mt-1">{msg._progress}%</span>
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className={`flex items-center gap-2 p-2 rounded ${
                                      isMinhaMsg ? 'bg-primary-foreground/10' : 'bg-background/50'
                                    }`}>
                                      <Video className="h-5 w-5" />
                                      <span className="text-sm">Vídeo não disponível</span>
                                    </div>
                                  )}
                                  {caption && !caption.startsWith('🎬') && (
                                    <p className="text-sm whitespace-pre-wrap break-words">{caption}</p>
                                  )}
                                </div>
                              );
                            }
                            
                            if (msg.message_type === 'document') {
                              // Função para obter extensão do MIME type
                              const getExtensionFromMime = (mimeType: string | null | undefined): string => {
                                if (!mimeType) return '';
                                const baseMime = mimeType.split(';')[0].trim();
                                const mimeToExt: Record<string, string> = {
                                  'application/pdf': '.pdf',
                                  'application/msword': '.doc',
                                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
                                  'application/vnd.ms-excel': '.xls',
                                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
                                  'application/vnd.ms-powerpoint': '.ppt',
                                  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
                                  'text/plain': '.txt',
                                  'text/csv': '.csv',
                                  'application/zip': '.zip',
                                  'application/x-rar-compressed': '.rar',
                                  'image/jpeg': '.jpg',
                                  'image/png': '.png',
                                  'image/gif': '.gif',
                                  'image/webp': '.webp',
                                };
                                return mimeToExt[baseMime] || '';
                              };
                              
                              // Obter nome do arquivo e garantir extensão correta
                              let rawFileName = docFileName || msg.text?.replace('📎 ', '').trim() || 'Documento';
                              const mimeType = msg.media_mime_type || parsedPayload?.data?.message?.documentMessage?.mimetype || parsedPayload?.message?.documentMessage?.mimetype;
                              const expectedExt = getExtensionFromMime(mimeType);
                              
                              // Se o arquivo não tem extensão ou tem extensão incorreta, adicionar a correta
                              const hasValidExt = rawFileName.includes('.') && rawFileName.split('.').pop()!.length <= 5;
                              const displayFileName = hasValidExt ? rawFileName : `${rawFileName}${expectedExt || '.bin'}`;
                              
                              const handleDownload = async () => {
                                if (!mediaSrc) return;
                                const toastId = toast.loading(`Baixando ${displayFileName}...`);
                                try {
                                  const response = await fetch(mediaSrc);
                                  if (!response.ok) throw new Error('Falha no download');
                                  
                                  // Usar Content-Type do response como fallback
                                  const contentType = response.headers.get('content-type');
                                  let finalFileName = displayFileName;
                                  
                                  // Se ainda não tem extensão válida, tentar do content-type
                                  if (!hasValidExt && contentType) {
                                    const extFromResponse = getExtensionFromMime(contentType);
                                    if (extFromResponse && !finalFileName.endsWith(extFromResponse)) {
                                      finalFileName = rawFileName + extFromResponse;
                                    }
                                  }
                                  
                                  const contentLength = response.headers.get('content-length');
                                  const total = contentLength ? parseInt(contentLength, 10) : 0;
                                  
                                  if (total > 0 && response.body) {
                                    const reader = response.body.getReader();
                                    const chunks: BlobPart[] = [];
                                    let received = 0;
                                    
                                    while (true) {
                                      const { done, value } = await reader.read();
                                      if (done) break;
                                      chunks.push(value);
                                      received += value.length;
                                      const percent = Math.round((received / total) * 100);
                                      toast.loading(`Baixando ${finalFileName}... ${percent}%`, { id: toastId });
                                    }
                                    
                                    const blob = new Blob(chunks, { type: contentType || mimeType || 'application/octet-stream' });
                                    const url = window.URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = finalFileName;
                                    document.body.appendChild(a);
                                    a.click();
                                    document.body.removeChild(a);
                                    window.URL.revokeObjectURL(url);
                                  } else {
                                    const blob = await response.blob();
                                    const url = window.URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = finalFileName;
                                    document.body.appendChild(a);
                                    a.click();
                                    document.body.removeChild(a);
                                    window.URL.revokeObjectURL(url);
                                  }
                                  
                                  toast.success(`${finalFileName} baixado!`, { id: toastId });
                                } catch (error) {
                                  console.error('Erro ao baixar arquivo:', error);
                                  toast.error('Erro ao baixar arquivo', { id: toastId });
                                }
                              };
                              
                              return (
                                <div className={`relative flex items-center gap-2 p-2 rounded ${
                                  isMinhaMsg ? 'bg-primary-foreground/10' : 'bg-background/50'
                                }`}>
                                  {msg._sending && typeof msg._progress === 'number' ? (
                                    <>
                                      <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin" />
                                      <div className="flex-1">
                                        <span className="text-sm" title={displayFileName}>
                                          {displayFileName.length > 20 
                                            ? `${displayFileName.substring(0, 15)}...${displayFileName.includes('.') ? displayFileName.split('.').pop() : ''}`
                                            : displayFileName
                                          }
                                        </span>
                                        <div className="w-full bg-white/30 rounded-full h-1.5 mt-1 overflow-hidden">
                                          <div 
                                            className="h-full bg-primary rounded-full transition-all duration-300"
                                            style={{ width: `${msg._progress}%` }}
                                          />
                                        </div>
                                        <span className="text-[10px] opacity-70">{msg._progress}%</span>
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <FileText className="h-5 w-5 flex-shrink-0" />
                                      <span className="text-sm flex-1" title={displayFileName}>
                                        {displayFileName.length > 25 
                                          ? `${displayFileName.substring(0, 18)}...${displayFileName.includes('.') ? displayFileName.split('.').pop() : ''}`
                                          : displayFileName
                                        }
                                      </span>
                                      {mediaSrc && (
                                        <button 
                                          onClick={handleDownload}
                                          className={`p-1 rounded hover:bg-background/20 ${isMinhaMsg ? 'text-primary-foreground' : 'text-foreground'}`}
                                          title="Baixar documento"
                                        >
                                          <Download className="h-4 w-4" />
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                              );
                            }
                            
                            if (msg.message_type === 'sticker') {
                              return mediaSrc ? (
                                <img 
                                  src={mediaSrc} 
                                  alt="Figurinha" 
                                  className="max-w-[150px] max-h-[150px]"
                                  loading="lazy"
                                />
                              ) : (
                                <span className="text-2xl">🏷️</span>
                              );
                            }

                            // Location message
                            if (msg.message_type === 'location' || msg.message_type === 'locationMessage') {
                              try {
                                const payload = typeof msg.raw_payload === 'string' 
                                  ? JSON.parse(msg.raw_payload) 
                                  : msg.raw_payload;
                                const locationData = payload?.data?.message?.locationMessage;
                                const lat = locationData?.degreesLatitude;
                                const lng = locationData?.degreesLongitude;
                                
                                if (lat && lng) {
                                  const coordsText = `${lat}, ${lng}`;
                                  
                                  const handleCopyCoords = () => {
                                    navigator.clipboard.writeText(coordsText).then(() => {
                                      toast.success('Coordenadas copiadas!');
                                    }).catch(() => {
                                      toast.error('Erro ao copiar');
                                    });
                                  };
                                  
                                  return (
                                    <div className="flex flex-col gap-2">
                                      <div className="flex items-center gap-2">
                                        <MapPin className="h-5 w-5 text-primary flex-shrink-0" />
                                        <div>
                                          <p className="text-xs text-muted-foreground">Localização compartilhada</p>
                                          <p className="text-sm font-medium">
                                            {lat.toFixed(6)}, {lng.toFixed(6)}
                                          </p>
                                        </div>
                                      </div>
                                      <button
                                        onClick={handleCopyCoords}
                                        className="flex items-center gap-2 px-3 py-2 bg-primary/10 hover:bg-primary/20 rounded-lg transition-colors text-sm w-fit"
                                      >
                                        <Copy className="h-4 w-4" />
                                        Copiar coordenadas
                                      </button>
                                    </div>
                                  );
                                }
                              } catch (e) {
                                console.warn('Erro ao parsear localização:', e);
                              }
                              return (
                                <div className="flex items-center gap-2">
                                  <MapPin className="h-5 w-5 text-primary" />
                                  <span>{msg.text || 'Localização'}</span>
                                </div>
                              );
                            }

                             // Contact message (shared contact) - ONLY for actual contact message types
                             if (
                               msg.message_type === 'contact' ||
                               msg.message_type === 'contactMessage' ||
                               msg.message_type === 'contactsArrayMessage'
                             ) {
                               const raw = (msg.text || '').trim();
                               const contactDisplay = raw
                                 .replace(/^📇\s*Contato:\s*/i, '')
                                 .replace(/^=+/, '')
                                 .trim() || 'Contato';

                               // Extract data from raw_payload vCard
                               const extractVCardData = (): { phone: string | null; photo: string | null } => {
                                 try {
                                   const payload = typeof msg.raw_payload === 'string' 
                                     ? JSON.parse(msg.raw_payload) 
                                     : msg.raw_payload;
                                   const vcard = payload?.data?.message?.contactMessage?.vcard || '';
                                   
                                   // Extract phone
                                   const telMatch = vcard.match(/TEL[^:]*:([+\d\s-]+)/i);
                                   const phone = telMatch ? telMatch[1].replace(/\D/g, '') : null;
                                   
                                   // Extract photo (base64)
                                   const photoMatch = vcard.match(/PHOTO;[^:]*:([A-Za-z0-9+/=]+)/i);
                                   const photo = photoMatch ? `data:image/jpeg;base64,${photoMatch[1]}` : null;
                                   
                                   return { phone, photo };
                                 } catch (e) {
                                   console.warn('Erro ao extrair dados do vCard:', e);
                                   return { phone: null, photo: null };
                                 }
                               };
                               
                               const vCardData = extractVCardData();
                               const extractPhoneFromVCard = (): string | null => vCardData.phone;

                               const handleSaveContact = async () => {
                                 const phone = extractPhoneFromVCard();
                                 if (!phone) {
                                   toast.error('Não foi possível extrair o telefone do contato');
                                   return;
                                 }

                                 try {
                                   // Check if contact already exists
                                   const { data: existing } = await supabase
                                     .from('contacts')
                                     .select('id')
                                     .eq('phone', phone)
                                     .maybeSingle();

                                   if (existing) {
                                     toast.info('Este contato já existe na sua lista');
                                     // Sincronizar foto e nome mesmo assim
                                     supabase.functions.invoke('sincronizar-contato-individual', {
                                       body: { contact_id: existing.id }
                                     }).catch(console.error);
                                     return;
                                   }

                                   // Create new contact
                                   const jid = `${phone}@s.whatsapp.net`;
                                   const { data: newContact, error } = await supabase
                                     .from('contacts')
                                     .insert({
                                       phone,
                                       jid,
                                       name: contactDisplay !== 'Contato' ? contactDisplay : null,
                                       tipo_contato: 'WhatsApp',
                                     })
                                     .select('id')
                                     .single();

                                   if (error) throw error;
                                   toast.success(`Contato "${contactDisplay}" salvo com sucesso!`);
                                   
                                   // Sincronizar foto e nome em background
                                   if (newContact) {
                                     supabase.functions.invoke('sincronizar-contato-individual', {
                                       body: { contact_id: newContact.id }
                                     }).catch(console.error);
                                   }
                                 } catch (e: any) {
                                   console.error('Erro ao salvar contato:', e);
                                   toast.error('Erro ao salvar contato');
                                 }
                               };

                               // Iniciar conversa com o contato compartilhado
                               const handleStartConversation = async () => {
                                 const phone = extractPhoneFromVCard();
                                 if (!phone) {
                                   toast.error('Não foi possível extrair o telefone do contato');
                                   return;
                                 }

                                 // Verificar se já existe conversa com este número
                                 const { data: existingConversas } = await supabase
                                   .from('conversas')
                                   .select('id, contact_id, current_instance_id')
                                   .eq('numero_contato', phone)
                                   .limit(1);

                                 if (existingConversas && existingConversas.length > 0) {
                                   // Buscar dados completos da conversa para selecionar
                                   const { data: conversaCompleta } = await supabase
                                     .from('conversas')
                                     .select(`
                                       *,
                                       contact:contact_id(*)
                                     `)
                                     .eq('id', existingConversas[0].id)
                                     .single();

                                   if (conversaCompleta) {
                                     toast.info('Conversa existente encontrada');
                                     setConversaSelecionada(conversaCompleta as any);
                                     return;
                                   }
                                 }

                                 // Criar nova conversa
                                 try {
                                   // Primeiro verificar/criar contato
                                   let contactId: string;
                                   const jid = `${phone}@s.whatsapp.net`;
                                   
                                   const { data: existingContact } = await supabase
                                     .from('contacts')
                                     .select('id')
                                     .eq('phone', phone)
                                     .maybeSingle();

                                   if (existingContact) {
                                     contactId = existingContact.id;
                                   } else {
                                     const { data: newContact, error: contactError } = await supabase
                                       .from('contacts')
                                       .insert({
                                         phone,
                                         jid,
                                         name: contactDisplay !== 'Contato' ? contactDisplay : null,
                                         tipo_contato: 'WhatsApp',
                                       })
                                       .select('id')
                                       .single();

                                     if (contactError) throw contactError;
                                     contactId = newContact.id;
                                   }

                                   // Criar conversa usando instância atual
                                   const instanciaId = instanciaSelecionada || conversaSelecionada?.current_instance_id;
                                   
                                   const { data: novaConversa, error: conversaError } = await supabase
                                     .from('conversas')
                                     .insert({
                                       numero_contato: phone,
                                       nome_contato: contactDisplay !== 'Contato' ? contactDisplay : null,
                                       contact_id: contactId,
                                       current_instance_id: instanciaId,
                                       orig_instance_id: instanciaId,
                                       status: 'novo',
                                     })
                                     .select(`
                                       *,
                                       contact:contact_id(*)
                                     `)
                                     .single();

                                   if (conversaError) throw conversaError;

                                   toast.success('Nova conversa iniciada!');
                                   setConversaSelecionada(novaConversa as any);
                                   invalidateConversas();
                                 } catch (e: any) {
                                   console.error('Erro ao iniciar conversa:', e);
                                   toast.error('Erro ao iniciar conversa');
                                 }
                               };

                               return (
                                 <div className={`flex flex-col gap-2 p-2 rounded-lg ${
                                   isMinhaMsg ? 'bg-primary-foreground/10' : 'bg-background/50'
                                 }`}>
                                   <div className="flex items-center gap-3">
                                     {vCardData.photo ? (
                                       <img 
                                         src={vCardData.photo} 
                                         alt={contactDisplay}
                                         className="w-10 h-10 rounded-full object-cover"
                                         onError={(e) => {
                                           // Fallback para ícone se a imagem falhar
                                           e.currentTarget.style.display = 'none';
                                           e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                         }}
                                       />
                                     ) : null}
                                     <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                       isMinhaMsg ? 'bg-primary-foreground/30' : 'bg-primary/20'
                                     } ${vCardData.photo ? 'hidden' : ''}`}>
                                       <User className="h-5 w-5" />
                                     </div>
                                     <div className="flex-1 min-w-0">
                                       <p className="text-sm font-medium truncate">{contactDisplay}</p>
                                       <p className="text-xs opacity-70">
                                         {vCardData.phone ? `+${vCardData.phone.slice(0, 2)} ${vCardData.phone.slice(2)}` : 'Contato compartilhado'}
                                       </p>
                                     </div>
                                   </div>
                                   <div className="flex gap-2">
                                     <Button
                                       variant="ghost"
                                       size="sm"
                                       onClick={(e) => {
                                         e.stopPropagation();
                                         handleStartConversation();
                                       }}
                                       className={`flex-1 h-8 ${isMinhaMsg ? 'hover:bg-primary-foreground/20' : 'hover:bg-muted'}`}
                                       title="Conversar"
                                     >
                                       <MessageSquare className="h-4 w-4 mr-1" />
                                       <span className="text-xs">Conversar</span>
                                     </Button>
                                     <Button
                                       variant="ghost"
                                       size="sm"
                                       onClick={(e) => {
                                         e.stopPropagation();
                                         handleSaveContact();
                                       }}
                                       className={`flex-1 h-8 ${isMinhaMsg ? 'hover:bg-primary-foreground/20' : 'hover:bg-muted'}`}
                                       title="Salvar contato"
                                     >
                                       <UserCheck className="h-4 w-4 mr-1" />
                                       <span className="text-xs">Salvar</span>
                                     </Button>
                                   </div>
                                 </div>
                               );
                             }
                            
                            // Default text message - clean up placeholder prefixes
                            const displayText = (() => {
                              let t = msg.text || '(Mensagem sem texto)';
                              // Remove placeholder prefixes from n8n
                              if (typeof t === 'string' && t.startsWith('=')) {
                                t = t.substring(1).trim();
                              }
                              return t;
                            })();
                            
                            return (
                              <p className="text-sm whitespace-pre-wrap break-words">
                                {displayText}
                              </p>
                            );
                          })()}
                          <div className="flex items-center justify-end gap-1 mt-1">
                            <div className="flex items-center gap-1">
                              <p className={`text-[11px] ${
                                isMinhaMsg
                                  ? 'text-gray-600 dark:text-gray-300/80'
                                  : 'text-gray-500 dark:text-gray-400'
                              }`}>
                                {msg.is_edited && (
                                  <span className="italic mr-1">editada</span>
                                )}
                                {msg.wa_timestamp
                                  ? format(new Date(msg.wa_timestamp * 1000), "HH:mm", { locale: ptBR })
                                  : format(new Date(msg.created_at), "HH:mm", { locale: ptBR })
                                }
                              </p>
                              {/* Status indicators for sent messages */}
                              {isMinhaMsg && (
                                <>
                                  {msg._sending && (
                                    <div className="flex items-center gap-1">
                                      {typeof msg._progress === 'number' && msg._progress > 0 && msg._progress < 100 && (
                                        <span className="text-[10px] text-gray-600 dark:text-gray-300/70">{msg._progress}%</span>
                                      )}
                                      <Loader2 className="h-3 w-3 animate-spin text-gray-600 dark:text-gray-300/70" />
                                    </div>
                                  )}
                                  {msg._error && (
                                    <div className="flex items-center gap-1">
                                      <AlertCircle className="h-3 w-3 text-destructive" />
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleRetryMessage(msg);
                                        }}
                                        className="flex items-center gap-0.5 text-xs text-destructive hover:underline"
                                      >
                                        <RotateCcw className="h-3 w-3" />
                                        Reenviar
                                      </button>
                                    </div>
                                  )}
                                  {!msg._sending && !msg._error && (
                                    <MessageStatusIcon
                                      status={msg.status}
                                      fromMe={msg.from_me}
                                      className="text-gray-600 dark:text-gray-300/80"
                                    />
                                  )}
                                </>
                              )}
                            </div>
                            {/* Reactions display */}
                            {msg.wa_message_id && messageReactions[msg.wa_message_id] && messageReactions[msg.wa_message_id].length > 0 && (
                              <div className="absolute -bottom-3 left-2 flex items-center bg-background border border-border rounded-full px-1.5 py-0.5 shadow-sm">
                                {messageReactions[msg.wa_message_id].map((reaction, idx) => (
                                  <span key={idx} className="text-sm" title={reaction.from_me ? 'Você' : 'Contato'}>
                                    {reaction.emoji}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      {/* Actions button for received messages (right side) */}
                      {!isMinhaMsg && (
                        <div className="flex items-center ml-1">
                          <MessageActions
                            messageId={msg.id}
                            waMessageId={waMessageId}
                            remoteJid={contactJid}
                            fromMe={msg.from_me}
                            instanciaWhatsappId={msg.instancia_whatsapp_id || conversaSelecionada?.current_instance_id || ''}
                            conversaId={conversaSelecionada?.id || ''}
                            userId={userProfile?.id || ''}
                            messageText={msg.text}
                            messageType={msg.message_type}
                            senderName={nomeRemetente}
                            onStartReply={(reply) => setReplyingTo(reply)}
                          />
                        </div>
                      )}
                      </div>
                    </div>
                  );
                })}
                <div ref={mensagensEndRef} />
              </>
            ) : (
              <div className="flex items-center justify-center h-full min-h-[200px]">
                <div className="text-center space-y-3">
                  <div className="flex justify-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                      <MessageSquare className="h-8 w-8 text-muted-foreground" />
                    </div>
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Selecione uma conversa</h3>
                    <p className="text-sm text-muted-foreground">
                      Escolha uma conversa das colunas ao lado para começar
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Input de Mensagem - FIXO */}
        <ChatInput
          onSendMessage={handleSendMessage}
          onSendMedia={handleSendMedia}
          disabled={!conversaSelecionada || !instanciaSelecionada}
          placeholder={!conversaSelecionada ? "Selecione uma conversa" : !instanciaSelecionada ? "Selecione uma instância" : "Digite sua mensagem..."}
          externalFiles={externalFilesCol3}
          onExternalFilesProcessed={handleExternalFilesProcessed}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
          remoteJid={conversaSelecionada?.contact?.jid || `${conversaSelecionada?.numero_contato}@s.whatsapp.net`}
        />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
      </div>
      
      <DragOverlay dropAnimation={null} modifiers={[snapCenterToCursor]} style={{ zIndex: 9999 }}>
        {activeConversa ? (
          <div 
            className="w-8 h-8 rounded-full shadow-2xl flex items-center justify-center cursor-grabbing pointer-events-none border border-white/80 bg-white/10 backdrop-blur-sm"
            style={{ 
              backgroundColor: getInstanciaCor(activeConversa.orig_instance_id) || '#6366f1'
            }}
            title={activeConversa.contact.name || activeConversa.contact.phone}
          >
            <User className="h-4 w-4 text-white" />
          </div>
        ) : null}
      </DragOverlay>

      {/* Modal de Preview de Imagem */}
      {imagePreview && (
        <div 
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setImagePreview(null)}
        >
          {/* Controles superiores */}
          <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20"
              onClick={(e) => {
                e.stopPropagation();
                setImageZoom(z => Math.max(0.5, z - 0.25));
              }}
            >
              <ZoomOut className="h-5 w-5" />
            </Button>
            <span className="text-white text-sm min-w-[60px] text-center">{Math.round(imageZoom * 100)}%</span>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20"
              onClick={(e) => {
                e.stopPropagation();
                setImageZoom(z => Math.min(3, z + 0.25));
              }}
            >
              <ZoomIn className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20 ml-4"
              onClick={() => setImagePreview(null)}
            >
              <X className="h-6 w-6" />
            </Button>
          </div>

          {/* Navegação */}
          {(() => {
            const allImages = mensagens
              .filter(m => m.message_type === 'image')
              .map(m => {
                const message = m.raw_payload?.message;
                const url = message?.imageMessage?.url;
                const base64 = message?.imageMessage?.base64;
                const mimetype = message?.imageMessage?.mimetype || 'image/jpeg';
                return base64 ? `data:${mimetype};base64,${base64}` : url;
              })
              .filter(Boolean) as string[];
            
            const canGoPrev = imagePreview.index > 0;
            const canGoNext = imagePreview.index < allImages.length - 1;

            return (
              <>
                {canGoPrev && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute left-4 text-white hover:bg-white/20 h-12 w-12"
                    onClick={(e) => {
                      e.stopPropagation();
                      const newIndex = imagePreview.index - 1;
                      setImagePreview({ src: allImages[newIndex], index: newIndex });
                      setImageZoom(1);
                    }}
                  >
                    <ChevronLeft className="h-8 w-8" />
                  </Button>
                )}
                {canGoNext && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-4 text-white hover:bg-white/20 h-12 w-12"
                    onClick={(e) => {
                      e.stopPropagation();
                      const newIndex = imagePreview.index + 1;
                      setImagePreview({ src: allImages[newIndex], index: newIndex });
                      setImageZoom(1);
                    }}
                  >
                    <ChevronRight className="h-8 w-8" />
                  </Button>
                )}
                <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white text-sm">
                  {imagePreview.index + 1} / {allImages.length}
                </p>
              </>
            );
          })()}

          {/* Imagem */}
          <img
            src={imagePreview.src}
            alt="Preview"
            className="max-w-[90vw] max-h-[90vh] object-contain transition-transform duration-200"
            style={{ transform: `scale(${imageZoom})` }}
          onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Modal de confirmação do Calendário */}
      <CalendarConfirmModal
        open={calendarModalOpen}
        onClose={handleCalendarModalClose}
        status={calendarAction.state.status}
        countdown={calendarAction.state.countdown}
        action={calendarAction.state.action}
        message={calendarAction.state.message}
        successMessage={calendarAction.state.successMessage}
        evento={calendarAction.state.evento}
        currentEvento={calendarAction.state.currentEvento}
        eventId={calendarAction.state.eventId}
        conflictMessage={calendarAction.state.conflictMessage}
        errorMessage={calendarAction.state.errorMessage}
        onConfirm={handleCalendarConfirm}
        onEventoChange={calendarAction.updateEvento}
      />
      {/* Dialog de Follow-up */}
      <Dialog open={!!followUpConversaId} onOpenChange={(open) => { if (!open) { setFollowUpConversaId(null); setFollowUpData(""); setFollowUpNota(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Definir Follow-up
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Data e horário</Label>
              <Input
                type="datetime-local"
                value={followUpData}
                onChange={(e) => setFollowUpData(e.target.value)}
              />
            </div>
            <div>
              <Label>Nota (opcional)</Label>
              <Input
                value={followUpNota}
                onChange={(e) => setFollowUpNota(e.target.value)}
                placeholder="Ex: Ligar para confirmar consulta"
              />
            </div>
            <Button onClick={handleDefinirFollowUp} className="w-full">
              Salvar Follow-up
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </DndContext>
  );
}
