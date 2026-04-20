import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit, Pause, Play, Trash2, Clock, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { ptBR } from "date-fns/locale";

const BRAZIL_TIMEZONE = "America/Sao_Paulo";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DisparoForm } from "@/components/DisparoForm";

interface LastLog {
  success: boolean;
  error_message: string | null;
  sent_at: string;
}

interface ScheduledMessage {
  id: string;
  nome_disparo: string;
  instance_id: string;
  contact_id: string | null;
  phone: string;
  message_text: string;
  frequency: string;
  week_days: number[] | null;
  month_day: number | null;
  send_time: string;
  next_run_at: string | null;
  last_run_at: string | null;
  active: boolean;
  created_at: string;
  instancias_whatsapp?: {
    id: string;
    nome_instancia: string;
  };
  contacts?: {
    id: string;
    name: string | null;
    phone: string;
  };
  last_log?: LastLog | null;
}

const FREQUENCY_LABELS = {
  once: "Único",
  daily: "Diário",
  weekly: "Semanal",
  monthly: "Mensal",
};

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export default function DisparosAutomaticos() {
  const [disparos, setDisparos] = useState<ScheduledMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDisparo, setEditingDisparo] = useState<ScheduledMessage | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchDisparos();

    const channel = supabase
      .channel("scheduled-messages-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "scheduled_messages",
        },
        () => {
          fetchDisparos();
        }
      )
      .subscribe();

    const logChannel = supabase
      .channel("scheduled-messages-log-changes")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "scheduled_messages_log",
        },
        () => {
          fetchDisparos();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(logChannel);
    };
  }, []);

  const fetchDisparos = async () => {
    try {
      setLoading(true);
      
      // Buscar disparos
      const { data: disparosData, error: disparosError } = await supabase
        .from("scheduled_messages")
        .select(`
          *,
          instancias_whatsapp (
            id,
            nome_instancia
          ),
          contacts (
            id,
            name,
            phone
          )
        `)
        .order("next_run_at", { ascending: true, nullsFirst: false });

      if (disparosError) throw disparosError;

      // Buscar último log de cada disparo
      const disparosWithLogs = await Promise.all(
        (disparosData || []).map(async (disparo) => {
          const { data: logData } = await supabase
            .from("scheduled_messages_log")
            .select("success, error_message, sent_at")
            .eq("scheduled_message_id", disparo.id)
            .order("sent_at", { ascending: false })
            .limit(1)
            .single();

          return {
            ...disparo,
            last_log: logData || null,
          };
        })
      );

      setDisparos(disparosWithLogs);
    } catch (error) {
      console.error("Erro ao carregar disparos:", error);
      toast({
        title: "Erro",
        description: "Não foi possível carregar os disparos automáticos.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (disparo: ScheduledMessage) => {
    try {
      const { error } = await supabase
        .from("scheduled_messages")
        .update({ active: !disparo.active })
        .eq("id", disparo.id);

      if (error) throw error;

      toast({
        title: "Sucesso",
        description: `Disparo ${!disparo.active ? "ativado" : "pausado"} com sucesso.`,
      });
    } catch (error) {
      console.error("Erro ao alterar status:", error);
      toast({
        title: "Erro",
        description: "Não foi possível alterar o status do disparo.",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este disparo?")) return;

    try {
      const { error } = await supabase
        .from("scheduled_messages")
        .delete()
        .eq("id", id);

      if (error) throw error;

      toast({
        title: "Sucesso",
        description: "Disparo excluído com sucesso.",
      });
    } catch (error) {
      console.error("Erro ao deletar disparo:", error);
      toast({
        title: "Erro",
        description: "Não foi possível excluir o disparo.",
        variant: "destructive",
      });
    }
  };

  const handleEdit = (disparo: ScheduledMessage) => {
    setEditingDisparo(disparo);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingDisparo(null);
  };

  const formatWeekDays = (weekDays: number[] | null) => {
    if (!weekDays || weekDays.length === 0) return "-";
    return weekDays
      .sort()
      .map((day) => WEEKDAY_LABELS[day])
      .join(", ");
  };

  const renderLastStatus = (disparo: ScheduledMessage) => {
    if (!disparo.last_log) {
      return (
        <div className="flex items-center gap-2 text-muted-foreground">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm">Nunca executado</span>
        </div>
      );
    }

    if (disparo.last_log.success) {
      const sentDate = toZonedTime(parseISO(disparo.last_log.sent_at), BRAZIL_TIMEZONE);
      return (
        <div className="flex items-center gap-2 text-green-600">
          <CheckCircle className="w-4 h-4" />
          <span className="text-sm">
            Enviado em {format(sentDate, "dd/MM HH:mm", { locale: ptBR })}
          </span>
        </div>
      );
    }

    const failDate = toZonedTime(parseISO(disparo.last_log.sent_at), BRAZIL_TIMEZONE);
    return (
      <div className="flex items-center gap-2 text-destructive">
        <XCircle className="w-4 h-4" />
        <span className="text-sm">
          Falha em {format(failDate, "dd/MM HH:mm", { locale: ptBR })}
        </span>
      </div>
    );
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mh-gold-600">
            Operação · Automação
          </div>
          <h1 className="font-serif-display text-2xl md:text-3xl font-medium text-mh-ink leading-tight mt-1">
            Disparos Agendados
          </h1>
          <p className="text-sm text-mh-ink-3 mt-1">
            Configure mensagens agendadas para serem enviadas automaticamente.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Novo Disparo
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">Carregando disparos...</p>
        </div>
      ) : disparos.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Clock className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-lg font-medium mb-2">Nenhum disparo configurado</p>
            <p className="text-muted-foreground mb-4">
              Crie seu primeiro disparo automático para começar
            </p>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Criar Disparo
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {disparos.map((disparo) => (
            <Card key={disparo.id} className={!disparo.active ? "opacity-60" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1 flex-1">
                    <CardTitle className="text-lg">{disparo.nome_disparo}</CardTitle>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={disparo.active ? "default" : "secondary"}>
                        {disparo.active ? "Ativo" : "Pausado"}
                      </Badge>
                      <Badge variant="outline">
                        {FREQUENCY_LABELS[disparo.frequency as keyof typeof FREQUENCY_LABELS]}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {disparo.instancias_whatsapp?.nome_instancia || "Instância não encontrada"}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleToggleActive(disparo)}
                    >
                      {disparo.active ? (
                        <Pause className="w-4 h-4" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(disparo)}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(disparo.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Contato</p>
                    <p className="text-sm">
                      {disparo.contacts?.name || disparo.phone}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Horário</p>
                    <p className="text-sm">{disparo.send_time}</p>
                  </div>
                  {disparo.frequency === "weekly" && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Dias da semana</p>
                      <p className="text-sm">{formatWeekDays(disparo.week_days)}</p>
                    </div>
                  )}
                  {disparo.frequency === "monthly" && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Dia do mês</p>
                      <p className="text-sm">Dia {disparo.month_day}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Próximo envio</p>
                    <p className="text-sm">
                      {disparo.next_run_at
                        ? format(toZonedTime(parseISO(disparo.next_run_at), BRAZIL_TIMEZONE), "dd/MM/yyyy 'às' HH:mm", {
                            locale: ptBR,
                          })
                        : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Último Status</p>
                    {renderLastStatus(disparo)}
                  </div>
                  {disparo.last_log && !disparo.last_log.success && disparo.last_log.error_message && (
                    <div className="md:col-span-2 lg:col-span-3">
                      <p className="text-sm font-medium text-muted-foreground">Último Erro</p>
                      <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">
                        {disparo.last_log.error_message}
                      </p>
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Mensagem</p>
                  <p className="text-sm bg-muted p-2 rounded whitespace-pre-wrap">
                    {disparo.message_text}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
          <DialogTitle>
              {editingDisparo ? "Editar Disparo" : "Novo Disparo Agendado"}
            </DialogTitle>
          </DialogHeader>
          <DisparoForm
            disparo={editingDisparo}
            onSuccess={handleCloseDialog}
            onCancel={handleCloseDialog}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
