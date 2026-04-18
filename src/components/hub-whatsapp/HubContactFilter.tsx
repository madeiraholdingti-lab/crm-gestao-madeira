import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PERFIS_PROFISSIONAIS, PERIODOS_ATIVIDADE } from "@/utils/constants";
import type { HubFilterParams } from "@/hooks/useHubWhatsApp";

interface Instancia {
  id: string;
  nome_instancia: string;
}

interface Props {
  onFilter: (params: HubFilterParams) => void;
  onClear: () => void;
}

export const HubContactFilter = ({ onFilter, onClear }: Props) => {
  const [perfil, setPerfil] = useState<string>("");
  const [especialidade, setEspecialidade] = useState("");
  const [instituicao, setInstituicao] = useState("");
  const [instanceId, setInstanceId] = useState<string>("");
  const [periodo, setPeriodo] = useState<string>("all");
  const [instancias, setInstancias] = useState<Instancia[]>([]);

  useEffect(() => {
    supabase
      .from("instancias_whatsapp")
      .select("id, nome_instancia")
      .eq("ativo", true)
      .neq("status", "deletada")
      .then(({ data }) => {
        if (data) setInstancias(data);
      });
  }, []);

  const handleSubmit = () => {
    onFilter({
      perfil: perfil || null,
      especialidade: especialidade || null,
      instituicao: instituicao || null,
      instance_id: instanceId || null,
      days: periodo !== "all" ? parseInt(periodo) : null,
    });
  };

  const handleClear = () => {
    setPerfil("");
    setEspecialidade("");
    setInstituicao("");
    setInstanceId("");
    setPeriodo("all");
    onClear();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
  };

  // Pré-selecionar perfil quando clicado do gráfico
  const setPerfilExterno = (value: string) => {
    setPerfil(value);
  };

  // Expor via window para comunicação cross-component
  useEffect(() => {
    (window as any).__hubSetPerfil = setPerfilExterno;
    return () => { delete (window as any).__hubSetPerfil; };
  }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Search className="h-4 w-4" />
          Busca Inteligente
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <Label className="text-xs">Perfil</Label>
            <Select value={perfil} onValueChange={setPerfil}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Todos" />
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

          <div>
            <Label className="text-xs">Especialidade</Label>
            <Input
              value={especialidade}
              onChange={(e) => setEspecialidade(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ex: Cardiologia"
              className="h-9"
            />
          </div>

          <div>
            <Label className="text-xs">Instituição</Label>
            <Input
              value={instituicao}
              onChange={(e) => setInstituicao(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ex: Hospital X"
              className="h-9"
            />
          </div>

          <div>
            <Label className="text-xs">Instância</Label>
            <Select value={instanceId} onValueChange={setInstanceId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Todas" />
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

          <div>
            <Label className="text-xs">Período</Label>
            <Select value={periodo} onValueChange={setPeriodo}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODOS_ATIVIDADE.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex gap-2 mt-3">
          <Button onClick={handleSubmit} size="sm">
            <Search className="h-3.5 w-3.5 mr-1" />
            Buscar
          </Button>
          <Button onClick={handleClear} size="sm" variant="ghost">
            <X className="h-3.5 w-3.5 mr-1" />
            Limpar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
