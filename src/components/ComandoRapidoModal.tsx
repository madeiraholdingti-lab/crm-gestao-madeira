import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Command, CheckCircle2, AlertCircle, ListTodo, Clock, Bell, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ComandoRapidoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ModalState = "idle" | "loading" | "confirmando" | "executando" | "sucesso" | "erro";

interface ComandoResultado {
  tipo: "tarefa" | "lembrete" | "follow_up" | "nao_entendeu";
  dados: {
    titulo?: string;
    descricao?: string;
    responsavel_id?: string;
    responsavel_nome?: string;
    prazo?: string;
    conversa_id?: string;
  };
  confianca: "alta" | "media" | "baixa";
  confirmacao_texto: string;
}

const TIPO_ICONS = {
  tarefa: ListTodo,
  lembrete: Bell,
  follow_up: Clock,
  nao_entendeu: AlertCircle,
};

const TIPO_LABELS = {
  tarefa: "Nova tarefa",
  lembrete: "Lembrete",
  follow_up: "Follow-up",
  nao_entendeu: "Não entendido",
};

export const ComandoRapidoModal = ({ open, onOpenChange }: ComandoRapidoModalProps) => {
  const { profile } = useCurrentUser();
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState<ModalState>("idle");
  const [resultado, setResultado] = useState<ComandoResultado | null>(null);

  // Reset ao abrir/fechar
  useEffect(() => {
    if (open) {
      setTexto("");
      setEstado("idle");
      setResultado(null);
    }
  }, [open]);

  const handleInterpretar = async () => {
    if (!texto.trim() || !profile?.id) return;

    setEstado("loading");

    const { data, error } = await supabase.functions.invoke("interpretar-comando", {
      body: { texto: texto.trim(), user_id: profile.id },
    });

    if (error || !data) {
      setEstado("erro");
      toast.error("Erro ao interpretar comando");
      return;
    }

    setResultado(data as ComandoResultado);

    if (data.tipo === "nao_entendeu") {
      setEstado("erro");
    } else if (data.confianca === "baixa") {
      // Confiança baixa → volta para idle para o usuário refinar
      setEstado("idle");
      toast.info("Comando vago — tente ser mais específico");
    } else {
      setEstado("confirmando");
    }
  };

  const handleConfirmar = async () => {
    if (!resultado || !profile?.id) return;

    setEstado("executando");

    try {
      if (resultado.tipo === "tarefa") {
        // Buscar primeira coluna do TaskFlow
        const { data: colunas } = await supabase
          .from("task_flow_columns")
          .select("id")
          .order("position", { ascending: true })
          .limit(1);

        const columnId = colunas?.[0]?.id;
        if (!columnId) {
          toast.error("Nenhuma coluna encontrada no TaskFlow");
          setEstado("erro");
          return;
        }

        // Buscar profile do criador no TaskFlow
        const { data: creatorProfile } = await supabase
          .from("task_flow_profiles")
          .select("id")
          .eq("user_id", profile.id)
          .single();

        const { error } = await supabase.from("task_flow_tasks").insert({
          titulo: resultado.dados.titulo || texto,
          descricao: resultado.dados.descricao || null,
          column_id: columnId,
          responsavel_id: resultado.dados.responsavel_id || creatorProfile?.id || null,
          criado_por_id: creatorProfile?.id || null,
          prazo: resultado.dados.prazo || null,
          origem: "ia",
        });

        if (error) throw error;

        // Notificar responsável via WA (se diferente do criador)
        if (resultado.dados.responsavel_id) {
          const { data: respProfile } = await supabase
            .from("task_flow_profiles")
            .select("user_id")
            .eq("id", resultado.dados.responsavel_id)
            .single();

          if (respProfile?.user_id && respProfile.user_id !== profile.id) {
            const { data: userProfile } = await supabase
              .from("profiles")
              .select("telefone_contato, instancia_padrao_id")
              .eq("id", respProfile.user_id)
              .single();

            if (userProfile?.telefone_contato && userProfile?.instancia_padrao_id) {
              const { data: instancia } = await supabase
                .from("instancias_whatsapp")
                .select("instancia_id")
                .eq("id", userProfile.instancia_padrao_id)
                .single();

              if (instancia) {
                const prazoFormatado = resultado.dados.prazo
                  ? new Date(resultado.dados.prazo).toLocaleDateString("pt-BR")
                  : "sem prazo";

                await supabase.functions.invoke("enviar-mensagem-evolution", {
                  body: {
                    instancia_id: instancia.instancia_id,
                    numero: userProfile.telefone_contato,
                    mensagem: `📋 Nova tarefa atribuída a você:\n${resultado.dados.titulo}\nPrazo: ${prazoFormatado}`,
                  },
                });
              }
            }
          }
        }

      } else if (resultado.tipo === "lembrete") {
        await supabase.from("notificacoes").insert({
          user_id: profile.id,
          tipo: "lembrete",
          titulo: `🔔 ${resultado.dados.titulo || texto}`,
          mensagem: resultado.dados.descricao || "Lembrete definido pelo comando rápido",
          dados: { prazo: resultado.dados.prazo },
        });

      } else if (resultado.tipo === "follow_up" && resultado.dados.conversa_id) {
        await (supabase.from("conversas") as any).update({
          follow_up_em: resultado.dados.prazo,
          follow_up_nota: resultado.dados.titulo || null,
        }).eq("id", resultado.dados.conversa_id);
      }

      setEstado("sucesso");
      toast.success("Ação executada!");
      setTimeout(() => onOpenChange(false), 1500);

    } catch (err) {
      console.error("[COMANDO] Erro ao executar:", err);
      toast.error("Erro ao executar ação");
      setEstado("erro");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && estado === "idle") {
      handleInterpretar();
    }
  };

  const TipoIcon = resultado ? TIPO_ICONS[resultado.tipo] : Command;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Command className="h-4 w-4" />
            Comando Rápido
            <Badge variant="secondary" className="text-[10px]">Ctrl+K</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Input */}
          <Input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Ex: "Iza precisa enviar receita do João até sexta"'
            disabled={estado === "loading" || estado === "executando" || estado === "sucesso"}
            autoFocus
          />

          {/* Loading */}
          {estado === "loading" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Interpretando...
            </div>
          )}

          {/* Confirmação */}
          {estado === "confirmando" && resultado && (
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <TipoIcon className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">{TIPO_LABELS[resultado.tipo]}</span>
                <Badge variant={resultado.confianca === "alta" ? "default" : "secondary"} className="text-[10px]">
                  {resultado.confianca}
                </Badge>
              </div>

              <p className="text-sm">{resultado.confirmacao_texto}</p>

              {resultado.dados.responsavel_nome && (
                <p className="text-xs text-muted-foreground">Para: {resultado.dados.responsavel_nome}</p>
              )}
              {resultado.dados.prazo && (
                <p className="text-xs text-muted-foreground">
                  Prazo: {new Date(resultado.dados.prazo).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
                </p>
              )}

              <div className="flex gap-2 pt-2">
                <Button onClick={handleConfirmar} size="sm">Confirmar</Button>
                <Button variant="outline" size="sm" onClick={() => { setEstado("idle"); setResultado(null); }}>
                  Editar
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {/* Executando */}
          {estado === "executando" && (
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Executando...
            </div>
          )}

          {/* Sucesso */}
          {estado === "sucesso" && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              Ação executada com sucesso!
            </div>
          )}

          {/* Erro / Não entendeu */}
          {estado === "erro" && resultado?.tipo === "nao_entendeu" && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/30 p-3 text-sm">
              <p className="font-medium text-yellow-800 dark:text-yellow-200">{resultado.confirmacao_texto}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Tente: "Tarefa para Iza: [descrição] até [data]"
              </p>
            </div>
          )}

          {/* Dica */}
          {estado === "idle" && !resultado && (
            <p className="text-xs text-muted-foreground">
              Digite um comando em linguagem natural. Exemplos: "Lembra de ligar pro Dr. Silva amanhã", "Mariana, confirmar consulta na quinta"
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
