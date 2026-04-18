import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Settings, Wifi, WifiOff, RefreshCw, Phone, Plus, QrCode, Trash2, PhoneOff, Smartphone, AppWindow, BrainCircuit } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { QRCodeModal, QRCodeStatus } from "@/components/QRCodeModal";
import { ConfigGeralSection } from "@/components/ConfigGeralSection";
import { ConfigAppsSection } from "@/components/ConfigAppsSection";
import { ConfigIASection } from "@/components/ConfigIASection";

const CORES_DISPONIVEIS = [
  "#2563EB", // Azul vibrante
  "#DC2626", // Vermelho
  "#059669", // Verde esmeralda
  "#7C3AED", // Roxo
  "#EA580C", // Laranja
  "#0891B2", // Ciano
  "#BE185D", // Magenta
  "#4338CA", // Índigo
];

interface InstanciaWhatsApp {
  id: string;
  nome_instancia: string;
  instancia_id: string;
  token_zapi: string;
  ativo: boolean;
  created_at: string;
  updated_at: string;
  cor_identificacao?: string;
  token_instancia?: string;
  tipo_canal?: string;
  numero_chip?: string;
}

interface InstanciaEvolution {
  instance: {
    instanceName: string;
    status: string;
  };
  connectionStatus: string;
  ownerJid?: string;
  profilePictureUrl?: string;
}

interface InstanciaMesclada extends InstanciaWhatsApp {
  evolutionData?: InstanciaEvolution;
  statusReal?: string;
  numeroConectado?: string;
  isWebhookIA?: boolean;
}

