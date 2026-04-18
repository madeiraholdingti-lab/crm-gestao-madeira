import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Send, Phone, Clock, User } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Conversa {
  id: string;
  numero_contato: string;
  nome_contato: string | null;
  status: string;
  instancia_id: string | null;
  ultima_interacao: string;
}

interface Mensagem {
  id: string;
  text: string | null;
  from_me: boolean;
  wa_timestamp: number | null;
  created_at: string;
  status: string | null;
  message_type: string | null;
}

interface InstanciaWhatsApp {
  id: string;
  instancia_id: string;
  nome_instancia: string;
}

interface Contact {
  id: string;
  phone: string;
  jid: string;
  name: string | null;
}

export default function DetalheConversa() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [conversa, setConversa] = useState<Conversa | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [instancia, setInstancia] = useState<InstanciaWhatsApp | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [novaMensagem, setNovaMensagem] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [loading, setLoading] = useState(true);
  const mensagensEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let isMounted = true;

    const init = async () => {
      if (!id) {
        console.log('[DetalheConversa] Sem ID, abortando');
        return;
      }
      
      console.log('[DetalheConversa] Iniciando carregamento para conversa:', id);
      
      if (isMounted) {
        setLoading(true);
      }
      
      // Buscar conversa, instância e contato
      const conversaData = await fetchConversa();
      
      if (!isMounted) {
        console.log('[DetalheConversa] Componente desmontado, abortando');
        return;
      }
      
      if (conversaData?.contact && conversaData?.instancia) {
        console.log('[DetalheConversa] Dados carregados, buscando mensagens...', {
          contactId: conversaData.contact.id,
          instanciaId: conversaData.instancia.id
        });
        
        // Buscar mensagens
        const msgs = await fetchMensagens(conversaData.contact.id, conversaData.instancia.id);
        
        if (!isMounted) {
          console.log('[DetalheConversa] Componente desmontado após buscar mensagens');
          return;
        }
        
        console.log('[DetalheConversa] Mensagens carregadas:', msgs?.length || 0);
        
        // Configurar realtime apenas se ainda montado
        const channelName = `messages-${conversaData.contact.id}-${conversaData.instancia.id}`;
        console.log('[DetalheConversa] Configurando canal realtime:', channelName);
        
        channel = supabase
          .channel(channelName)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'messages',
              filter: `contact_id=eq.${conversaData.contact.id}`
            },
            (payload) => {
              console.log('[DetalheConversa] Nova mensagem recebida via realtime:', payload);
              const newMsg = payload.new as Mensagem;
              // Só adiciona se for da instância correta
              if ((payload.new as any).instancia_whatsapp_id === conversaData.instancia.id) {
                setMensagens(prev => {
                  console.log('[DetalheConversa] Adicionando nova mensagem ao estado');
                  return [...prev, newMsg];
                });
              }
            }
          )
          .subscribe((status) => {
            console.log('[DetalheConversa] Status do canal realtime:', status);
          });
      } else {
        console.log('[DetalheConversa] Dados não encontrados:', {
          hasContact: !!conversaData?.contact,
          hasInstancia: !!conversaData?.instancia
        });
      }
      
      if (isMounted) {
        setLoading(false);
      }
    };

    init();

    return () => {
      console.log('[DetalheConversa] Cleanup - removendo canal');
      isMounted = false;
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [id]);

  useEffect(() => {
    scrollToBottom();
  }, [mensagens]);

  const scrollToBottom = () => {
    mensagensEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const fetchConversa = async () => {
    try {
      const { data, error } = await supabase
        .from("conversas")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;
      setConversa(data);

      let instData = null;
      let contactData = null;

      // Buscar a instância WhatsApp
      if (data.instancia_id) {
        const { data: inst } = await supabase
          .from("instancias_whatsapp")
          .select("*")
          .eq("id", data.instancia_id)
          .single();

        if (inst) {
          setInstancia(inst);
          instData = inst;
        }
      }

      // Buscar o contato pelo número
      const { data: cont } = await supabase
        .from("contacts")
        .select("*")
        .eq("phone", data.numero_contato.replace(/\D/g, ''))
        .maybeSingle();

      if (cont) {
        setContact(cont);
        contactData = cont;
      }

      return {
        conversa: data,
        instancia: instData,
        contact: contactData
      };
    } catch (error) {
      console.error("Erro ao carregar conversa:", error);
      toast.error("Erro ao carregar conversa");
      return null;
    }
  };

  const fetchMensagens = async (contactId: string, instanciaId: string) => {
    try {
      console.log('[DetalheConversa] Buscando mensagens...', { contactId, instanciaId });
      
      const { data, error } = await supabase
        .from("messages")
        .select("id, text, from_me, wa_timestamp, created_at, status, message_type")
        .eq("contact_id", contactId)
        .eq("instancia_whatsapp_id", instanciaId)
        .order("wa_timestamp", { ascending: true });

      if (error) {
        console.error('[DetalheConversa] Erro ao buscar mensagens:', error);
        throw error;
      }
      
      console.log('[DetalheConversa] Mensagens encontradas:', data?.length || 0);
      setMensagens(data || []);
      return data;
    } catch (error) {
      console.error("Erro ao carregar mensagens:", error);
      toast.error("Erro ao carregar mensagens");
      return null;
    }
  };

  const enviarMensagem = async () => {
    if (!novaMensagem.trim()) {
      toast.error("Digite uma mensagem");
      return;
    }

    if (!instancia) {
      toast.error("Instância WhatsApp não configurada para esta conversa");
      return;
    }

    if (!conversa) {
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

      // Enviar mensagem via Evolution API
      const { data, error } = await supabase.functions.invoke("enviar-mensagem-evolution", {
        body: {
          conversa_id: conversa.id,
          texto: novaMensagem,
          instancia_whatsapp_id: conversa.instancia_id,
          user_id: user.id,
        },
      });

      if (error) {
        console.error("Erro ao enviar mensagem:", error);
        throw error;
      }

      if (!data?.success) {
        const errorMsg = data?.code === "INSTANCE_NOT_FOUND" 
          ? "A instância não está conectada na Evolution API"
          : data?.message || "Falha ao enviar mensagem";
        throw new Error(errorMsg);
      }

      // A mensagem será registrada automaticamente via edge function
      // Atualizar última mensagem e interação já é feito pela edge function

      toast.success("Mensagem enviada com sucesso!");
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!conversa) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>
        <div className="text-center mt-12">
          <p className="text-muted-foreground">Conversa não encontrada</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="border-b bg-background p-4">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-xl font-bold">
                {conversa.nome_contato || "Sem nome"}
              </h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Phone className="h-3 w-3" />
                {conversa.numero_contato}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {instancia && (
              <Badge variant="outline">
                {instancia.nome_instancia}
              </Badge>
            )}
            <Badge variant="secondary">
              {conversa.status === "novo" && "Novo"}
              {conversa.status === "em_atendimento" && "Em Atendimento"}
              {conversa.status === "aguardando" && "Aguardando"}
              {conversa.status === "finalizado" && "Finalizado"}
            </Badge>
          </div>
        </div>
      </div>

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto bg-muted/20 p-4">
        <div className="container mx-auto max-w-4xl space-y-4">
          {mensagens.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Nenhuma mensagem ainda</p>
            </div>
          ) : (
            mensagens.map((mensagem) => (
              <div
                key={mensagem.id}
                className={`flex ${
                  mensagem.from_me ? "justify-end" : "justify-start"
                }`}
              >
                <Card
                  className={`max-w-[70%] ${
                    mensagem.from_me
                      ? "bg-primary text-primary-foreground"
                      : "bg-background"
                  }`}
                >
                  <CardContent className="p-3">
                    {/* Contact message rendering */}
                    {(mensagem.message_type === 'contact' || 
                      mensagem.message_type === 'contactMessage' || 
                      mensagem.message_type === 'contactsArrayMessage' ||
                      (typeof mensagem.text === 'string' && mensagem.text.trim().startsWith('='))) ? (
                      (() => {
                        const raw = (mensagem.text || '').trim();
                        const contactDisplay = raw
                          .replace(/^📇\s*Contato:\s*/i, '')
                          .replace(/^=+/, '')
                          .trim() || 'Contato';
                        return (
                          <div className={`flex items-center gap-3 p-2 rounded-lg ${
                            mensagem.from_me ? 'bg-primary-foreground/10' : 'bg-background/50'
                          }`}>
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                              mensagem.from_me ? 'bg-primary-foreground/30' : 'bg-primary/20'
                            }`}>
                              <User className="h-5 w-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{contactDisplay}</p>
                              <p className="text-xs opacity-70">Contato compartilhado</p>
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <p className="text-sm whitespace-pre-wrap">{mensagem.text || "(mensagem sem texto)"}</p>
                    )}
                    <div className="flex items-center gap-1 mt-1">
                      <Clock className="h-3 w-3 opacity-70" />
                      <span className="text-xs opacity-70">
                        {mensagem.wa_timestamp 
                          ? format(new Date(mensagem.wa_timestamp * 1000), "HH:mm", { locale: ptBR })
                          : format(new Date(mensagem.created_at), "HH:mm", { locale: ptBR })
                        }
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ))
          )}
          <div ref={mensagensEndRef} />
        </div>
      </div>

      {/* Input de Mensagem */}
      <div className="border-t bg-background p-4">
        <div className="container mx-auto max-w-4xl">
          <div className="flex gap-2">
            <Textarea
              placeholder="Digite sua mensagem..."
              value={novaMensagem}
              onChange={(e) => setNovaMensagem(e.target.value)}
              onKeyPress={handleKeyPress}
              className="min-h-[60px] max-h-[200px] resize-none"
              disabled={enviando || !instancia}
            />
            <Button
              onClick={enviarMensagem}
              disabled={enviando || !novaMensagem.trim() || !instancia}
              size="icon"
              className="h-[60px] w-[60px]"
            >
              <Send className="h-5 w-5" />
            </Button>
          </div>
          {!instancia && (
            <p className="text-sm text-destructive mt-2">
              Atenção: Nenhuma instância WhatsApp configurada para esta conversa
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
