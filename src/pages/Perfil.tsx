import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User, Mail, Phone, Shield, Save, Settings, Calendar, Plus } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useGoogleAccounts } from "@/hooks/useGoogleAccounts";
import { GoogleAccountsList } from "@/components/GoogleAccountsList";

interface InstanciaWhatsApp {
  id: string;
  nome_instancia: string;
  numero_chip: string | null;
  status: string;
  ativo: boolean;
}

const roleLabels: { [key: string]: string } = {
  admin_geral: "Admin Geral",
  medico: "Médico",
  administrativo: "Administrativo",
  secretaria_medica: "Secretária Médica",
};

const roleBadgeVariants: { [key: string]: "default" | "secondary" | "destructive" | "outline" } = {
  admin_geral: "destructive",
  medico: "default",
  administrativo: "secondary",
  secretaria_medica: "outline",
};

const CORES_DISPONIVEIS = [
  "#2563EB", "#DC2626", "#059669", "#7C3AED", 
  "#EA580C", "#0891B2", "#BE185D", "#4338CA"
];

export default function Perfil() {
  const { profile, loading: profileLoading } = useCurrentUser();
  const { connect: connectGoogle } = useGoogleAccounts();
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [corPerfil, setCorPerfil] = useState("");
  const [instanciaPadraoId, setInstanciaPadraoId] = useState<string>("");
  const [instancias, setInstancias] = useState<InstanciaWhatsApp[]>([]);
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [conectandoGoogle, setConectandoGoogle] = useState(false);

  // Processa retorno do OAuth Google (redirect do callback com ?google_status=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("google_status");
    if (!status) return;

    if (status === "connected") {
      const email = params.get("email") || "";
      toast.success(`Conta ${email} conectada com sucesso`);
    } else if (status === "error") {
      const reason = params.get("reason") || "desconhecido";
      toast.error(`Falha ao conectar Google: ${reason}`);
    }

    // Remove query params sem recarregar
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => {
    if (profile) {
      setNome(profile.nome);
      setTelefone(profile.telefone_contato || "");
      setCorPerfil(profile.cor_perfil);
      setInstanciaPadraoId(profile.instancia_padrao_id || "");
    }
  }, [profile]);

  useEffect(() => {
    fetchInstancias();
    fetchEmail();

    // Realtime: Atualizar instâncias quando houver mudanças
    const channel = supabase
      .channel('instancias_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'instancias_whatsapp'
        },
        () => {
          console.log('Instâncias atualizadas, recarregando...');
          fetchInstancias();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchInstancias = async () => {
    try {
      const { data, error } = await supabase
        .from("instancias_whatsapp")
        .select("id, nome_instancia, numero_chip, status, ativo")
        .neq("status", "deletada")
        .order("ativo", { ascending: false })
        .order("nome_instancia");

      if (error) throw error;
      setInstancias(data || []);
    } catch (error) {
      console.error("Erro ao buscar instâncias:", error);
      toast.error("Erro ao carregar instâncias");
    }
  };

  const fetchEmail = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        setEmail(user.email);
      }
    } catch (error) {
      console.error("Erro ao buscar email:", error);
    }
  };

  const handleSave = async () => {
    if (!profile?.id) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          nome,
          telefone_contato: telefone || null,
          cor_perfil: corPerfil,
          instancia_padrao_id: instanciaPadraoId || null,
        })
        .eq("id", profile.id);

      if (error) throw error;

      toast.success("Perfil atualizado com sucesso!");
    } catch (error) {
      console.error("Erro ao salvar perfil:", error);
      toast.error("Erro ao atualizar perfil");
    } finally {
      setSaving(false);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <User className="h-16 w-16 text-muted-foreground mb-4" />
            <p className="text-lg font-medium text-muted-foreground">
              Perfil não encontrado
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <User className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold text-foreground">Meu Perfil</h1>
            <p className="text-muted-foreground">Gerencie suas informações pessoais</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Card de Visualização do Perfil */}
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>Avatar</CardTitle>
            <CardDescription>Sua identidade visual no sistema</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center space-y-4">
            <Avatar className="h-32 w-32" style={{ backgroundColor: corPerfil }}>
              <AvatarFallback className="text-white font-semibold text-3xl">
                {getInitials(nome || profile.nome)}
              </AvatarFallback>
            </Avatar>
            <div className="text-center">
              <h3 className="font-semibold text-lg">{nome || profile.nome}</h3>
              <Badge variant={roleBadgeVariants[profile.role || ""] || "outline"} className="mt-2">
                <Shield className="h-3 w-3 mr-1" />
                {roleLabels[profile.role || ""] || "Sem Função"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Card de Edição do Perfil */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Informações do Perfil</CardTitle>
            <CardDescription>Atualize seus dados pessoais e preferências</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    value={email}
                    disabled
                    className="bg-muted"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  O email não pode ser alterado
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="nome">Nome Completo</Label>
                <Input
                  id="nome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Digite seu nome completo"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="telefone">Telefone de Contato</Label>
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <Input
                    id="telefone"
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    placeholder="(00) 00000-0000"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cor">Cor do Perfil</Label>
                <div className="flex gap-2 flex-wrap">
                  {CORES_DISPONIVEIS.map((cor) => (
                    <button
                      key={cor}
                      type="button"
                      onClick={() => setCorPerfil(cor)}
                      className={`w-10 h-10 rounded-full transition-all ${
                        corPerfil === cor
                          ? "ring-4 ring-primary ring-offset-2"
                          : "hover:scale-110"
                      }`}
                      style={{ backgroundColor: cor }}
                      title={cor}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="instancia">Instância Padrão</Label>
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1 flex gap-2">
                    <Select
                      value={instanciaPadraoId || undefined}
                      onValueChange={setInstanciaPadraoId}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Selecione uma instância padrão" />
                      </SelectTrigger>
                      <SelectContent>
                        {instancias.map((inst) => (
                          <SelectItem key={inst.id} value={inst.id}>
                            <div className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full ${inst.ativo ? 'bg-green-500' : 'bg-gray-400'}`} />
                              {inst.nome_instancia}
                              {inst.numero_chip && ` (${inst.numero_chip})`}
                              {!inst.ativo && <span className="text-muted-foreground text-xs ml-1">(desconectada)</span>}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {instanciaPadraoId && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setInstanciaPadraoId("")}
                        title="Remover instância padrão"
                      >
                        ×
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Instância usada por padrão ao enviar mensagens
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <Button onClick={handleSave} disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                {saving ? "Salvando..." : "Salvar Alterações"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Card Google Calendar — ocupa largura toda abaixo do grid superior */}
        <Card className="md:col-span-3">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-primary" />
                  Contas Google Calendar
                </CardTitle>
                <CardDescription>
                  Sincroniza automaticamente os eventos das suas agendas Google no CRM.
                  Você pode conectar múltiplas contas.
                </CardDescription>
              </div>
              <Button
                onClick={async () => {
                  setConectandoGoogle(true);
                  try {
                    await connectGoogle();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Erro ao iniciar OAuth");
                    setConectandoGoogle(false);
                  }
                }}
                disabled={conectandoGoogle}
                size="sm"
              >
                <Plus className="h-4 w-4 mr-2" />
                {conectandoGoogle ? "Abrindo..." : "Conectar nova conta"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <GoogleAccountsList />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
