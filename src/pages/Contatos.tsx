import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Phone, Search, User, ChevronLeft, ChevronRight, Upload, Send, Paperclip, X, FileText, Download, Mic, Image as ImageIcon, Video, BrainCircuit, Loader2 } from "lucide-react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { toast } from "sonner";
import { z } from "zod";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChatInput } from "@/components/ChatInput";
import { ImportContactsModal } from "@/components/ImportContactsModal";
import { PERFIS_PROFISSIONAIS } from "@/utils/constants";

interface Contact {
  id: string;
  phone: string;
  name: string | null;
  jid: string;
  tipo_contato: string;
  observacoes: string | null;
  created_at: string;
  perfil_profissional: string | null;
  especialidade: string | null;
  instituicao: string | null;
  perfil_sugerido_ia: string | null;
  perfil_confirmado: boolean;
}

interface Mensagem {
  id: string;
  text: string | null;
  from_me: boolean;
  wa_timestamp: number | null;
  created_at: string;
  status: string | null;
  message_type: string | null;
  instancia_whatsapp_id: string | null;
  media_url: string | null;
  media_mime_type: string | null;
  raw_payload: any;
}

interface InstanciaWhatsApp {
  id: string;
  instancia_id: string;
  nome_instancia: string;
  numero_chip: string | null;
  ativo: boolean;
}

interface Attachment {
  id: string;
  file_name: string;
  file_url: string;
  file_type: string | null;
  file_size: number | null;
  created_at: string;
}

const searchSchema = z.string().trim().max(100, { message: "Pesquisa muito longa" });

// Componente inline para classificação IA de um contato
const ClassificarIAButton = ({ contactId, onResult }: {
  contactId: string | undefined;
  onResult: (result: { perfil: string; especialidade: string | null; instituicao: string | null; motivo: string }) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [contexto, setContexto] = useState("");
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<{ motivo: string; confianca: string } | null>(null);

  const handleClassificar = async () => {
    if (!contactId) return;
    setLoading(true);
    setResultado(null);
    try {
      const { data, error } = await supabase.functions.invoke("classificar-contato-ia", {
        body: { contact_id: contactId, contexto_extra: contexto || undefined },
      });
      if (error || !data) {
        toast.error("Erro ao classificar contato");
        return;
      }
      setResultado({ motivo: data.motivo, confianca: data.confianca });
      onResult({ perfil: data.perfil, especialidade: data.especialidade, instituicao: data.instituicao, motivo: data.motivo });
      toast.success(`Classificado como: ${PERFIS_PROFISSIONAIS.find(p => p.value === data.perfil)?.label || data.perfil}`);
    } catch {
      toast.error("Erro ao classificar");
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="w-full gap-2 text-violet-600 border-violet-200 hover:bg-violet-50 dark:border-violet-800 dark:hover:bg-violet-950/30"
        onClick={() => { setOpen(true); setResultado(null); setContexto(""); }}
      >
        <BrainCircuit className="h-3.5 w-3.5" />
        Classificar com IA
      </Button>
    );
  }

  return (
    <div className="space-y-2 p-3 rounded-lg border border-violet-200 bg-violet-50/50 dark:border-violet-800 dark:bg-violet-950/20">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-violet-700 dark:text-violet-300 flex items-center gap-1">
          <BrainCircuit className="h-3.5 w-3.5" />
          Classificação IA
        </span>
        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setOpen(false)}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      <Textarea
        value={contexto}
        onChange={(e) => setContexto(e.target.value)}
        placeholder="Adicionar contexto (opcional). Ex: 'É o diretor do Hospital Regional'"
        rows={2}
        className="text-xs resize-none"
      />
      <Button
        size="sm"
        className="w-full gap-2"
        onClick={handleClassificar}
        disabled={loading}
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BrainCircuit className="h-3.5 w-3.5" />}
        {loading ? "Analisando..." : "Enviar para IA"}
      </Button>
      {resultado && (
        <p className="text-xs text-muted-foreground italic">
          {resultado.motivo} (confiança: {resultado.confianca})
        </p>
      )}
    </div>
  );
};

