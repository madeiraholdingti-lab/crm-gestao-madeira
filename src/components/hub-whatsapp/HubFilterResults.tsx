import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Megaphone, ChevronLeft, ChevronRight } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PERFIS_PROFISSIONAIS } from "@/utils/constants";
import type { HubFilterResult, HubFilterParams } from "@/hooks/useHubWhatsApp";

interface Props {
  data: HubFilterResult | undefined;
  isLoading: boolean;
  params: HubFilterParams;
  onPageChange: (offset: number) => void;
}

const getPerfilLabel = (value: string | null) => {
  if (!value) return "—";
  const found = PERFIS_PROFISSIONAIS.find((p) => p.value === value);
  return found ? found.label : value;
};

const exportCSV = (contacts: HubFilterResult["contacts"]) => {
  const headers = ["Nome", "Telefone", "Perfil", "Especialidade", "Instituição", "Última Interação", "Conversas"];
  const rows = contacts.map((c) => [
    c.name || "",
    c.phone,
    getPerfilLabel(c.perfil_profissional),
    c.especialidade || "",
    c.instituicao || "",
    c.last_interaction ? format(parseISO(c.last_interaction), "dd/MM/yyyy", { locale: ptBR }) : "",
    String(c.conversation_count),
  ]);

  const csv = [headers, ...rows].map((row) => row.map((v) => `"${v}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `contatos_hub_${format(new Date(), "yyyy-MM-dd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

export const HubFilterResults = ({ data, isLoading, params, onPageChange }: Props) => {
  const navigate = useNavigate();
  const limit = params.limit || 50;
  const offset = params.offset || 0;
  const totalCount = data?.total_count ?? 0;
  const contacts = data?.contacts ?? [];
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(totalCount / limit);

  if (!data && !isLoading) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-sm font-medium">
          {isLoading ? "Buscando..." : `${totalCount.toLocaleString("pt-BR")} contatos encontrados`}
        </CardTitle>
        {contacts.length > 0 && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate("/disparos-em-massa", { state: { filterPerfil: params.perfil } })}
            >
              <Megaphone className="h-3.5 w-3.5 mr-1" />
              Criar Campanha
            </Button>
            <Button size="sm" variant="outline" onClick={() => exportCSV(contacts)}>
              <Download className="h-3.5 w-3.5 mr-1" />
              Exportar CSV
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Nenhum contato encontrado com esses filtros
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Nome</th>
                    <th className="pb-2 font-medium">Telefone</th>
                    <th className="pb-2 font-medium">Perfil</th>
                    <th className="pb-2 font-medium hidden md:table-cell">Especialidade</th>
                    <th className="pb-2 font-medium hidden lg:table-cell">Última Interação</th>
                    <th className="pb-2 font-medium hidden lg:table-cell">Instância</th>
                    <th className="pb-2 font-medium text-right">Conversas</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => (
                    <tr key={c.contact_id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-2.5 font-medium">{c.name || "Sem nome"}</td>
                      <td className="py-2.5 text-muted-foreground">{c.phone}</td>
                      <td className="py-2.5">
                        <Badge variant="secondary" className="text-xs">
                          {getPerfilLabel(c.perfil_profissional)}
                        </Badge>
                      </td>
                      <td className="py-2.5 text-muted-foreground hidden md:table-cell">
                        {c.especialidade || "—"}
                      </td>
                      <td className="py-2.5 text-muted-foreground hidden lg:table-cell">
                        {c.last_interaction
                          ? format(parseISO(c.last_interaction), "dd/MM/yyyy", { locale: ptBR })
                          : "—"}
                      </td>
                      <td className="py-2.5 hidden lg:table-cell">
                        {c.instance_name ? (
                          <div className="flex items-center gap-1.5">
                            <div
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: c.instance_color || "#6b7280" }}
                            />
                            <span className="text-xs text-muted-foreground">{c.instance_name}</span>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2.5 text-right text-muted-foreground">{c.conversation_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t">
                <p className="text-xs text-muted-foreground">
                  Página {currentPage} de {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={offset === 0}
                    onClick={() => onPageChange(Math.max(0, offset - limit))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Anterior
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={currentPage >= totalPages}
                    onClick={() => onPageChange(offset + limit)}
                  >
                    Próximo
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
