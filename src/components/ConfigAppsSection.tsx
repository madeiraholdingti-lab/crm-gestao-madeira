import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Save, Calendar, Zap, Archive, Star, Bell, Globe, Loader2, Send, CheckCircle, XCircle, BrainCircuit } from "lucide-react";
import { useOverlayApps } from "@/contexts/OverlayAppsContext";
import { supabase } from "@/integrations/supabase/client";
import googleCalendarIcon from "@/assets/google-calendar-icon.png";

const APP_ICONS: Record<string, React.ReactNode> = {
  calendar: <img src={googleCalendarIcon} alt="Google Agenda" className="w-5 h-5 object-contain" />,
  crm: <Zap className="w-5 h-5 text-blue-600" />,
  archive: <Archive className="w-5 h-5 text-emerald-600" />,
  priority: <Star className="w-5 h-5 text-purple-600" />,
  notify: <Bell className="w-5 h-5 text-red-600" />,
};

// URLs dos endpoints de callback
const CALLBACK_URLS = {
  verify: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/calendar-verify-callback`,
  confirmed: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/calendar-confirmed-callback`,
};

export function ConfigAppsSection() {
  const { 
    apps, 
    mainWebhookUrl, 
    setMainWebhookUrl, 
    updateApp, 
    updateAppPayloads 
  } = useOverlayApps();

  const [localWebhookUrl, setLocalWebhookUrl] = useState(mainWebhookUrl);
  const [expandedApp, setExpandedApp] = useState<string>("calendar");
  const [loading, setLoading] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);

  // Estado para o webhook de IA/Disparos
  const [webhookIaDisparos, setWebhookIaDisparos] = useState("");
  const [savingIaWebhook, setSavingIaWebhook] = useState(false);
  const [testingIaWebhook, setTestingIaWebhook] = useState(false);
  const [iaWebhookStatus, setIaWebhookStatus] = useState<"idle" | "success" | "error">("idle");

  // Estado para o webhook de IA Respondendo
  const [webhookIaRespondendo, setWebhookIaRespondendo] = useState("");
  const [savingIaRespondendo, setSavingIaRespondendo] = useState(false);

  // Carregar URL do webhook do banco de dados ao montar
  useEffect(() => {
    const loadWebhookUrl = async () => {
      try {
        const { data, error } = await supabase
          .from('config_global')
        .select('webhook_url, webhook_ia_disparos, webhook_ia_respondendo')
          .limit(1)
          .single();
        
        if (!error && data) {
          if (data.webhook_url) {
            setLocalWebhookUrl(data.webhook_url);
            setMainWebhookUrl(data.webhook_url);
          }
          if ((data as any).webhook_ia_disparos) {
            setWebhookIaDisparos((data as any).webhook_ia_disparos);
          }
          if ((data as any).webhook_ia_respondendo) {
            setWebhookIaRespondendo((data as any).webhook_ia_respondendo);
          }
        }
      } catch (err) {
        console.error('Erro ao carregar webhook URL:', err);
      } finally {
        setLoadingInitial(false);
      }
    };
    loadWebhookUrl();
  }, [setMainWebhookUrl]);

  const handleSaveWebhook = async () => {
    setLoading(true);
    try {
      // Salvar no banco de dados (config_global)
      const { error } = await supabase
        .from('config_global')
        .update({ webhook_url: localWebhookUrl })
        .eq('id', (await supabase.from('config_global').select('id').limit(1).single()).data?.id);

      if (error) throw error;

      // Atualizar contexto local
      setMainWebhookUrl(localWebhookUrl);
      toast.success("Webhook URL salva com sucesso!");
    } catch (err) {
      console.error('Erro ao salvar webhook URL:', err);
      toast.error("Erro ao salvar Webhook URL");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveIaWebhook = async () => {
    setSavingIaWebhook(true);
    try {
      const { error } = await supabase
        .from('config_global')
        .update({ webhook_ia_disparos: webhookIaDisparos } as any)
        .eq('id', (await supabase.from('config_global').select('id').limit(1).single()).data?.id);

      if (error) throw error;

      toast.success("Webhook de IA/Disparos salvo com sucesso!");
    } catch (err) {
      console.error('Erro ao salvar webhook IA:', err);
      toast.error("Erro ao salvar Webhook de IA/Disparos");
    } finally {
      setSavingIaWebhook(false);
    }
  };

  const handleSaveIaRespondendo = async () => {
    setSavingIaRespondendo(true);
    try {
      const { error } = await supabase
        .from('config_global')
        .update({ webhook_ia_respondendo: webhookIaRespondendo } as any)
        .eq('id', (await supabase.from('config_global').select('id').limit(1).single()).data?.id);

      if (error) throw error;

      toast.success("Webhook de IA Respondendo salvo com sucesso!");
    } catch (err) {
      console.error('Erro ao salvar webhook IA respondendo:', err);
      toast.error("Erro ao salvar Webhook de IA Respondendo");
    } finally {
      setSavingIaRespondendo(false);
    }
  };

  const handleTestIaWebhook = async () => {
    if (!webhookIaDisparos.trim()) {
      toast.error("Insira a URL do webhook primeiro");
      return;
    }

    setTestingIaWebhook(true);
    setIaWebhookStatus("idle");

    try {
      const response = await fetch(webhookIaDisparos, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          test: true,
          tipo: "teste_conexao",
          leads: [
            { id: "test-1", nome: "Teste Lead", telefone: "5511999999999" }
          ],
          mensagem_base: "Mensagem de teste",
          timestamp: new Date().toISOString(),
        }),
      });

      if (response.ok) {
        setIaWebhookStatus("success");
        toast.success("Webhook respondeu com sucesso!");
      } else {
        setIaWebhookStatus("error");
        toast.error(`Webhook retornou erro: ${response.status}`);
      }
    } catch (error) {
      console.error("Erro ao testar webhook:", error);
      setIaWebhookStatus("error");
      toast.error("Erro ao conectar com o webhook");
    } finally {
      setTestingIaWebhook(false);
    }
  };

  const handleToggleApp = (appId: string, enabled: boolean) => {
    updateApp(appId, { enabled });
    toast.success(`App ${enabled ? "ativado" : "desativado"} com sucesso!`);
  };

  const handleSavePayloads = (appId: string) => {
    toast.success("Configurações do app salvas com sucesso!");
  };

  return (
    <div className="space-y-6">
      {/* Webhook IA/Disparos - Seção separada */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="w-5 h-5" />
            Webhook de IA para Disparos
          </CardTitle>
          <CardDescription>
            Configure o webhook que receberá a lista de leads para gerar variações de mensagem e enviar os disparos
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="webhook-ia-disparos">URL do Webhook</Label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Input
                  id="webhook-ia-disparos"
                  placeholder="https://seu-n8n.com/webhook/ia-disparos"
                  value={webhookIaDisparos}
                  onChange={(e) => {
                    setWebhookIaDisparos(e.target.value);
                    setIaWebhookStatus("idle");
                  }}
                  disabled={loadingInitial}
                  className={iaWebhookStatus === "success" ? "border-green-500 pr-10" : iaWebhookStatus === "error" ? "border-destructive pr-10" : ""}
                />
                {iaWebhookStatus === "success" && (
                  <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />
                )}
                {iaWebhookStatus === "error" && (
                  <XCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-destructive" />
                )}
              </div>
              <Button
                variant="outline"
                onClick={handleTestIaWebhook}
                disabled={testingIaWebhook || !webhookIaDisparos.trim() || loadingInitial}
              >
                {testingIaWebhook ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Zap className="h-4 w-4 mr-1" />
                    Testar
                  </>
                )}
              </Button>
              <Button onClick={handleSaveIaWebhook} disabled={savingIaWebhook || loadingInitial}>
                {savingIaWebhook ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Este endpoint receberá os leads selecionados e a mensagem base para processar variações e envios
            </p>
          </div>

          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-xs font-medium mb-2">Payload enviado:</p>
            <pre className="text-xs text-muted-foreground overflow-x-auto">
{`{
  "leads": [{ id, nome, telefone, email, ... }],
  "mensagem_base": "Sua mensagem",
  "campanha_id": "uuid",
  "instancia_id": "uuid"
}`}
            </pre>
          </div>
        </CardContent>
      </Card>

      {/* Webhook IA Respondendo */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit className="w-5 h-5" />
            Webhook de IA Respondendo
          </CardTitle>
          <CardDescription>
            Configure o webhook que será usado pelas instâncias com IA respondendo automaticamente
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="webhook-ia-respondendo">URL do Webhook</Label>
            <div className="flex gap-2">
              <Input
                id="webhook-ia-respondendo"
                placeholder="https://seu-n8n.com/webhook/ia-respondendo"
                value={webhookIaRespondendo}
                onChange={(e) => setWebhookIaRespondendo(e.target.value)}
                disabled={loadingInitial}
                className="flex-1"
              />
              <Button onClick={handleSaveIaRespondendo} disabled={savingIaRespondendo || loadingInitial}>
                {savingIaRespondendo ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Este endpoint será configurado nas instâncias com IA para receber e responder mensagens automaticamente
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Webhook URL Principal */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5" />
            Webhook Principal
          </CardTitle>
          <CardDescription>
            URL base para onde todos os apps enviarão seus dados por padrão
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="main-webhook">Webhook URL (Main)</Label>
            <div className="flex gap-2">
              <Input
                id="main-webhook"
                placeholder="https://seu-n8n.com/webhook/apps"
                value={localWebhookUrl}
                onChange={(e) => setLocalWebhookUrl(e.target.value)}
                className="flex-1"
                disabled={loadingInitial}
              />
              <Button onClick={handleSaveWebhook} size="sm" disabled={loading || loadingInitial}>
                {loading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                Salvar
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Este endpoint receberá os payloads de todos os apps do overlay
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Lista de Apps */}
      <Card>
        <CardHeader>
          <CardTitle>Apps do Overlay</CardTitle>
          <CardDescription>
            Gerencie os aplicativos disponíveis no círculo de ações do drag-and-drop
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion 
            type="single" 
            collapsible 
            value={expandedApp}
            onValueChange={setExpandedApp}
            className="space-y-2"
          >
            {apps.map((app) => (
              <AccordionItem 
                key={app.id} 
                value={app.id}
                className="border rounded-lg px-4"
              >
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center justify-between w-full pr-4">
                    <div className="flex items-center gap-3">
                      {APP_ICONS[app.id]}
                      <span className="font-medium">{app.name}</span>
                      {app.enabled ? (
                        <Badge variant="default" className="bg-emerald-500">Ativo</Badge>
                      ) : (
                        <Badge variant="secondary">Inativo</Badge>
                      )}
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={app.enabled}
                        onCheckedChange={(checked) => handleToggleApp(app.id, checked)}
                      />
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-4 pb-6">
                  {!app.enabled ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p>Ative o app para configurar os payloads</p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {/* Subtipo: Verify */}
                      <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                        <div>
                          <h4 className="font-medium text-sm flex items-center gap-2">
                            <Badge variant="outline">Verify</Badge>
                            Payload de Validação
                          </h4>
                          <p className="text-xs text-muted-foreground mt-1">
                            Enviado ao arrastar o card para o app. Usado para verificar disponibilidade.
                          </p>
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor={`${app.id}-verify-payload`}>Template JSON</Label>
                          <Textarea
                            id={`${app.id}-verify-payload`}
                            value={app.payloads.verifyPayload}
                            onChange={(e) => updateAppPayloads(app.id, { verifyPayload: e.target.value })}
                            className="font-mono text-xs min-h-[150px]"
                            placeholder="{ }"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${app.id}-verify-callback`}>
                            Endpoint de Retorno para n8n
                          </Label>
                          <div className="flex gap-2">
                            <Input
                              id={`${app.id}-verify-callback`}
                              value={app.id === 'calendar' ? CALLBACK_URLS.verify : app.payloads.verifyCallbackUrl}
                              onChange={(e) => updateAppPayloads(app.id, { verifyCallbackUrl: e.target.value })}
                              readOnly={app.id === 'calendar'}
                              className={app.id === 'calendar' ? 'bg-muted cursor-text' : ''}
                            />
                            {app.id === 'calendar' && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  navigator.clipboard.writeText(CALLBACK_URLS.verify);
                                  toast.success('URL copiada!');
                                }}
                              >
                                Copiar
                              </Button>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            URL que o n8n deve chamar de volta com o resultado da verificação
                          </p>
                        </div>
                      </div>

                      {/* Subtipo: Confirmed */}
                      <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                        <div>
                          <h4 className="font-medium text-sm flex items-center gap-2">
                            <Badge variant="outline">Confirmed</Badge>
                            Payload de Confirmação
                          </h4>
                          <p className="text-xs text-muted-foreground mt-1">
                            Enviado após o usuário confirmar a ação no modal.
                          </p>
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor={`${app.id}-confirmed-payload`}>Template JSON</Label>
                          <Textarea
                            id={`${app.id}-confirmed-payload`}
                            value={app.payloads.confirmedPayload}
                            onChange={(e) => updateAppPayloads(app.id, { confirmedPayload: e.target.value })}
                            className="font-mono text-xs min-h-[150px]"
                            placeholder="{ }"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${app.id}-confirmed-callback`}>
                            Endpoint de Retorno para n8n
                          </Label>
                          <div className="flex gap-2">
                            <Input
                              id={`${app.id}-confirmed-callback`}
                              value={app.id === 'calendar' ? CALLBACK_URLS.confirmed : app.payloads.confirmedCallbackUrl}
                              onChange={(e) => updateAppPayloads(app.id, { confirmedCallbackUrl: e.target.value })}
                              readOnly={app.id === 'calendar'}
                              className={app.id === 'calendar' ? 'bg-muted cursor-text' : ''}
                            />
                            {app.id === 'calendar' && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  navigator.clipboard.writeText(CALLBACK_URLS.confirmed);
                                  toast.success('URL copiada!');
                                }}
                              >
                                Copiar
                              </Button>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            URL de callback final após confirmação
                          </p>
                        </div>
                      </div>

                      <Button 
                        onClick={() => handleSavePayloads(app.id)} 
                        className="w-full"
                      >
                        <Save className="w-4 h-4 mr-2" />
                        Salvar Configurações do {app.name}
                      </Button>
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
