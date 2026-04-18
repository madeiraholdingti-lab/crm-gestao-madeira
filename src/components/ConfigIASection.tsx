import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Wifi, WifiOff, RefreshCw, Phone, Plus, QrCode, Trash2, PhoneOff, Settings, Save, Loader2, BrainCircuit } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { QRCodeModal, QRCodeStatus } from "@/components/QRCodeModal";

const CORES_DISPONIVEIS = [
  "#2563EB", "#DC2626", "#059669", "#7C3AED",
  "#EA580C", "#0891B2", "#BE185D", "#4338CA",
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

interface InstanciaIA extends InstanciaWhatsApp {
  statusReal?: string;
  numeroConectado?: string;
  webhookAtual?: string | null;
  isWebhookIA?: boolean;
}

export function ConfigIASection() {
  const [instancias, setInstancias] = useState<InstanciaIA[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [connectingInstance, setConnectingInstance] = useState<string | null>(null);
  const [lastConnectingInstance, setLastConnectingInstance] = useState<InstanciaIA | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [currentQrBase64, setCurrentQrBase64] = useState<string | null>(null);
  const [instanciaParaDeletar, setInstanciaParaDeletar] = useState<InstanciaIA | null>(null);
  const [instanciaParaEditar, setInstanciaParaEditar] = useState<InstanciaIA | null>(null);
  const [qrStatus, setQrStatus] = useState<QRCodeStatus>("loading");
  const [qrStatusMessage, setQrStatusMessage] = useState<string>("");
  const pollingRef = useRef<number | null>(null);

  // Webhook IA
  const [webhookIaRespondendo, setWebhookIaRespondendo] = useState("");
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [loadingWebhook, setLoadingWebhook] = useState(true);

  const [novaInstancia, setNovaInstancia] = useState({
    nome_instancia: "",
    cor_identificacao: "#7C3AED",
  });

  useEffect(() => {
    fetchInstancias();
    loadWebhook();
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const loadWebhook = async () => {
    try {
      const { data, error } = await supabase
        .from("config_global")
        .select("webhook_ia_respondendo")
        .single();
      if (!error && data) {
        setWebhookIaRespondendo((data as any).webhook_ia_respondendo || "");
      }
    } catch (err) {
      console.error("Erro ao carregar webhook IA:", err);
    } finally {
      setLoadingWebhook(false);
    }
  };

  const handleSaveWebhook = async () => {
    setSavingWebhook(true);
    try {
      const { data: configData } = await supabase.from("config_global").select("id").limit(1).single();
      const { error } = await supabase
        .from("config_global")
        .update({ webhook_ia_respondendo: webhookIaRespondendo } as any)
        .eq("id", configData?.id);
      if (error) throw error;
      toast.success("Webhook de IA Respondendo salvo com sucesso!");
    } catch (err) {
      console.error("Erro ao salvar webhook IA:", err);
      toast.error("Erro ao salvar webhook");
    } finally {
      setSavingWebhook(false);
    }
  };

  const fetchInstancias = async (showToast = false) => {
    try {
      if (showToast) toast.info("Sincronizando conexões IA...");

      // Fetch config for IA webhook URL and normal webhook URL
      const { data: configData } = await supabase
        .from("config_global")
        .select("webhook_ia_respondendo, webhook_url")
        .single();
      const iaWebhookUrl = (configData as any)?.webhook_ia_respondendo || "";
      const normalWebhookUrl = configData?.webhook_url || "";

      const { data: evolutionData, error: evolutionError } = await supabase.functions.invoke("listar-instancias-evolution");
      if (evolutionError) console.error("Erro ao buscar instâncias:", evolutionError);

      const { data: localData, error: localError } = await supabase
        .from("instancias_whatsapp")
        .select("*")
        .neq("status", "deletada")
        .order("created_at", { ascending: false });

      if (localError) throw localError;

      const instanciasEvolution = evolutionData?.instances || [];
      const instanciasLocal = localData || [];

      const instanciasMescladas: InstanciaIA[] = instanciasEvolution.map((evol: any) => {
        const instanceName = evol.name || evol.instance?.instanceName || evol.instanceName;
        const local = instanciasLocal.find(l => l.instancia_id === instanceName || l.nome_instancia === instanceName);
        const numeroConectado = evol.ownerJid ? evol.ownerJid.split("@")[0] : "";

        return {
          id: local?.id || instanceName,
          nome_instancia: local?.nome_instancia || instanceName,
          instancia_id: instanceName,
          token_zapi: local?.token_zapi || "",
          token_instancia: local?.token_instancia,
          tipo_canal: local?.tipo_canal,
          numero_chip: local?.numero_chip,
          ativo: evol.connectionStatus === "open",
          created_at: local?.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
          cor_identificacao: local?.cor_identificacao || "#7C3AED",
          statusReal: evol.connectionStatus,
          numeroConectado,
        };
      });

      // Fetch real webhook URLs for each instance
      const instanceNames = instanciasMescladas.map(i => i.nome_instancia);
      if (instanceNames.length > 0) {
        try {
          const { data: webhookData } = await supabase.functions.invoke("buscar-webhooks-instancias", {
            body: { instanceNames },
          });
          if (webhookData?.success && webhookData?.webhooks) {
            instanciasMescladas.forEach(inst => {
              const wh = webhookData.webhooks[inst.nome_instancia];
              inst.webhookAtual = wh?.url || null;
              inst.isWebhookIA = !!(iaWebhookUrl && wh?.url && wh.url === iaWebhookUrl);
            });
          }
        } catch (whErr) {
          console.error("Erro ao buscar webhooks:", whErr);
        }
      }

      setInstancias(instanciasMescladas);
      if (showToast) toast.success("Conexões IA sincronizadas!");
    } catch (error) {
      console.error("Erro ao carregar instâncias:", error);
      toast.error("Erro ao carregar instâncias");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  const adicionarInstancia = async () => {
    if (!novaInstancia.nome_instancia) {
      toast.error("Preencha o nome da instância");
      return;
    }

    try {
      toast.info("Criando instância IA na Evolution API...");

      const { data: evolutionData, error: evolutionError } = await supabase.functions.invoke("criar-instancia-evolution", {
        body: {
          instanceName: novaInstancia.nome_instancia,
          integration: "WHATSAPP-BAILEYS",
        },
      });

      if (evolutionError) throw evolutionError;
      if (!evolutionData?.success) {
        toast.error(evolutionData?.error || "Erro ao criar instância");
        return;
      }

      const instanceUuid = evolutionData?.instance?.instanceId;
      if (!instanceUuid) {
        toast.error("Evolution API não retornou o ID da instância");
        return;
      }

      const qrCodeBase64 = evolutionData?.qrCode?.base64;

      const { error } = await supabase.from("instancias_whatsapp").insert({
        nome_instancia: novaInstancia.nome_instancia,
        instancia_id: instanceUuid,
        token_zapi: "",
        tipo_canal: "whatsapp",
        ativo: false,
        cor_identificacao: novaInstancia.cor_identificacao,
      });

      if (error) throw error;

      toast.success("Instância IA criada com sucesso!");
      setShowAddModal(false);

      if (qrCodeBase64) {
        setCurrentQrBase64(qrCodeBase64);
        setQrStatus("waiting");
        setQrStatusMessage("QR Code gerado! Escaneie com seu WhatsApp para conectar.");
        setShowQrModal(true);
        iniciarPolling(instanceUuid);
      }

      setNovaInstancia({ nome_instancia: "", cor_identificacao: "#7C3AED" });
      fetchInstancias();
    } catch (error) {
      console.error("Erro ao adicionar instância:", error);
      toast.error("Erro ao adicionar instância");
    }
  };

  const conectarInstancia = async (instancia: InstanciaIA) => {
    setConnectingInstance(instancia.id);
    setLastConnectingInstance(instancia);

    try {
      const isDisconnected = !instancia.ativo || instancia.statusReal === "close" || instancia.statusReal === "closed";
      let data: any, error: any;

      if (isDisconnected) {
        toast.info("Reiniciando instância para gerar novo QR Code...");
        const restartResult = await supabase.functions.invoke("reiniciar-instancia-evolution", {
          body: { instanceName: instancia.nome_instancia },
        });
        data = restartResult.data;
        error = restartResult.error;

        if (data?.success && !data?.base64) {
          const connectResult = await supabase.functions.invoke("conectar-evolution", {
            body: { instanceId: instancia.nome_instancia },
          });
          if (connectResult.data?.base64) data.base64 = connectResult.data.base64;
        }
      } else {
        const connectResult = await supabase.functions.invoke("conectar-evolution", {
          body: { instanceId: instancia.instancia_id },
        });
        data = connectResult.data;
        error = connectResult.error;
      }

      if (error) throw error;

      if (data?.success && data?.base64) {
        setCurrentQrBase64(data.base64);
        setQrStatus("waiting");
        setQrStatusMessage("QR Code gerado! Escaneie com seu WhatsApp para conectar.");
        setShowQrModal(true);
        iniciarPolling(instancia.instancia_id);
      } else if (data?.success) {
        setQrStatus("error");
        setQrStatusMessage("Instância reiniciada, mas QR Code não foi gerado. Tente novamente.");
        setShowQrModal(true);
      } else {
        setQrStatus("error");
        setQrStatusMessage(data?.error || "Falha ao gerar QR Code.");
        setShowQrModal(true);
      }
    } catch (error) {
      console.error("Erro ao conectar:", error);
      setQrStatus("error");
      setQrStatusMessage("Erro ao conectar instância.");
      setShowQrModal(true);
    } finally {
      setConnectingInstance(null);
    }
  };

  const desconectarInstancia = async (instanceName: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("desconectar-evolution", {
        body: { instanceName },
      });
      if (error) throw error;
      if (data?.success) {
        toast.success(`Instância "${instanceName}" desconectada.`);
        await fetchInstancias();
      } else {
        throw new Error(data?.error || "Erro desconhecido");
      }
    } catch (error) {
      console.error("Erro ao desconectar:", error);
      toast.error("Não foi possível desconectar a instância.");
    }
  };

  const configurarWebhookIA = async (instanceId: string) => {
    if (!webhookIaRespondendo) {
      toast.error("Configure o webhook de IA Respondendo primeiro!");
      return;
    }

    try {
      toast.info("Configurando webhook de IA...");
      // Use the same function but the webhook URL will be different
      const { data, error } = await supabase.functions.invoke("configurar-webhook-evolution", {
        body: { instanceId, webhookUrlOverride: webhookIaRespondendo },
      });
      if (error) throw error;
      if (data?.success) {
        toast.success("Webhook de IA configurado com sucesso!");
      } else {
        throw new Error(data?.error || "Erro ao configurar webhook");
      }
    } catch (error) {
      console.error("Erro ao configurar webhook IA:", error);
      toast.error("Erro ao configurar webhook de IA.");
    }
  };

  const iniciarPolling = (instanceName: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);

    setQrStatus("waiting");
    setQrStatusMessage("Aguardando conexão do WhatsApp...");

    let attempts = 0;
    const maxAttempts = 120;

    pollingRef.current = window.setInterval(async () => {
      attempts++;
      try {
        const { data: instancesData, error } = await supabase.functions.invoke("listar-instancias-evolution");
        if (error) throw error;

        const instances = instancesData?.instances || [];
        const current = instances.find((inst: any) => inst.id === instanceName || inst.name === instanceName);

        const isConnected = current?.connectionStatus === "open";
        const hasValidNumber = current?.ownerJid?.includes("@");

        if (isConnected && hasValidNumber) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          setQrStatus("success");
          setQrStatusMessage("WhatsApp conectado! Configurando webhook de IA...");

          await configurarWebhookIA(instanceName);

          setTimeout(() => {
            setShowQrModal(false);
            setCurrentQrBase64(null);
            setQrStatus("loading");
            setQrStatusMessage("");
            fetchInstancias();
            toast.success("Instância IA conectada e configurada!");
          }, 2000);
        }

        if (attempts >= maxAttempts) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          setQrStatus("timeout");
          setQrStatusMessage("Tempo limite atingido! Clique em 'Tentar Novamente'.");
        }
      } catch (error) {
        console.error("Erro no polling:", error);
        if (attempts > 5) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          setQrStatus("error");
          setQrStatusMessage("Erro ao verificar status da conexão.");
        }
      }
    }, 1000);
  };

  const fecharQrModal = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setShowQrModal(false);
    setCurrentQrBase64(null);
  };

  const abrirEditarModal = (instancia: InstanciaIA) => {
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
      const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(instanciaParaEditar.id);
      if (isValidUUID) {
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
        const { error } = await supabase
          .from("instancias_whatsapp")
          .upsert({
            instancia_id: instanciaParaEditar.instancia_id,
            nome_instancia: instanciaParaEditar.nome_instancia,
            cor_identificacao: instanciaParaEditar.cor_identificacao,
            numero_chip: instanciaParaEditar.numero_chip,
            token_zapi: instanciaParaEditar.token_zapi,
            updated_at: new Date().toISOString(),
          }, { onConflict: "instancia_id" });
        if (error) throw error;
      }
      toast.success("Instância atualizada!");
      setShowEditModal(false);
      setInstanciaParaEditar(null);
      fetchInstancias();
    } catch (error) {
      console.error("Erro ao editar:", error);
      toast.error("Erro ao editar instância");
    }
  };

  const deletarInstancia = async () => {
    if (!instanciaParaDeletar) return;
    try {
      toast.info("Removendo instância da Evolution API...");
      const { data: evolutionData, error: evolutionError } = await supabase.functions.invoke("deletar-instancia-evolution", {
        body: { instanceId: instanciaParaDeletar.instancia_id },
      });
      if (evolutionError || !evolutionData?.success) {
        toast.error(evolutionData?.error || "Erro ao remover da Evolution API");
        return;
      }

      const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(instanciaParaDeletar.id);
      if (isValidUUID) {
        await supabase.from("instancias_whatsapp").update({ status: "deletada" }).eq("id", instanciaParaDeletar.id);
      } else {
        await supabase.from("instancias_whatsapp").update({ status: "deletada" }).eq("nome_instancia", instanciaParaDeletar.nome_instancia);
      }

      toast.success("Instância removida!");
      setShowDeleteDialog(false);
      setInstanciaParaDeletar(null);
      fetchInstancias();
    } catch (error) {
      console.error("Erro ao deletar:", error);
      toast.error("Erro ao deletar instância");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header com ações */}
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={() => { setSyncing(true); fetchInstancias(true); }} disabled={syncing}>
          <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          Sincronizar
        </Button>
        <Button onClick={() => setShowAddModal(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nova Instância IA
        </Button>
      </div>

      {/* Instâncias */}
      {instancias.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Phone className="h-16 w-16 text-muted-foreground mb-4" />
            <p className="text-lg font-medium text-muted-foreground">
              Nenhuma instância IA configurada
            </p>
            <p className="text-sm text-muted-foreground">
              Clique em "Nova Instância IA" para começar
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          {instancias.map((instancia) => {
            const corFundo = instancia.cor_identificacao || "#7C3AED";
            const isIA = instancia.isWebhookIA;
            return (
              <Card
                key={instancia.id}
                className={`hover:shadow-lg transition-shadow border-2 ${isIA ? "text-white" : ""}`}
                style={{
                  backgroundColor: isIA ? "#1a1a1a" : `${corFundo}15`,
                  borderColor: isIA ? "#333" : corFundo,
                }}
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg">{instancia.nome_instancia}</CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={instancia.ativo ? "default" : "secondary"} className="flex items-center gap-1">
                        {instancia.ativo ? (
                          <><Wifi className="h-3 w-3" /> Conectado</>
                        ) : (
                          <><WifiOff className="h-3 w-3" /> Desconectado</>
                        )}
                      </Badge>
                      {instancia.ativo && instancia.isWebhookIA && (
                        <Badge className="bg-purple-600 flex items-center gap-1">
                          <BrainCircuit className="h-3 w-3" /> IA
                        </Badge>
                      )}
                      {instancia.ativo && !instancia.isWebhookIA && (
                        <Badge variant="outline" className="flex items-center gap-1 border-muted-foreground text-muted-foreground">
                          Normal
                        </Badge>
                      )}
                      <Button variant="ghost" size="icon" className={`h-8 w-8 ${isIA ? "text-white hover:text-white/80" : ""}`} onClick={() => abrirEditarModal(instancia)}>
                        <Settings className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <CardDescription className={`truncate ${isIA ? "text-gray-400" : ""}`}>{instancia.instancia_id}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between items-start gap-2">
                      <span className={isIA ? "text-gray-400" : "text-muted-foreground"}>Status:</span>
                      <span className="font-medium">{instancia.statusReal === "open" ? "Conectado" : "Desconectado"}</span>
                    </div>
                    {instancia.numeroConectado && (
                      <div className="flex justify-between items-start gap-2">
                        <span className={isIA ? "text-gray-400" : "text-muted-foreground"}>Número:</span>
                        <span className="font-medium">
                          {instancia.numeroConectado.substring(0, 4)}...{instancia.numeroConectado.substring(instancia.numeroConectado.length - 4)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-start gap-2">
                      <span className={isIA ? "text-gray-400" : "text-muted-foreground"}>Webhook:</span>
                      {instancia.isWebhookIA ? (
                        <Badge variant="outline" className="text-xs border-purple-400 text-purple-300">IA Configurado</Badge>
                      ) : instancia.webhookAtual ? (
                        <Badge variant="outline" className="text-xs">Normal</Badge>
                      ) : (
                        <Badge variant="destructive" className="text-xs">Não configurado</Badge>
                      )}
                    </div>
                    <div className="flex justify-between items-start gap-2">
                      <span className={isIA ? "text-gray-400" : "text-muted-foreground"}>Última sync:</span>
                      <span className="font-medium">{format(new Date(instancia.updated_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {instancia.ativo && instancia.statusReal === "open" ? (
                      <>
                        <Button onClick={() => desconectarInstancia(instancia.instancia_id)} variant="destructive" className="w-full">
                          <PhoneOff className="mr-2 h-4 w-4" /> Desconectar
                        </Button>
                        {instancia.isWebhookIA ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full bg-purple-100 border-purple-500 text-purple-700 hover:bg-purple-200 font-semibold"
                            disabled
                          >
                            <BrainCircuit className="h-4 w-4 mr-2" />
                            IA Ativada ✓
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full border-purple-500 text-purple-600 hover:bg-purple-50"
                            onClick={async () => {
                              await configurarWebhookIA(instancia.nome_instancia);
                              await fetchInstancias();
                            }}
                            disabled={!webhookIaRespondendo}
                          >
                            <BrainCircuit className="h-4 w-4 mr-2" />
                            {webhookIaRespondendo ? "Ativar IA" : "Configure o webhook primeiro"}
                          </Button>
                        )}
                      </>
                    ) : (
                      <Button
                        onClick={() => conectarInstancia(instancia)}
                        disabled={connectingInstance === instancia.id}
                        className="w-full"
                      >
                        {connectingInstance === instancia.id ? (
                          <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Conectando...</>
                        ) : (
                          <><QrCode className="mr-2 h-4 w-4" /> Conectar / Gerar QR Code</>
                        )}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal Adicionar Instância IA */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Instância IA</DialogTitle>
            <DialogDescription>
              Adicione uma nova instância WhatsApp para a IA responder automaticamente
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="nome-ia">Nome da Instância *</Label>
              <Input
                id="nome-ia"
                placeholder="Ex: IA-Atendimento, IA-Vendas"
                value={novaInstancia.nome_instancia}
                onChange={(e) => setNovaInstancia({ ...novaInstancia, nome_instancia: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Cor de Identificação</Label>
              <div className="grid grid-cols-4 gap-2">
                {CORES_DISPONIVEIS.map((cor) => (
                  <Button
                    key={cor}
                    variant="outline"
                    className="h-12 w-full p-0 border-2"
                    style={{
                      backgroundColor: novaInstancia.cor_identificacao === cor ? cor : `${cor}30`,
                      borderColor: cor,
                    }}
                    onClick={() => setNovaInstancia({ ...novaInstancia, cor_identificacao: cor })}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddModal(false)}>Cancelar</Button>
            <Button onClick={adicionarInstancia}>Adicionar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Editar */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Instância IA</DialogTitle>
            <DialogDescription>Atualize as informações da instância</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nome da Instância *</Label>
              <Input
                value={instanciaParaEditar?.nome_instancia || ""}
                onChange={(e) => setInstanciaParaEditar(instanciaParaEditar ? { ...instanciaParaEditar, nome_instancia: e.target.value } : null)}
              />
            </div>
            <div className="space-y-2">
              <Label>ID da Instância (Somente leitura)</Label>
              <Input value={instanciaParaEditar?.instancia_id || ""} disabled className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label>Cor de Identificação</Label>
              <div className="grid grid-cols-4 gap-2">
                {CORES_DISPONIVEIS.map((cor) => (
                  <Button
                    key={cor}
                    variant="outline"
                    className="h-12 w-full p-0 border-2"
                    style={{
                      backgroundColor: instanciaParaEditar?.cor_identificacao === cor ? cor : `${cor}30`,
                      borderColor: cor,
                    }}
                    onClick={() => setInstanciaParaEditar(instanciaParaEditar ? { ...instanciaParaEditar, cor_identificacao: cor } : null)}
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
                  setInstanciaParaDeletar(instanciaParaEditar);
                  setShowDeleteDialog(true);
                }
              }}
              className="mr-auto"
            >
              <Trash2 className="mr-2 h-4 w-4" /> Deletar
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowEditModal(false)}>Cancelar</Button>
              <Button onClick={editarInstancia}>Salvar</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar Deleção */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja deletar a instância <strong>{instanciaParaDeletar?.nome_instancia}</strong>? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={deletarInstancia} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Deletar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal QR Code */}
      <QRCodeModal
        open={showQrModal}
        onOpenChange={(open) => { if (!open) fecharQrModal(); else setShowQrModal(open); }}
        qrCodeBase64={currentQrBase64}
        instanceName={lastConnectingInstance?.nome_instancia || "Instância IA"}
        status={qrStatus}
        statusMessage={qrStatusMessage}
        onRetry={() => {
          if (lastConnectingInstance) {
            setShowQrModal(false);
            setCurrentQrBase64(null);
            setQrStatus("loading");
            setQrStatusMessage("");
            setTimeout(() => conectarInstancia(lastConnectingInstance), 500);
          } else {
            toast.error("Não foi possível encontrar a instância.");
          }
        }}
      />
    </div>
  );
}
