import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Trash2, Route } from "lucide-react";
import { toast } from "sonner";
import { PERFIS_PROFISSIONAIS } from "@/utils/constants";

interface Regra {
  id: string;
  perfis_profissionais: string[];
  responsavel_user_id: string | null;
  ativo: boolean;
  prioridade: number;
}

interface Profile {
  id: string;
  nome: string;
}

const getPerfilLabel = (value: string) => {
  return PERFIS_PROFISSIONAIS.find((p) => p.value === value)?.label || value;
};

export const HubRoteamentoConfig = () => {
  const [regras, setRegras] = useState<Regra[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  // Estado para nova regra
  const [novoPerfil, setNovoPerfil] = useState("");
  const [novoResponsavel, setNovoResponsavel] = useState("");

  const fetchData = async () => {
    setLoading(true);
    const [regrasRes, profilesRes] = await Promise.all([
      supabase
        .from("regras_roteamento" as any)
        .select("*")
        .order("prioridade", { ascending: false }),
      supabase
        .from("profiles")
        .select("id, nome")
        .eq("ativo", true),
    ]);

    if (regrasRes.data) setRegras(regrasRes.data as unknown as Regra[]);
    if (profilesRes.data) setProfiles(profilesRes.data);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAddRegra = async () => {
    if (!novoPerfil || !novoResponsavel) {
      toast.error("Selecione perfil e responsável");
      return;
    }

    // Verificar se já existe regra para esse perfil
    const existente = regras.find((r) => r.perfis_profissionais.includes(novoPerfil));
    if (existente) {
      toast.error("Já existe uma regra para esse perfil");
      return;
    }

    const { error } = await supabase.from("regras_roteamento" as any).insert({
      perfis_profissionais: [novoPerfil],
      responsavel_user_id: novoResponsavel,
      ativo: true,
      prioridade: regras.length,
    } as any);

    if (error) {
      toast.error("Erro ao criar regra");
      console.error(error);
    } else {
      toast.success("Regra criada");
      setNovoPerfil("");
      setNovoResponsavel("");
      fetchData();
    }
  };

  const handleToggle = async (id: string, ativo: boolean) => {
    const { error } = await supabase
      .from("regras_roteamento" as any)
      .update({ ativo } as any)
      .eq("id", id);

    if (error) {
      toast.error("Erro ao atualizar regra");
    } else {
      setRegras((prev) => prev.map((r) => (r.id === id ? { ...r, ativo } : r)));
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("regras_roteamento" as any).delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir regra");
    } else {
      toast.success("Regra excluída");
      setRegras((prev) => prev.filter((r) => r.id !== id));
    }
  };

  const getResponsavelNome = (userId: string | null) => {
    if (!userId) return "—";
    return profiles.find((p) => p.id === userId)?.nome || "Desconhecido";
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Route className="h-4 w-4" />
            Regras de Roteamento Automático
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Quando uma nova conversa chegar, o sistema atribui automaticamente o responsável com base no perfil do contato.
          </p>
        </CardHeader>
        <CardContent>
          {regras.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhuma regra configurada. Adicione abaixo.
            </p>
          ) : (
            <div className="space-y-2">
              {regras.map((regra) => (
                <div
                  key={regra.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card"
                >
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={regra.ativo}
                      onCheckedChange={(checked) => handleToggle(regra.id, checked)}
                    />
                    <div className="flex items-center gap-2">
                      {regra.perfis_profissionais.map((p) => (
                        <Badge key={p} variant="secondary" className="text-xs">
                          {getPerfilLabel(p)}
                        </Badge>
                      ))}
                      <span className="text-xs text-muted-foreground mx-1">→</span>
                      <span className="text-sm font-medium">
                        {getResponsavelNome(regra.responsavel_user_id)}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(regra.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Adicionar nova regra */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Adicionar Regra</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-1">Perfil do contato</p>
              <Select value={novoPerfil} onValueChange={setNovoPerfil}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Selecionar perfil..." />
                </SelectTrigger>
                <SelectContent>
                  {PERFIS_PROFISSIONAIS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-1">Atribuir para</p>
              <Select value={novoResponsavel} onValueChange={setNovoResponsavel}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Selecionar responsável..." />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button size="sm" onClick={handleAddRegra} className="gap-1">
              <Plus className="h-3.5 w-3.5" />
              Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
