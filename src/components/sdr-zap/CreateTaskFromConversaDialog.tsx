import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { Conversa } from "@/hooks/useConversas";

interface TaskFlowProfile {
  id: string;
  nome: string;
  cor: string;
  user_id: string | null;
}

interface CreateTaskFromConversaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversa: Conversa;
  criadoPorId?: string; // user_id (profiles.id) de quem tá criando
}

export function CreateTaskFromConversaDialog({
  open,
  onOpenChange,
  conversa,
  criadoPorId,
}: CreateTaskFromConversaDialogProps) {
  const queryClient = useQueryClient();
  const contatoNome = conversa.contact?.name || conversa.numero_contato;

  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [responsavelId, setResponsavelId] = useState<string>("");
  const [prazo, setPrazo] = useState<string>("");
  const [salvando, setSalvando] = useState(false);

  // Reset ao abrir — sugere título baseado no contato
  useEffect(() => {
    if (open) {
      setTitulo(`Retorno: ${contatoNome}`);
      setDescricao(`Conversa WhatsApp com ${contatoNome}`);
      setResponsavelId("");
      setPrazo("");
    }
  }, [open, contatoNome]);

  // Lista de responsáveis possíveis (task_flow_profiles ativos)
  const { data: responsaveis = [] } = useQuery({
    queryKey: ["task_flow_profiles"],
    queryFn: async (): Promise<TaskFlowProfile[]> => {
      const { data, error } = await supabase
        .from("task_flow_profiles")
        .select("id, nome, cor, user_id")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60_000,
    enabled: open,
  });

  const handleSubmit = async () => {
    if (!titulo.trim()) {
      toast.error("Título é obrigatório");
      return;
    }
    setSalvando(true);
    try {
      // 1. Descobrir a coluna "Caixa de Entrada" ou primeira disponível
      const { data: columns } = await supabase
        .from("task_flow_columns")
        .select("id, nome, ordem")
        .order("ordem");
      const caixa = columns?.find(c => c.nome.toLowerCase().includes("caixa")) || columns?.[0];
      if (!caixa) throw new Error("Nenhuma coluna disponível");

      // 2. Próxima ordem
      const { data: maxOrdem } = await supabase
        .from("task_flow_tasks")
        .select("ordem")
        .eq("column_id", caixa.id)
        .order("ordem", { ascending: false })
        .limit(1)
        .maybeSingle();
      const novaOrdem = (maxOrdem?.ordem || 0) + 1;

      // 3. Criar a task com conversa_id vinculado
      const { data: novaTask, error: insertError } = await supabase
        .from("task_flow_tasks")
        .insert({
          titulo: titulo.trim(),
          descricao: descricao.trim() || null,
          column_id: caixa.id,
          responsavel_id: responsavelId || null,
          conversa_id: conversa.id,
          prazo: prazo ? new Date(prazo).toISOString() : null,
          criado_por_id: criadoPorId || null,
          origem: "sdr-zap",
          ordem: novaOrdem,
        })
        .select()
        .single();
      if (insertError) throw insertError;

      // 4. Histórico
      await supabase.from("task_flow_history").insert({
        task_id: novaTask.id,
        tipo: "criacao",
        descricao: `Criada a partir da conversa com ${contatoNome}`,
      });

      // 5. Notificação in-app pro responsável (se atribuído a alguém real)
      const resp = responsaveis.find(r => r.id === responsavelId);
      if (resp?.user_id) {
        await supabase.from("notificacoes").insert({
          user_id: resp.user_id,
          titulo: "Nova tarefa atribuída",
          mensagem: `${titulo}${prazo ? ` — prazo: ${new Date(prazo).toLocaleString('pt-BR')}` : ''}`,
          tipo: "task_atribuida",
          dados: { task_id: novaTask.id, conversa_id: conversa.id },
          lida: false,
        });
      }

      toast.success(`Tarefa criada${resp ? ` e atribuída para ${resp.nome}` : ''}`);
      queryClient.invalidateQueries({ queryKey: ["tasks_da_conversa", conversa.id] });
      onOpenChange(false);
    } catch (err) {
      console.error("[CreateTaskFromConversaDialog] erro:", err);
      toast.error(err instanceof Error ? err.message : "Erro ao criar tarefa");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Nova tarefa — {contatoNome}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="task-titulo">Título</Label>
            <Input
              id="task-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex: Ligar para o Dr. João"
              autoFocus
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="task-descricao">Descrição (opcional)</Label>
            <Textarea
              id="task-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={3}
              placeholder="Contexto, objetivo, o que precisa ser feito..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="task-responsavel">Atribuir para</Label>
              <Select value={responsavelId} onValueChange={setResponsavelId}>
                <SelectTrigger id="task-responsavel">
                  <SelectValue placeholder="Ninguém (fila geral)" />
                </SelectTrigger>
                <SelectContent>
                  {responsaveis.map(r => (
                    <SelectItem key={r.id} value={r.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: r.cor }}
                        />
                        {r.nome}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="task-prazo">Prazo (opcional)</Label>
              <Input
                id="task-prazo"
                type="datetime-local"
                value={prazo}
                onChange={(e) => setPrazo(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={salvando || !titulo.trim()}>
            {salvando && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Criar tarefa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