export default function ConfiguracaoEvolution() {
  const [instancias, setInstancias] = useState<InstanciaMesclada[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [testingConnection, setTestingConnection] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [currentQrCode, setCurrentQrCode] = useState<string | null>(null);
  const [currentQrBase64, setCurrentQrBase64] = useState<string | null>(null);
  const [connectingInstance, setConnectingInstance] = useState<string | null>(null);
  const [lastConnectingInstance, setLastConnectingInstance] = useState<InstanciaMesclada | null>(null);
  const [instanciaParaDeletar, setInstanciaParaDeletar] = useState<InstanciaWhatsApp | null>(null);
  const [instanciaParaEditar, setInstanciaParaEditar] = useState<InstanciaWhatsApp | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [webhookConfigured, setWebhookConfigured] = useState(false);
  const [reconfiguringWebhook, setReconfiguringWebhook] = useState<string | null>(null);
  const [webhookBase64Status, setWebhookBase64Status] = useState<Record<string, boolean | null>>({});
  const pollingRef = useRef<number | null>(null);
  
  // Estados para o modal de QR Code
  const [qrStatus, setQrStatus] = useState<QRCodeStatus>("loading");
  const [qrStatusMessage, setQrStatusMessage] = useState<string>("");
  
  const [novaInstancia, setNovaInstancia] = useState({
    nome_instancia: "",
    instancia_id: "",
    token_instancia: "",
    tipo_canal: "whatsapp",
    numero_chip: "",
    cor_identificacao: "#4B0080",
  });

  useEffect(() => {
    fetchInstancias();
    checkIfAdmin();
    checkWebhookConfig();
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  const checkIfAdmin = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      setIsAdmin(roleData?.role === 'admin_geral');
    } catch (error) {
      console.error('Erro ao verificar role:', error);
    }
  };

  const checkWebhookConfig = async () => {
    try {
      const { data, error } = await supabase
        .from("config_global")
        .select("webhook_url")
        .single();

      if (error) throw error;
      
      setWebhookConfigured(!!data?.webhook_url && data.webhook_url.trim() !== "");
    } catch (error) {
      console.error("Erro ao verificar configuração do webhook:", error);
      setWebhookConfigured(false);
    }
  };

  const fetchInstancias = async (showToast = false) => {
    try {
      if (showToast) {
        toast.info("Sincronizando conexões...");
      }
      
      // Fetch IA webhook URL for comparison
      const { data: configData } = await supabase
        .from("config_global")
        .select("webhook_ia_respondendo, webhook_url")
        .single();
      const iaWebhookUrl = (configData as any)?.webhook_ia_respondendo || "";

      // Passo 1: Buscar instâncias da Evolution API (dados em tempo real)
      const { data: evolutionData, error: evolutionError } = await supabase.functions.invoke("listar-instancias-evolution");
      
      if (evolutionError) {
        console.error("Erro ao buscar instâncias da Evolution:", evolutionError);
      }

      // Passo 2: Buscar TODAS as configurações locais (incluindo as não deletadas)
      const { data: localData, error: localError } = await supabase
        .from("instancias_whatsapp")
        .select("*")
        .neq("status", "deletada")
        .order("created_at", { ascending: false });

      if (localError) throw localError;

      // Passo 3: Sincronizar status
      const instanciasEvolution = evolutionData?.instances || [];
      const evolutionInstanceIds = instanciasEvolution.map((evol: any) => 
        evol.name || evol.instance?.instanceName || evol.instanceName
      );

      const instanciasLocal = localData || [];
      for (const localInst of instanciasLocal) {
        const existeNaEvolution = evolutionInstanceIds.includes(localInst.instancia_id) || 
                                   evolutionInstanceIds.includes(localInst.nome_instancia);
        
        if (!existeNaEvolution && localInst.status !== 'deletada') {
          console.log(`Marcando instância ${localInst.nome_instancia} como deletada`);
          await supabase
            .from("instancias_whatsapp")
            .update({ status: 'deletada' })
            .eq("id", localInst.id);
        }
      }

      // Passo 4: Mesclar dados
      const instanciasMescladas: InstanciaMesclada[] = instanciasEvolution.map((evol: any) => {
        const instanceName = evol.name || evol.instance?.instanceName || evol.instanceName;
        const local = instanciasLocal.find(l => l.instancia_id === instanceName || l.nome_instancia === instanceName);
        const numeroConectado = evol.ownerJid ? evol.ownerJid.split('@')[0] : '';
        
        return {
          id: local?.id || instanceName,
          nome_instancia: local?.nome_instancia || instanceName,
          instancia_id: instanceName,
          token_zapi: local?.token_zapi || "",
          token_instancia: local?.token_instancia,
          tipo_canal: local?.tipo_canal,
          numero_chip: local?.numero_chip,
          ativo: evol.connectionStatus === 'open',
          created_at: local?.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
          cor_identificacao: local?.cor_identificacao || "#3B82F6",
          evolutionData: evol,
          statusReal: evol.connectionStatus,
          numeroConectado: numeroConectado,
        };
      });

      // Fetch real webhook URLs to detect IA instances
      const instanceNames = instanciasMescladas.map(i => i.nome_instancia);
      if (instanceNames.length > 0) {
        try {
          const { data: webhookData } = await supabase.functions.invoke("buscar-webhooks-instancias", {
            body: { instanceNames },
          });
          if (webhookData?.success && webhookData?.webhooks) {
            instanciasMescladas.forEach(inst => {
              const wh = webhookData.webhooks[inst.nome_instancia];
              inst.isWebhookIA = !!(iaWebhookUrl && wh?.url && wh.url === iaWebhookUrl);
            });
          }
        } catch (whErr) {
          console.error("Erro ao buscar webhooks:", whErr);
        }
      }

      setInstancias(instanciasMescladas);
      
      if (showToast) {
        toast.success("Conexões sincronizadas com sucesso!");
      }
    } catch (error) {
      console.error("Erro ao carregar instâncias:", error);
      toast.error("Erro ao carregar instâncias WhatsApp");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  const desconectarInstancia = async (instanceName: string) => {
    try {
      const { data, error } = await supabase.functions.invoke(
        'desconectar-evolution',
        { body: { instanceName } }
      );

      if (error) throw error;

      if (data?.success) {
        toast.success(`A instância "${instanceName}" foi desconectada.`);
        await fetchInstancias();
      } else {
        throw new Error(data?.error || "Erro desconhecido");
      }
    } catch (error) {
      console.error("Erro ao desconectar:", error);
      toast.error("Não foi possível desconectar a instância.");
    }
  };

  const sincronizarInstancias = async () => {
    setSyncing(true);
    await fetchInstancias(true);
  };

  const adicionarInstancia = async () => {
    if (!novaInstancia.nome_instancia) {
      toast.error("Preencha o nome da instância");
      return;
    }

    try {
      // Passo 1: Criar instância na Evolution API
      toast.info("Criando instância na Evolution API...");
      
      const { data: evolutionData, error: evolutionError } = await supabase.functions.invoke("criar-instancia-evolution", {
        body: {
          instanceName: novaInstancia.nome_instancia,
          token: novaInstancia.token_instancia || undefined,
          integration: novaInstancia.tipo_canal === "whatsapp" ? "WHATSAPP-BAILEYS" : novaInstancia.tipo_canal,
        },
      });

      if (evolutionError) throw evolutionError;

      if (!evolutionData?.success) {
        toast.error(evolutionData?.error || "Erro ao criar instância na Evolution API");
        return;
      }

      console.log("Resposta da criação:", evolutionData);

      // Extrair o UUID da instância retornado pela Evolution API
      const instanceUuid = evolutionData?.instance?.instanceId;
      if (!instanceUuid) {
        toast.error("Evolution API não retornou o ID da instância");
        return;
      }

      // Verificar se o QR Code veio na resposta
      const qrCodeBase64 = evolutionData?.qrCode?.base64;
      const hasQrCode = !!qrCodeBase64;

      // Passo 2: Salvar no banco de dados com o UUID da Evolution
      const { error } = await supabase.from("instancias_whatsapp").insert({
        nome_instancia: novaInstancia.nome_instancia,
        instancia_id: instanceUuid, // UUID retornado pela Evolution API
        token_zapi: "",
        token_instancia: novaInstancia.token_instancia,
        tipo_canal: novaInstancia.tipo_canal,
        numero_chip: novaInstancia.numero_chip,
        ativo: false,
        cor_identificacao: novaInstancia.cor_identificacao,
      });

      if (error) throw error;

      toast.success("Instância criada com sucesso!");
      setShowAddModal(false);

      // Se QR Code veio na resposta, exibir imediatamente
      if (hasQrCode) {
        console.log("QR Code detectado, abrindo modal...");
        setCurrentQrBase64(qrCodeBase64);
        setQrStatus("waiting");
        setQrStatusMessage("QR Code gerado! Escaneie com seu WhatsApp para conectar.");
        setShowQrModal(true);
        
        // Iniciar polling de status usando o UUID da Evolution
        iniciarPollingSimples(instanceUuid);
      } else {
        console.log("QR Code não detectado na resposta");
        toast.warning("Instância criada, mas QR Code não foi retornado. Sincronize para atualizar o status.");
      }

      setNovaInstancia({
        nome_instancia: "",
        instancia_id: "",
        token_instancia: "",
        tipo_canal: "whatsapp",
        numero_chip: "",
        cor_identificacao: "#3B82F6",
      });
      fetchInstancias();
    } catch (error) {
      console.error("Erro ao adicionar instância:", error);
      toast.error("Erro ao adicionar instância");
    }
  };

  const conectarInstancia = async (instancia: InstanciaMesclada) => {
    setConnectingInstance(instancia.id);
    setLastConnectingInstance(instancia);
    
    try {
      console.log("Conectando instância:", instancia);
      console.log("Instance ID real da Evolution:", instancia.instancia_id);
      console.log("Status atual:", instancia.statusReal, "Ativo:", instancia.ativo);
      
      // Verificar se a instância está desconectada e precisa ser reiniciada
      const isDisconnected = !instancia.ativo || instancia.statusReal === 'close' || instancia.statusReal === 'closed';
      
      let data;
      let error;

      if (isDisconnected) {
        // Passo 1: Reiniciar instância desconectada usando PUT /instance/restart
        console.log("Instância desconectada, usando endpoint de restart...");
        toast.info("Reiniciando instância para gerar novo QR Code...");
        
        const restartResult = await supabase.functions.invoke("reiniciar-instancia-evolution", {
          body: {
            instanceName: instancia.nome_instancia,
          },
        });
        
        data = restartResult.data;
        error = restartResult.error;
        
        console.log("Resultado do restart:", data);
        
        // Se o restart não retornou QR code, tentar o endpoint connect
        if (data?.success && !data?.base64) {
          console.log("Restart OK, mas sem QR. Tentando endpoint connect...");
          const connectResult = await supabase.functions.invoke("conectar-evolution", {
            body: {
              instanceId: instancia.nome_instancia,
            },
          });
          
          if (connectResult.data?.base64) {
            data.base64 = connectResult.data.base64;
          }
        }
      } else {
        // Instância nova ou já conectada, usar endpoint connect normal
        console.log("Usando endpoint connect padrão...");
        const connectResult = await supabase.functions.invoke("conectar-evolution", {
          body: {
            instanceId: instancia.instancia_id,
          },
        });
        
        data = connectResult.data;
        error = connectResult.error;
      }

      if (error) throw error;

      if (data?.success && data?.base64) {
        // Abrir modal com QR Code
        setCurrentQrBase64(data.base64);
        setQrStatus("waiting");
        setQrStatusMessage("QR Code gerado! Escaneie com seu WhatsApp para conectar.");
        setShowQrModal(true);
        
        // Iniciar polling para verificar status
        iniciarPolling(instancia);
      } else if (data?.success && !data?.base64) {
        // Reiniciou mas não conseguiu gerar QR - pode precisar aguardar
        setQrStatus("error");
        setQrStatusMessage("Instância reiniciada, mas QR Code não foi gerado. Clique em 'Tentar Novamente'.");
        setShowQrModal(true);
      } else {
        setQrStatus("error");
        setQrStatusMessage(data?.error || "Falha ao gerar QR Code. Verifique se a instância existe.");
        setShowQrModal(true);
      }
    } catch (error: any) {
      console.error("Erro ao conectar instância:", error);
      setQrStatus("error");
      setQrStatusMessage("Erro ao conectar instância. Verifique sua conexão e tente novamente.");
      setShowQrModal(true);
    } finally {
      setConnectingInstance(null);
    }
  };


  const iniciarPollingSimples = (instanceName: string) => {
    // Limpar polling anterior se existir
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }

    console.log(`Iniciando polling para instância: ${instanceName}`);

    // Atualizar status no modal
    setQrStatus("waiting");
    setQrStatusMessage("Aguardando conexão do WhatsApp... Escaneie o QR Code para conectar.");

    // Polling a cada 1 segundo por até 2 minutos
    let attempts = 0;
    const maxAttempts = 24; // 24 * 5s = 2 minutos

    pollingRef.current = window.setInterval(async () => {
      attempts++;
      
      try {
        // Buscar status completo da instância
        const { data: instancesData, error: instancesError } = await supabase.functions.invoke("listar-instancias-evolution");
        
        if (instancesError) throw instancesError;

        const instances = instancesData?.instances || [];
        const currentInstance = instances.find((inst: any) => 
          inst.id === instanceName || inst.name === instanceName
        );

        console.log(`Polling status (tentativa ${attempts}):`, currentInstance);

        // Verificar se está conectado E tem número válido
        const isConnected = currentInstance?.connectionStatus === 'open';
        const hasValidNumber = currentInstance?.ownerJid && currentInstance.ownerJid.includes('@');

        if (isConnected && hasValidNumber) {
          // Parar polling
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }

          // Mostrar sucesso no modal
          setQrStatus("success");
          setQrStatusMessage("WhatsApp conectado com sucesso! Configurando webhook...");

          // Configurar webhook após conexão confirmada
          await configurarWebhookAposConexao(instanceName);
          
          // Fechar modal e atualizar lista
          setTimeout(() => {
            setShowQrModal(false);
            setCurrentQrBase64(null);
            setQrStatus("loading");
            setQrStatusMessage("");
            fetchInstancias();
            toast.success("Instância conectada e configurada com sucesso!");
          }, 2000);
        }

        // Timeout
        if (attempts >= maxAttempts) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          
          setQrStatus("timeout");
          setQrStatusMessage("Tempo limite atingido! O WhatsApp não foi conectado dentro do tempo esperado. Clique em 'Tentar Novamente' para gerar um novo QR Code.");
        }
      } catch (error) {
        console.error("Erro no polling:", error);
        
        // Se for erro crítico, parar polling
        if (attempts > 5) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          
          setQrStatus("error");
          setQrStatusMessage("Erro ao verificar o status da conexão. Verifique sua conexão e tente novamente.");
        }
      }
    }, 5000); // A cada 5 segundos (era 1s — reduzido para economizar queries)
  };

  const configurarWebhookAposConexao = async (instanceId: string) => {
    try {
      setReconfiguringWebhook(instanceId);
      
      const { data, error } = await supabase.functions.invoke("configurar-webhook-evolution", {
        body: { instanceId },
      });

      if (error) throw error;

      if (data?.success) {
        console.log("Webhook configurado com sucesso:", data);
        
        // Verificar se base64 foi realmente ativado
        const base64Configured = data.webhookBase64Configured === true;
        const base64Returned = data.webhookBase64Returned === true;
        const base64Active = base64Configured && base64Returned;
        
        // Atualizar estado do base64 para esta instância
        setWebhookBase64Status(prev => ({
          ...prev,
          [instanceId]: base64Active
        }));
        
        // Feedback específico sobre base64
        if (base64Active) {
          toast.success(`Webhook configurado! Base64 está ATIVO ✓`);
        } else if (base64Configured && !base64Returned) {
          toast.warning(`Webhook configurado, mas Base64 não foi ativado pela API Evolution`);
        } else {
          toast.success("Webhook configurado com sucesso!");
        }
        
        return true;
      } else {
        throw new Error(data?.error || "Erro ao configurar webhook");
      }
    } catch (error) {
      console.error("Erro ao configurar webhook:", error);
      toast.error("Erro ao configurar webhook. Verifique as configurações e tente novamente.");
      
      // Marcar como erro no status
      setWebhookBase64Status(prev => ({
        ...prev,
        [instanceId]: null
      }));
      
      return false;
    } finally {
      setReconfiguringWebhook(null);
    }
  };

  const iniciarPolling = (instancia: InstanciaWhatsApp) => {
    iniciarPollingSimples(instancia.instancia_id);
  };

  const testarConexao = async (instancia: InstanciaWhatsApp) => {
    setTestingConnection(instancia.id);
    
    try {
      const { data, error } = await supabase.functions.invoke("testar-evolution", {
        body: {
          instanceId: instancia.instancia_id,
          token: instancia.token_zapi,
        },
      });

      if (error) throw error;

      if (data?.connected) {
        toast.success(`Conexão ativa: ${instancia.nome_instancia}`);
        
        await supabase
          .from("instancias_whatsapp")
          .update({ 
            ativo: true,
            status: 'ativa',
            updated_at: new Date().toISOString() 
          })
          .eq("id", instancia.id);
        
        fetchInstancias();
      } else {
        toast.error(`Falha na conexão: ${instancia.nome_instancia}`);
        
        await supabase
          .from("instancias_whatsapp")
          .update({ 
            ativo: false,
            status: 'inativa',
            updated_at: new Date().toISOString() 
          })
          .eq("id", instancia.id);
        
        fetchInstancias();
      }
    } catch (error: any) {
      console.error("Erro ao testar conexão:", error);
      toast.error("Falha na verificação da conexão");
      
      await supabase
        .from("instancias_whatsapp")
        .update({ 
          ativo: false,
          status: 'inativa',
          updated_at: new Date().toISOString() 
        })
        .eq("id", instancia.id);
      
      fetchInstancias();
    } finally {
      setTestingConnection(null);
    }
  };

  const fecharQrModal = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setShowQrModal(false);
    setCurrentQrCode(null);
    setCurrentQrBase64(null);
  };

  const abrirEditarModal = (instancia: InstanciaWhatsApp) => {
    setInstanciaParaEditar(instancia);
    setShowEditModal(true);
  };

  const editarInstancia = async () => {
    if (!instanciaParaEditar) return;

    if (!instanciaParaEditar.nome_instancia) {
      toast.error("Preencha o nome da instância");
      return;
    }

    try {
      // Verifica se o ID é um UUID válido ou se é apenas o nome da instância
      const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(instanciaParaEditar.id);
      
      if (isValidUUID) {
        // Atualiza instância existente no banco
        const { error } = await supabase
          .from("instancias_whatsapp")
          .update({
            nome_instancia: instanciaParaEditar.nome_instancia,
            cor_identificacao: instanciaParaEditar.cor_identificacao,
            numero_chip: instanciaParaEditar.numero_chip,
            updated_at: new Date().toISOString(),
          })
          .eq("id", instanciaParaEditar.id);

        if (error) throw error;
      } else {
        // Cria nova entrada no banco para instância que só existe na Evolution
        const { error } = await supabase
          .from("instancias_whatsapp")
          .upsert({
            instancia_id: instanciaParaEditar.instancia_id,
            nome_instancia: instanciaParaEditar.nome_instancia,
            cor_identificacao: instanciaParaEditar.cor_identificacao,
            numero_chip: instanciaParaEditar.numero_chip,
            token_zapi: instanciaParaEditar.token_zapi,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'instancia_id'
          });

        if (error) throw error;
      }

      toast.success("Instância atualizada com sucesso!");
      setShowEditModal(false);
      setInstanciaParaEditar(null);
      fetchInstancias();
    } catch (error) {
      console.error("Erro ao editar instância:", error);
      toast.error("Erro ao editar instância");
    }
  };

  const abrirDialogDeletar = (instancia: InstanciaWhatsApp) => {
    setInstanciaParaDeletar(instancia);
    setShowDeleteDialog(true);
  };

  const deletarInstancia = async () => {
    if (!instanciaParaDeletar) return;

    try {
      // Passo 1: Deletar da Evolution API
      toast.info("Removendo instância da Evolution API...");
      
      console.log("Deletando instância:", instanciaParaDeletar);
      console.log("Instance ID real da Evolution:", instanciaParaDeletar.instancia_id);
      
      const { data: evolutionData, error: evolutionError } = await supabase.functions.invoke("deletar-instancia-evolution", {
        body: {
          instanceId: instanciaParaDeletar.instancia_id,
        },
      });

      if (evolutionError) {
        console.error("Erro ao deletar da Evolution:", evolutionError);
        toast.error("Erro ao remover instância da Evolution API");
        return;
      }

      if (!evolutionData?.success) {
        toast.error(evolutionData?.error || "Erro ao remover instância da Evolution API");
        return;
      }

      // Passo 2: Marcar como deletada no banco local (soft delete)
      if (instanciaParaDeletar.id && instanciaParaDeletar.id !== instanciaParaDeletar.nome_instancia) {
        // Se tem ID do banco, atualizar status por ID
        const { error: localError } = await supabase
          .from("instancias_whatsapp")
          .update({ status: 'deletada' })
          .eq("id", instanciaParaDeletar.id);

        if (localError) {
          console.warn("Erro ao marcar registro local como deletado por ID:", localError);
        }
      } else {
        // Senão, tentar atualizar pelo nome da instância
        const { error: localError } = await supabase
          .from("instancias_whatsapp")
          .update({ status: 'deletada' })
          .eq("nome_instancia", instanciaParaDeletar.nome_instancia);

        if (localError) {
          console.warn("Erro ao marcar registro local como deletado por nome:", localError);
        }
      }

      toast.success("Instância removida com sucesso!");
      setShowDeleteDialog(false);
      setInstanciaParaDeletar(null);
      fetchInstancias();
    } catch (error) {
      console.error("Erro ao deletar instância:", error);
      toast.error("Erro ao deletar instância");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Settings className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold text-foreground">Configurações</h1>
            <p className="text-muted-foreground">Gerencie conexões e aplicativos</p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="evolution" className="w-full">
        <TabsList className="grid w-full max-w-lg grid-cols-3">
          <TabsTrigger value="evolution" className="flex items-center gap-2">
            <Smartphone className="h-4 w-4" />
            Config Evolution
          </TabsTrigger>
          <TabsTrigger value="ia" className="flex items-center gap-2">
            <BrainCircuit className="h-4 w-4" />
            Config IA
          </TabsTrigger>
          <TabsTrigger value="apps" className="flex items-center gap-2">
            <AppWindow className="h-4 w-4" />
            Config Apps
          </TabsTrigger>
        </TabsList>

        <TabsContent value="evolution" className="mt-6 space-y-6">
          {/* Header com ações da aba Evolution */}
          <div className="flex items-center justify-end gap-2">
            <Button 
              variant="outline" 
              onClick={sincronizarInstancias}
              disabled={syncing}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              Sincronizar
            </Button>
            {isAdmin && (
              <Button 
                variant="outline" 
                size="icon"
                onClick={() => setShowConfigModal(true)}
                title="Configurações Gerais"
              >
                <Settings className="h-4 w-4" />
              </Button>
            )}
            <Button onClick={() => setShowAddModal(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Nova Instância
            </Button>
          </div>

      {instancias.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Phone className="h-16 w-16 text-muted-foreground mb-4" />
            <p className="text-lg font-medium text-muted-foreground">
              Nenhuma instância WhatsApp configurada
            </p>
            <p className="text-sm text-muted-foreground">
              Clique em "Nova Instância" para começar
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          {instancias.map((instancia) => {
            const corFundo = instancia.cor_identificacao || '#3B82F6';
            return (
              <Card 
                key={instancia.id} 
                className="hover:shadow-lg transition-shadow border-2"
                style={{
                  backgroundColor: `${corFundo}15`,
                  borderColor: corFundo
                }}
              >
                <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-lg">{instancia.nome_instancia}</CardTitle>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={instancia.ativo ? "default" : "secondary"}
                      className="flex items-center gap-1"
                    >
                      {instancia.ativo ? (
                        <>
                          <Wifi className="h-3 w-3" />
                          Conectado
                        </>
                      ) : (
                        <>
                          <WifiOff className="h-3 w-3" />
                          Desconectado
                        </>
                      )}
                    </Badge>
                    {instancia.isWebhookIA && (
                      <Badge className="bg-purple-600 flex items-center gap-1">
                        <BrainCircuit className="h-3 w-3" /> IA
                      </Badge>
                    )}
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8"
                      onClick={() => abrirEditarModal(instancia)}
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <CardDescription className="truncate">{instancia.instancia_id}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-muted-foreground whitespace-nowrap">Status:</span>
                    <span className="font-medium text-right">
                      {instancia.statusReal === 'open' ? "Conectado" : "Desconectado"}
                    </span>
                  </div>
                  {instancia.numeroConectado && (
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-muted-foreground whitespace-nowrap">Número:</span>
                      <span className="font-medium text-right">
                        {instancia.numeroConectado.substring(0, 4)}...{instancia.numeroConectado.substring(instancia.numeroConectado.length - 4)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-muted-foreground whitespace-nowrap">Última sync:</span>
                    <span className="font-medium text-right">
                      {format(new Date(instancia.updated_at), "dd/MM/yyyy HH:mm", {
                        locale: ptBR,
                      })}
                    </span>
                  </div>
                </div>
                
                <div className="space-y-2">
                  {instancia.ativo && instancia.statusReal === 'open' ? (
                    // Estado: Conectado
                    <Button
                      onClick={() => desconectarInstancia(instancia.instancia_id)}
                      variant="destructive"
                      className="w-full"
                    >
                      <PhoneOff className="mr-2 h-4 w-4" />
                      Desconectar
                    </Button>
                  ) : (
                    // Estado: Desconectado
                    <Button
                      onClick={() => conectarInstancia(instancia)}
                      disabled={connectingInstance === instancia.id}
                      className="w-full"
                    >
                      {connectingInstance === instancia.id ? (
                        <>
                          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                          Conectando...
                        </>
                      ) : (
                        <>
                          <QrCode className="mr-2 h-4 w-4" />
                          Conectar / Gerar QR Code
                        </>
                      )}
                    </Button>
                  )}
                  
                  {instancia.ativo && instancia.statusReal === 'open' && (
                    <>
                      <Button
                        variant={webhookConfigured ? "outline" : "destructive"}
                        size="sm"
                        onClick={() => {
                          if (instancia.isWebhookIA) {
                            if (!window.confirm("⚠️ Esta instância está com IA ativada. Reconfigurar o webhook vai desativar a IA e usar o webhook normal. Deseja continuar?")) {
                              return;
                            }
                          }
                          configurarWebhookAposConexao(instancia.nome_instancia).then(() => fetchInstancias());
                        }}
                        disabled={!webhookConfigured || reconfiguringWebhook === instancia.instancia_id}
                        className={instancia.isWebhookIA 
                          ? "w-full border-purple-500 text-purple-600 hover:bg-purple-50" 
                          : webhookConfigured ? "w-full border-green-500 text-green-600 hover:bg-green-50" : "w-full"}
                      >
                        {reconfiguringWebhook === instancia.instancia_id ? (
                          <>
                            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                            Configurando...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            {instancia.isWebhookIA 
                              ? "Reconfigurar Webhook (desativa IA)" 
                              : webhookConfigured ? "Reconfigurar Webhook" : "Configure webhook nas Configurações"}
                          </>
                        )}
                      </Button>
                      {webhookBase64Status[instancia.instancia_id] !== undefined && (
                        <div className="flex items-center justify-center gap-2 text-xs">
                          <span className="text-muted-foreground">Base64:</span>
                          {webhookBase64Status[instancia.instancia_id] === true ? (
                            <Badge variant="default" className="bg-green-500 hover:bg-green-600">
                              ATIVO ✓
                            </Badge>
                          ) : webhookBase64Status[instancia.instancia_id] === false ? (
                            <Badge variant="destructive">
                              INATIVO
                            </Badge>
                          ) : (
                            <Badge variant="secondary">
                              ERRO
                            </Badge>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  
                  <p className="text-xs text-muted-foreground text-center">
                    {instancia.ativo
                      ? "Clique em Desconectar para encerrar a sessão do WhatsApp."
                      : "Clique em Conectar para gerar o QR Code e iniciar a sessão."}
                  </p>
                </div>
              </CardContent>
            </Card>
          )})}
        </div>
      )}
        </TabsContent>

        <TabsContent value="ia" className="mt-6">
          <ConfigIASection />
        </TabsContent>

        <TabsContent value="apps" className="mt-6">
          <ConfigAppsSection />
        </TabsContent>
      </Tabs>

      {/* Modal Adicionar Instância */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Instância WhatsApp</DialogTitle>
            <DialogDescription>
              Adicione uma nova instância para conectar ao Evolution API
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="nome">Nome da Instância *</Label>
              <Input
                id="nome"
                placeholder="Ex: Pacientes, Empresas"
                value={novaInstancia.nome_instancia}
                onChange={(e) =>
                  setNovaInstancia({ ...novaInstancia, nome_instancia: e.target.value })
                }
              />
              <p className="text-xs text-muted-foreground">
                O ID técnico será gerado automaticamente pela Evolution API
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cor">Cor de Identificação</Label>
              <div className="grid grid-cols-4 gap-2">
                {CORES_DISPONIVEIS.map((cor) => (
                  <Button
                    key={cor}
                    variant="outline"
                    className="h-12 w-full p-0 border-2"
                    style={{
                      backgroundColor: novaInstancia.cor_identificacao === cor ? cor : `${cor}30`,
                      borderColor: cor
                    }}
                    onClick={() =>
                      setNovaInstancia({ ...novaInstancia, cor_identificacao: cor })
                    }
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddModal(false)}>
              Cancelar
            </Button>
            <Button onClick={adicionarInstancia}>Adicionar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Editar Instância */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Instância WhatsApp</DialogTitle>
            <DialogDescription>
              Atualize as informações da instância
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-nome">Nome da Instância *</Label>
              <Input
                id="edit-nome"
                placeholder="Ex: Pacientes, Empresas"
                value={instanciaParaEditar?.nome_instancia || ""}
                onChange={(e) =>
                  setInstanciaParaEditar(
                    instanciaParaEditar
                      ? { ...instanciaParaEditar, nome_instancia: e.target.value }
                      : null
                  )
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-instancia_id">ID da Instância (Somente leitura)</Label>
              <Input
                id="edit-instancia_id"
                value={instanciaParaEditar?.instancia_id || ""}
                disabled
                className="bg-muted"
              />
              <p className="text-xs text-muted-foreground">
                Este ID é gerado pela Evolution API e não pode ser alterado
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-numero">Número do Chip</Label>
              <Input
                id="edit-numero"
                placeholder="Ex: +55 11 98888-8888"
                value={instanciaParaEditar?.numero_chip || ""}
                onChange={(e) =>
                  setInstanciaParaEditar(
                    instanciaParaEditar
                      ? { ...instanciaParaEditar, numero_chip: e.target.value }
                      : null
                  )
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-cor">Cor de Identificação</Label>
              <div className="grid grid-cols-4 gap-2">
                {CORES_DISPONIVEIS.map((cor) => (
                  <Button
                    key={cor}
                    variant="outline"
                    className="h-12 w-full p-0 border-2"
                    style={{
                      backgroundColor: instanciaParaEditar?.cor_identificacao === cor ? cor : `${cor}30`,
                      borderColor: cor
                    }}
                    onClick={() =>
                      setInstanciaParaEditar(
                        instanciaParaEditar
                          ? { ...instanciaParaEditar, cor_identificacao: cor }
                          : null
                      )
                    }
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="flex justify-between items-center sm:justify-between">
            <Button 
              variant="destructive" 
              onClick={() => {
                setShowEditModal(false);
                if (instanciaParaEditar) {
                  abrirDialogDeletar(instanciaParaEditar);
                }
              }}
              className="mr-auto"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Deletar
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowEditModal(false)}>
                Cancelar
              </Button>
              <Button onClick={editarInstancia}>Salvar</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Confirmar Deleção */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja deletar a instância{" "}
              <strong>{instanciaParaDeletar?.nome_instancia}</strong>? Esta ação não pode ser
              desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={deletarInstancia}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Deletar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal QR Code */}
      <QRCodeModal 
        open={showQrModal}
        onOpenChange={(open) => {
          if (!open) {
            fecharQrModal();
          } else {
            setShowQrModal(open);
          }
        }}
        qrCodeBase64={currentQrBase64}
        instanceName={lastConnectingInstance?.nome_instancia || "Instância"}
        status={qrStatus}
        statusMessage={qrStatusMessage}
        onRetry={() => {
          if (lastConnectingInstance) {
            setShowQrModal(false);
            setCurrentQrBase64(null);
            setQrStatus("loading");
            setQrStatusMessage("");
            setTimeout(() => {
              conectarInstancia(lastConnectingInstance);
            }, 500);
          } else {
            toast.error("Não foi possível encontrar a instância. Feche o modal e tente novamente.");
          }
        }}
      />

      {/* Modal Configurações Gerais */}
      <Dialog open={showConfigModal} onOpenChange={setShowConfigModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Configurações Gerais</DialogTitle>
            <DialogDescription>
              Configure parâmetros globais do sistema
            </DialogDescription>
          </DialogHeader>
          <ConfigGeralSection />
        </DialogContent>
      </Dialog>
    </div>
  );
}
