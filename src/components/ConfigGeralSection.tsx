import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";

export function ConfigGeralSection() {
  const [evolutionBaseUrl, setEvolutionBaseUrl] = useState("");
  const [evolutionApiKey, setEvolutionApiKey] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookBase64Enabled, setWebhookBase64Enabled] = useState(false);
  const [ignorarMensagensInternas, setIgnorarMensagensInternas] = useState(true);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const { data, error } = await supabase
        .from("config_global")
        .select("evolution_base_url, evolution_api_key, webhook_url, webhook_base64_enabled, ignorar_mensagens_internas")
        .single();

      if (error) throw error;

      if (data) {
        setEvolutionBaseUrl(data.evolution_base_url);
        setEvolutionApiKey(data.evolution_api_key || "");
        setWebhookUrl(data.webhook_url || "");
        setWebhookBase64Enabled(data.webhook_base64_enabled || false);
        setIgnorarMensagensInternas(data.ignorar_mensagens_internas ?? true);
      }
    } catch (error) {
      console.error("Erro ao buscar configuração:", error);
      toast.error("Erro ao carregar configurações");
    } finally {
      setFetching(false);
    }
  };

  const handleSave = async () => {
    if (!evolutionBaseUrl.trim()) {
      toast.error("URL base não pode estar vazia");
      return;
    }

    if (!evolutionApiKey.trim()) {
      toast.error("API Key não pode estar vazia");
      return;
    }

    if (!webhookUrl.trim()) {
      toast.error("URL do Webhook não pode estar vazia");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from("config_global")
        .update({ 
          evolution_base_url: evolutionBaseUrl,
          evolution_api_key: evolutionApiKey,
          webhook_url: webhookUrl,
          webhook_base64_enabled: webhookBase64Enabled,
          ignorar_mensagens_internas: ignorarMensagensInternas,
        })
        .eq("id", (await supabase.from("config_global").select("id").single()).data?.id);

      if (error) throw error;

      toast.success("Configuração atualizada com sucesso!");
    } catch (error) {
      console.error("Erro ao salvar configuração:", error);
      toast.error("Erro ao salvar configuração");
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Configurações Gerais</CardTitle>
          <CardDescription>Configurações globais do sistema</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configurações Gerais</CardTitle>
        <CardDescription>
          Configure a URL base da Evolution API e outras configurações globais
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="evolution-url">URL Base da Evolution API</Label>
          <Input
            id="evolution-url"
            placeholder="https://sua-api.ngrok-free.dev"
            value={evolutionBaseUrl}
            onChange={(e) => setEvolutionBaseUrl(e.target.value)}
          />
          <p className="text-sm text-muted-foreground">
            Esta URL será usada em todas as chamadas para a Evolution API
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="evolution-apikey">API Key da Evolution</Label>
          <Input
            id="evolution-apikey"
            type="password"
            placeholder="Cole sua API Key aqui"
            value={evolutionApiKey}
            onChange={(e) => setEvolutionApiKey(e.target.value)}
          />
          <p className="text-sm text-muted-foreground">
            A API Key será armazenada de forma segura e usada para autenticação
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="webhook-url">URL do Webhook</Label>
          <Input
            id="webhook-url"
            placeholder="https://seu-webhook.com/endpoint"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
          />
          <p className="text-sm text-muted-foreground">
            Esta URL será configurada nas instâncias para receber eventos do WhatsApp
          </p>
        </div>

        <div className="flex items-center justify-between space-x-2 p-4 border rounded-lg">
          <div className="space-y-0.5">
            <Label htmlFor="webhook-base64">Webhook Base64</Label>
            <p className="text-sm text-muted-foreground">
              Send media base64 data in webhook
            </p>
          </div>
          <Switch
            id="webhook-base64"
            checked={webhookBase64Enabled}
            onCheckedChange={setWebhookBase64Enabled}
          />
        </div>

        <div className="flex items-center justify-between space-x-2 p-4 border rounded-lg">
          <div className="space-y-0.5">
            <Label htmlFor="ignorar-internas">Ignorar Mensagens Internas</Label>
            <p className="text-sm text-muted-foreground">
              Mensagens entre instâncias internas só aparecem no histórico, sem criar conversas Maikonect
            </p>
          </div>
          <Switch
            id="ignorar-internas"
            checked={ignorarMensagensInternas}
            onCheckedChange={setIgnorarMensagensInternas}
          />
        </div>

        <Button onClick={handleSave} disabled={loading} className="w-full">
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Salvando...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Salvar Configurações
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
