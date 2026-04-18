import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, BrainCircuit, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  count: number;
}

export const HubUnclassifiedBanner = ({ count }: Props) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [progresso, setProgresso] = useState<{ classificados: number; restantes: number } | null>(null);

  const handleClassificarLote = useCallback(async () => {
    setLoading(true);
    setProgresso(null);
    let totalClassificados = 0;

    try {
      // Executar batches até acabar ou atingir limite
      for (let i = 0; i < 10; i++) { // máximo 10 batches (500 contatos) por clique
        const { data, error } = await supabase.functions.invoke("classificar-contatos-lote");

        if (error || !data) {
          toast.error("Erro ao classificar lote");
          break;
        }

        totalClassificados += data.classificados || 0;
        setProgresso({ classificados: totalClassificados, restantes: data.restantes || 0 });

        if (data.restantes === 0 || data.classificados === 0) {
          break;
        }

        toast.info(`${totalClassificados} classificados... continuando`);
      }

      if (totalClassificados > 0) {
        toast.success(`${totalClassificados} contatos classificados pela IA!`);
        queryClient.invalidateQueries({ queryKey: ["hub-whatsapp"] });
      } else {
        toast.info("Nenhum contato novo para classificar");
      }
    } catch {
      toast.error("Erro ao processar classificação em lote");
    } finally {
      setLoading(false);
    }
  }, [queryClient]);

  if (count === 0) return null;

  return (
    <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
      <CardContent className="flex items-center justify-between py-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              {loading && progresso
                ? `${progresso.classificados} classificados — ${progresso.restantes.toLocaleString("pt-BR")} restantes`
                : `${count.toLocaleString("pt-BR")} contatos sem perfil definido`}
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {loading
                ? "A IA está analisando nomes e conversas para classificar..."
                : "Classifique para usar filtros inteligentes e disparos segmentados"}
            </p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            size="sm"
            className="gap-2"
            onClick={handleClassificarLote}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BrainCircuit className="h-3.5 w-3.5" />}
            {loading ? "Classificando..." : "Classificar com IA"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900"
            onClick={() => navigate("/contatos")}
          >
            Manual
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