const Contatos = () => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [coluna1Minimizada, setColuna1Minimizada] = useState(false);
  
  // Coluna 2 - Ficha do contato
  const [editedContact, setEditedContact] = useState<Partial<Contact>>({});
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [savingContact, setSavingContact] = useState(false);
  
  // Coluna 3 - Mensagens
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [novaMensagem, setNovaMensagem] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [instancias, setInstancias] = useState<InstanciaWhatsApp[]>([]);
  const [instanciaSelecionada, setInstanciaSelecionada] = useState<string>("");
  const mensagensEndRef = useRef<HTMLDivElement>(null);
  
  // Tamanhos dos painéis
  const [coluna1Size, setColuna1Size] = useState(20);
  const [coluna2Size, setColuna2Size] = useState(35);
  const [coluna3Size, setColuna3Size] = useState(45);
  
  // Modal de importação
  const [importModalOpen, setImportModalOpen] = useState(false);

  useEffect(() => {
    fetchContacts();
    fetchInstancias();

    // Realtime para contatos (INSERT, UPDATE, DELETE)
    const contactsChannel = supabase
      .channel("contacts-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "contacts",
        },
        (payload) => {
          console.log('[Contatos] Novo contato via realtime:', payload);
          setContacts(prev => [payload.new as Contact, ...prev]);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "contacts",
        },
        (payload) => {
          console.log('[Contatos] Contato atualizado via realtime:', payload);
          setContacts(prev => 
            prev.map(c => c.id === payload.new.id ? payload.new as Contact : c)
          );
          
          // Se o contato atualizado está selecionado, atualizar também
          if (selectedContact && payload.new.id === selectedContact.id) {
            setSelectedContact(payload.new as Contact);
            setEditedContact(payload.new as Contact);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "contacts",
        },
        (payload) => {
          console.log('[Contatos] Contato deletado via realtime:', payload);
          setContacts(prev => prev.filter(c => c.id !== payload.old.id));
          
          // Se o contato deletado estava selecionado, limpar seleção
          if (selectedContact && payload.old.id === selectedContact.id) {
            setSelectedContact(null);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(contactsChannel);
    };
  }, [selectedContact]);

  useEffect(() => {
    if (searchTerm) {
      try {
        const validatedSearch = searchSchema.parse(searchTerm);
        const searchLower = validatedSearch.toLowerCase();
        
        const filtered = contacts.filter(
          (c) =>
            c.name?.toLowerCase().includes(searchLower) ||
            c.phone.includes(validatedSearch)
        );
        setFilteredContacts(filtered);
      } catch (error) {
        if (error instanceof z.ZodError) {
          setFilteredContacts([]);
          toast.error(error.errors[0].message);
        }
      }
    } else {
      setFilteredContacts(contacts);
    }
  }, [searchTerm, contacts]);

  useEffect(() => {
    if (selectedContact) {
      setEditedContact(selectedContact);
      fetchAttachments(selectedContact.id);
      fetchMensagens(selectedContact.id);
    }
  }, [selectedContact]);

  useEffect(() => {
    mensagensEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens]);

  const fetchContacts = async () => {
    try {
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      const mapped = (data || []).map(c => ({
        ...c,
        tipo_contato: c.tipo_contato || 'Outros',
        perfil_profissional: c.perfil_profissional ?? null,
        especialidade: c.especialidade ?? null,
        instituicao: c.instituicao ?? null,
        perfil_sugerido_ia: c.perfil_sugerido_ia ?? null,
        perfil_confirmado: c.perfil_confirmado ?? false,
      })) as Contact[];
      setContacts(mapped);
      setFilteredContacts(mapped);
    } catch (error) {
      toast.error("Erro ao carregar contatos");
    } finally {
      setLoading(false);
    }
  };

  const fetchAttachments = async (contactId: string) => {
    try {
      const { data, error } = await supabase
        .from("contact_attachments")
        .select("*")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setAttachments(data || []);
    } catch (error) {
      console.error("Erro ao carregar anexos:", error);
    }
  };

  const fetchMensagens = async (contactId: string) => {
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("id, text, from_me, wa_timestamp, created_at, status, message_type, instancia_whatsapp_id, media_url, media_mime_type, raw_payload")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      setMensagens(data || []);
    } catch (error) {
      console.error("Erro ao carregar mensagens:", error);
      toast.error("Erro ao carregar mensagens");
    }
  };

  const fetchInstancias = async () => {
    try {
      const { data, error } = await supabase
        .from("instancias_whatsapp")
        .select("id, instancia_id, nome_instancia, numero_chip, ativo")
        .eq("ativo", true) // Apenas instâncias ativas
        .neq("status", "deletada") // Excluir deletadas
        .neq("status", "inativa") // Excluir inativas
        .order("nome_instancia");

      if (error) throw error;
      setInstancias(data || []);
      if (data && data.length > 0) {
        setInstanciaSelecionada(data[0].id);
      }
    } catch (error) {
      console.error("Erro ao carregar instâncias:", error);
    }
  };

  const handleSaveContact = async () => {
    if (!selectedContact) return;
    
    setSavingContact(true);
    try {
      const { error } = await (supabase
        .from("contacts") as any)
        .update({
          name: editedContact.name,
          tipo_contato: editedContact.tipo_contato,
          observacoes: editedContact.observacoes,
          perfil_profissional: (editedContact as any).perfil_profissional || null,
          especialidade: (editedContact as any).especialidade || null,
          instituicao: (editedContact as any).instituicao || null,
          perfil_confirmado: (editedContact as any).perfil_confirmado || false,
        })
        .eq("id", selectedContact.id);

      if (error) throw error;
      
      toast.success("Contato atualizado com sucesso");
      fetchContacts();
      setSelectedContact({ ...selectedContact, ...editedContact } as Contact);
    } catch (error) {
      console.error("Erro ao salvar contato:", error);
      toast.error("Erro ao salvar contato");
    } finally {
      setSavingContact(false);
    }
  };

  const handleEnviarMensagem = async () => {
    if (!novaMensagem.trim() || !selectedContact || !instanciaSelecionada) {
      toast.error("Preencha a mensagem e selecione uma instância");
      return;
    }

    setEnviando(true);
    try {
      // Buscar o conversa_id baseado no contact_id e instancia
      const { data: conversaData, error: conversaError } = await supabase
        .from("conversas")
        .select("id")
        .eq("contact_id", selectedContact.id)
        .eq("current_instance_id", instanciaSelecionada)
        .single();

      let conversaId = conversaData?.id;

      // Se não existir conversa, criar uma
      if (!conversaId) {
        const { data: newConversa, error: createError } = await supabase
          .from("conversas")
          .insert({
            contact_id: selectedContact.id,
            numero_contato: selectedContact.phone,
            nome_contato: selectedContact.name,
            current_instance_id: instanciaSelecionada,
            orig_instance_id: instanciaSelecionada,
            status: "novo"
          })
          .select()
          .single();

        if (createError) throw createError;
        conversaId = newConversa.id;
      }

      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        toast.error("Usuário não autenticado");
        setEnviando(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("enviar-mensagem-evolution", {
        body: { 
          conversa_id: conversaId, 
          texto: novaMensagem,
          instancia_whatsapp_id: instanciaSelecionada, // UUID da instância selecionada
          user_id: user.id,
        },
      });

      if (error) throw error;

      // Verificar se houve erro no retorno
      if (data && !data.success) {
        const errorMessages: Record<string, string> = {
          'EVOLUTION_INSTANCE_NOT_FOUND': 'A instância não está conectada na Evolution API. Verifique se o WhatsApp está ativo.',
          'INSTANCIA_INATIVA': 'A instância selecionada está inativa',
          'SEM_INSTANCIA': 'Selecione uma instância para enviar',
        };
        throw new Error(errorMessages[data.code] || data.message || 'Erro ao enviar mensagem');
      }

      toast.success("Mensagem enviada com sucesso");
      setNovaMensagem("");
      fetchMensagens(selectedContact.id);
    } catch (error: any) {
      console.error("Erro ao enviar mensagem:", error);
      toast.error(error.message || "Erro ao enviar mensagem");
    } finally {
      setEnviando(false);
    }
  };

  const handleSendMedia = async (file: File, type: 'image' | 'video' | 'document' | 'audio', caption?: string) => {
    if (!selectedContact || !instanciaSelecionada) {
      toast.error("Selecione um contato e uma instância");
      return;
    }

    setEnviando(true);
    try {
      // Buscar ou criar conversa
      const { data: conversaData } = await supabase
        .from("conversas")
        .select("id")
        .eq("contact_id", selectedContact.id)
        .eq("current_instance_id", instanciaSelecionada)
        .maybeSingle();

      let conversaId = conversaData?.id;

      if (!conversaId) {
        const { data: newConversa, error: createError } = await supabase
          .from("conversas")
          .insert({
            contact_id: selectedContact.id,
            numero_contato: selectedContact.phone,
            nome_contato: selectedContact.name,
            current_instance_id: instanciaSelecionada,
            orig_instance_id: instanciaSelecionada,
            status: "novo"
          })
          .select()
          .single();

        if (createError) throw createError;
        conversaId = newConversa.id;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Usuário não autenticado");
        setEnviando(false);
        return;
      }

      const formData = new FormData();
      formData.append('conversa_id', conversaId);
      formData.append('instancia_whatsapp_id', instanciaSelecionada);
      formData.append('user_id', user.id);
      formData.append('media_type', type);
      formData.append('file', file);
      if (caption) {
        formData.append('caption', caption);
      }

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

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'Erro ao enviar mídia');
      }

      toast.success("Mídia enviada com sucesso");
      fetchMensagens(selectedContact.id);
    } catch (error: any) {
      console.error("Erro ao enviar mídia:", error);
      toast.error(error.message || "Erro ao enviar mídia");
    } finally {
      setEnviando(false);
    }
  };

  const handleMinimizarColuna1 = () => {
    const novoEstado = !coluna1Minimizada;
    setColuna1Minimizada(novoEstado);
    
    if (novoEstado) {
      setColuna1Size(7);
      setColuna2Size(40);
      setColuna3Size(53);
    } else {
      setColuna1Size(20);
      setColuna2Size(35);
      setColuna3Size(45);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleMinimizarColuna1}
              className="h-8 w-8"
            >
              {coluna1Minimizada ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
            <h1 className="text-2xl font-bold">Contatos</h1>
          </div>
          <Button variant="outline" className="gap-2" onClick={() => setImportModalOpen(true)}>
            <Upload className="h-4 w-4" />
            Importar Contatos
          </Button>
        </div>
      </div>

      {/* Modal de importação */}
      <ImportContactsModal
        open={importModalOpen}
        onOpenChange={setImportModalOpen}
        onImportComplete={fetchContacts}
      />

      {/* ResizablePanelGroup com 3 colunas */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* COLUNA 1 - Lista de Contatos */}
        <ResizablePanel defaultSize={coluna1Size} minSize={5} maxSize={40}>
          <div className="bg-background overflow-hidden flex flex-col h-full">
          <div className="p-4 border-b">
            {!coluna1Minimizada && (
              <>
                <h2 className="font-semibold mb-3">Todos os Contatos</h2>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="space-y-1 p-2">
              {filteredContacts.map((contact) => (
                <Card
                  key={contact.id}
                  className={`cursor-pointer transition-all hover:shadow-md ${
                    selectedContact?.id === contact.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-card"
                  }`}
                  onClick={() => setSelectedContact(contact)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center gap-3">
                      {!coluna1Minimizada && (
                        <>
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 flex-shrink-0">
                            <User className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold truncate">
                              {contact.name || "Sem nome"}
                            </h3>
                            <p className="text-sm opacity-80 flex items-center gap-1 truncate">
                              <Phone className="h-3 w-3" />
                              {contact.phone}
                            </p>
                          </div>
                        </>
                      )}
                      {coluna1Minimizada && (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                          <User className="h-4 w-4 text-primary" />
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* COLUNA 2 - Ficha do Contato */}
        <ResizablePanel defaultSize={coluna2Size} minSize={20} maxSize={60}>
          <div className="bg-background overflow-hidden flex flex-col h-full">
          {selectedContact ? (
            <>
              <div className="p-4 border-b">
                <h2 className="font-semibold text-lg">Ficha do Contato</h2>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Informações principais */}
                <div className="space-y-3">
                  <div>
                    <Label>Nome Completo</Label>
                    <Input
                      value={editedContact.name || ""}
                      onChange={(e) => setEditedContact({ ...editedContact, name: e.target.value })}
                      placeholder="Nome do contato"
                    />
                  </div>

                  <div>
                    <Label>Telefone</Label>
                    <Input value={selectedContact.phone} disabled />
                  </div>

                  <div>
                    <Label>Tipo de Contato</Label>
                    <Select
                      value={editedContact.tipo_contato}
                      onValueChange={(value) => setEditedContact({ ...editedContact, tipo_contato: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Paciente">Paciente</SelectItem>
                        <SelectItem value="Fornecedor">Fornecedor</SelectItem>
                        <SelectItem value="Parceiro">Parceiro</SelectItem>
                        <SelectItem value="Negociador">Negociador</SelectItem>
                        <SelectItem value="Médico">Médico</SelectItem>
                        <SelectItem value="Outros">Outros</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Perfil Profissional */}
                  <div className="pt-3 border-t">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Perfil Profissional</Label>
                    <div className="mt-2 space-y-2">
                      <Select
                        value={(editedContact as any).perfil_profissional || ""}
                        onValueChange={(value) => setEditedContact({ ...editedContact, perfil_profissional: value } as any)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecionar perfil..." />
                        </SelectTrigger>
                        <SelectContent>
                          {PERFIS_PROFISSIONAIS.map(p => (
                            <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Input
                        value={(editedContact as any).especialidade || ""}
                        onChange={(e) => setEditedContact({ ...editedContact, especialidade: e.target.value } as any)}
                        placeholder="Especialidade (ex: Cardiologia)"
                      />

                      <Input
                        value={(editedContact as any).instituicao || ""}
                        onChange={(e) => setEditedContact({ ...editedContact, instituicao: e.target.value } as any)}
                        placeholder="Instituição (ex: Hospital São José)"
                      />

                      <Input
                        value={(editedContact as any).cargo || ""}
                        onChange={(e) => setEditedContact({ ...editedContact, cargo: e.target.value } as any)}
                        placeholder="Cargo (ex: Diretor Clínico)"
                      />

                      <Input
                        value={(editedContact as any).cidade || ""}
                        onChange={(e) => setEditedContact({ ...editedContact, cidade: e.target.value } as any)}
                        placeholder="Cidade (ex: Itajaí)"
                      />

                      <Select
                        value={(editedContact as any).relevancia || "media"}
                        onValueChange={(value) => setEditedContact({ ...editedContact, relevancia: value } as any)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Relevância" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="alta">Alta</SelectItem>
                          <SelectItem value="media">Média</SelectItem>
                          <SelectItem value="baixa">Baixa</SelectItem>
                        </SelectContent>
                      </Select>

                      {/* Classificar com IA */}
                      <ClassificarIAButton
                        contactId={selectedContact?.id}
                        onResult={(result) => {
                          setEditedContact({
                            ...editedContact,
                            perfil_profissional: result.perfil,
                            especialidade: result.especialidade || (editedContact as any).especialidade,
                            instituicao: result.instituicao || (editedContact as any).instituicao,
                            cargo: (result as any).cargo || (editedContact as any).cargo,
                            cidade: (result as any).cidade || (editedContact as any).cidade,
                            relevancia: (result as any).relevancia || (editedContact as any).relevancia,
                          } as any);
                        }}
                      />

                      {/* Sugestão IA */}
                      {(selectedContact as any)?.perfil_sugerido_ia && !(editedContact as any).perfil_confirmado && !(editedContact as any).perfil_profissional && (
                        <div className="flex items-center gap-2 p-2 bg-violet-50 dark:bg-violet-950/30 rounded text-xs">
                          <span className="text-muted-foreground">Sugestão IA:</span>
                          <Badge variant="secondary" className="text-xs">
                            {PERFIS_PROFISSIONAIS.find(p => p.value === (selectedContact as any).perfil_sugerido_ia)?.label || (selectedContact as any).perfil_sugerido_ia}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs text-violet-600"
                            onClick={() => setEditedContact({
                              ...editedContact,
                              perfil_profissional: (selectedContact as any).perfil_sugerido_ia,
                              perfil_confirmado: true,
                            } as any)}
                          >
                            Confirmar
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <Label>Observações</Label>
                    <Textarea
                      value={editedContact.observacoes || ""}
                      onChange={(e) => setEditedContact({ ...editedContact, observacoes: e.target.value })}
                      placeholder="Anotações sobre o contato..."
                      rows={5}
                    />
                  </div>

                  <Button onClick={handleSaveContact} disabled={savingContact} className="w-full">
                    {savingContact ? "Salvando..." : "Salvar Alterações"}
                  </Button>
                </div>

                {/* Anexos */}
                <div className="pt-4 border-t">
                  <div className="flex items-center justify-between mb-3">
                    <Label>Anexos</Label>
                    <Button variant="outline" size="sm" className="gap-2">
                      <Paperclip className="h-4 w-4" />
                      Adicionar
                    </Button>
                  </div>
                  
                  {attachments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum anexo</p>
                  ) : (
                    <div className="space-y-2">
                      {attachments.map((attachment) => (
                        <Card key={attachment.id}>
                          <CardContent className="p-3 flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">{attachment.file_name}</p>
                              <p className="text-xs text-muted-foreground">
                                {format(new Date(attachment.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                              </p>
                            </div>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <X className="h-4 w-4" />
                            </Button>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <User className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Selecione um contato para ver os detalhes</p>
              </div>
            </div>
          )}
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* COLUNA 3 - Mensagens */}
        <ResizablePanel defaultSize={coluna3Size} minSize={30}>
          <div className="bg-background overflow-hidden flex flex-col h-full">
          {selectedContact ? (
            <>
              <div className="p-4 border-b flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-lg">{selectedContact.name || selectedContact.phone}</h2>
                  <p className="text-sm text-muted-foreground">Histórico de mensagens</p>
                </div>
                <Select value={instanciaSelecionada} onValueChange={setInstanciaSelecionada}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Selecione a instância" />
                  </SelectTrigger>
                  <SelectContent>
                    {instancias.map((inst) => (
                      <SelectItem key={inst.id} value={inst.id}>
                        {inst.nome_instancia}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {mensagens.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-muted-foreground">Nenhuma mensagem ainda</p>
                  </div>
                ) : (
                  mensagens.map((msg) => {
                    const isMinhaMsg = msg.from_me;
                    
                    // Parse raw_payload se for string
                    const parsedPayload = typeof msg.raw_payload === 'string' 
                      ? (() => { try { return JSON.parse(msg.raw_payload); } catch { return msg.raw_payload; } })() 
                      : msg.raw_payload;
                    
                    // Obter URL de mídia
                    const mediaUrl = msg.media_url || parsedPayload?.data?.message?.imageMessage?.url || parsedPayload?.data?.message?.audioMessage?.url;
                    
                    // Renderizar conteúdo baseado no tipo
                    const renderContent = () => {
                      if (msg.message_type === 'audio') {
                        return mediaUrl ? (
                          <audio controls className="max-w-[250px] h-10" preload="metadata">
                            <source src={mediaUrl} type={msg.media_mime_type || 'audio/ogg'} />
                          </audio>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Mic className="h-4 w-4" />
                            <span className="text-sm">Áudio</span>
                          </div>
                        );
                      }
                      
                      if (msg.message_type === 'image') {
                        return mediaUrl ? (
                          <img src={mediaUrl} alt="Imagem" className="max-w-[200px] rounded" loading="lazy" />
                        ) : (
                          <div className="flex items-center gap-2">
                            <ImageIcon className="h-4 w-4" />
                            <span className="text-sm">Imagem</span>
                          </div>
                        );
                      }
                      
                      if (msg.message_type === 'video') {
                        return mediaUrl ? (
                          <video controls className="max-w-[200px] rounded" preload="metadata">
                            <source src={mediaUrl} type={msg.media_mime_type || 'video/mp4'} />
                          </video>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Video className="h-4 w-4" />
                            <span className="text-sm">Vídeo</span>
                          </div>
                        );
                      }
                      
                      if (msg.message_type === 'document') {
                        const docFileName = parsedPayload?.data?.message?.documentMessage?.fileName || 
                                           parsedPayload?.message?.documentMessage?.fileName || 
                                           msg.text?.replace('📎 ', '').trim() || 'Documento';
                        
                        const displayFileName = docFileName.length > 25 
                          ? `${docFileName.substring(0, 18)}...${docFileName.includes('.') ? docFileName.split('.').pop() : ''}`
                          : docFileName;
                        
                        return (
                          <div className={`flex items-center gap-2 p-2 rounded ${isMinhaMsg ? 'bg-primary-foreground/10' : 'bg-background/50'}`}>
                            <FileText className="h-5 w-5 flex-shrink-0" />
                            <span className="text-sm" title={docFileName}>{displayFileName}</span>
                            {mediaUrl && (
                              <a href={mediaUrl} target="_blank" rel="noopener noreferrer" className="p-1 rounded hover:bg-background/20">
                                <Download className="h-4 w-4" />
                              </a>
                            )}
                          </div>
                        );
                      }
                      
                      return <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>;
                    };
                    
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isMinhaMsg ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[70%] rounded-lg px-4 py-2 ${
                            isMinhaMsg
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          }`}
                        >
                          {renderContent()}
                          <p className="text-xs opacity-70 mt-1">
                            {msg.wa_timestamp
                              ? format(new Date(msg.wa_timestamp * 1000), "HH:mm", { locale: ptBR })
                              : format(new Date(msg.created_at), "HH:mm", { locale: ptBR })}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={mensagensEndRef} />
              </div>

              <ChatInput
                onSendMessage={async (msg) => {
                  if (!selectedContact || !instanciaSelecionada) {
                    toast.error("Selecione um contato e uma instância");
                    return;
                  }
                  setEnviando(true);
                  try {
                    const { data: conversaData } = await supabase
                      .from("conversas")
                      .select("id")
                      .eq("contact_id", selectedContact.id)
                      .eq("current_instance_id", instanciaSelecionada)
                      .maybeSingle();

                    let conversaId = conversaData?.id;

                    if (!conversaId) {
                      const { data: newConversa, error: createError } = await supabase
                        .from("conversas")
                        .insert({
                          contact_id: selectedContact.id,
                          numero_contato: selectedContact.phone,
                          nome_contato: selectedContact.name,
                          current_instance_id: instanciaSelecionada,
                          orig_instance_id: instanciaSelecionada,
                          status: "novo"
                        })
                        .select()
                        .single();

                      if (createError) throw createError;
                      conversaId = newConversa.id;
                    }

                    const { data: { user } } = await supabase.auth.getUser();
                    if (!user) {
                      toast.error("Usuário não autenticado");
                      return;
                    }

                    const { data, error } = await supabase.functions.invoke("enviar-mensagem-evolution", {
                      body: { 
                        conversa_id: conversaId, 
                        texto: msg,
                        instancia_whatsapp_id: instanciaSelecionada,
                        user_id: user.id,
                      },
                    });

                    if (error) throw error;
                    if (data && !data.success) {
                      throw new Error(data.message || 'Erro ao enviar mensagem');
                    }

                    toast.success("Mensagem enviada");
                    fetchMensagens(selectedContact.id);
                  } catch (error: any) {
                    console.error("Erro ao enviar mensagem:", error);
                    toast.error(error.message || "Erro ao enviar mensagem");
                  } finally {
                    setEnviando(false);
                  }
                }}
                onSendMedia={handleSendMedia}
                disabled={!selectedContact || !instanciaSelecionada}
                placeholder={!selectedContact ? "Selecione um contato" : !instanciaSelecionada ? "Selecione uma instância" : "Digite sua mensagem..."}
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Phone className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Selecione um contato para ver as mensagens</p>
              </div>
            </div>
          )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};

export default Contatos;
