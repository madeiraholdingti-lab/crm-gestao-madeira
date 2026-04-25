import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { z } from "zod";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const WEEKDAY_OPTIONS = [
  { value: 0, label: "Domingo" },
  { value: 1, label: "Segunda" },
  { value: 2, label: "Terça" },
  { value: 3, label: "Quarta" },
  { value: 4, label: "Quinta" },
  { value: 5, label: "Sexta" },
  { value: 6, label: "Sábado" },
];

const disparoSchema = z.object({
  nome_disparo: z.string().min(1, "Nome do disparo é obrigatório").max(100),
  instance_id: z.string().uuid("Selecione uma instância"),
  phone: z.string().min(10, "Telefone inválido").max(20),
  message_text: z.string().min(1, "Mensagem é obrigatória").max(1000),
  frequency: z.enum(["once", "daily", "weekly", "monthly"]),
  send_time: z.string().regex(/^\d{2}:\d{2}$/, "Horário inválido (HH:MM)"),
  week_days: z.array(z.number()).optional(),
  month_day: z.number().min(1).max(31).optional(),
});

interface DisparoFormProps {
  disparo?: any;
  onSuccess: () => void;
  onCancel: () => void;
}

interface Instancia {
  id: string;
  nome_instancia: string;
  ativo: boolean;
  status: string;
}

interface Contact {
  id: string;
  name: string | null;
  phone: string;
}

export function DisparoForm({ disparo, onSuccess, onCancel }: DisparoFormProps) {
  const { profile } = useCurrentUser();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [instancias, setInstancias] = useState<Instancia[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [searchContact, setSearchContact] = useState("");

  const [formData, setFormData] = useState({
    nome_disparo: disparo?.nome_disparo || "",
    instance_id: disparo?.instance_id || "",
    contact_id: disparo?.contact_id || null,
    phone: disparo?.phone || "",
    message_text: disparo?.message_text || "",
    frequency: disparo?.frequency || "weekly",
    week_days: disparo?.week_days || [],
    month_day: disparo?.month_day || 1,
    send_time: disparo?.send_time ? disparo.send_time.substring(0, 5) : "08:00",
    send_date: disparo?.next_run_at ? new Date(disparo.next_run_at) : new Date(),
  });

  useEffect(() => {
    fetchInstancias();
    fetchContacts();

    // Polling para atualizar instâncias em tempo real
    const interval = setInterval(fetchInstancias, 5000);

    return () => clearInterval(interval);
  }, []);

  const fetchInstancias = async () => {
    // SOMENTE chips com finalidade='disparo'. Nunca mostrar atendimento (Maikon/Iza/Mariana/Consultório).
    const { data } = await supabase
      .from("instancias_whatsapp")
      .select("id, nome_instancia, ativo, status")
      .eq("finalidade", "disparo")
      .neq("status", "deletada")
      .order("nome_instancia");

    setInstancias(data || []);
  };

  const fetchContacts = async () => {
    const { data } = await supabase
      .from("contacts")
      .select("id, name, phone")
      .order("name");

    setContacts(data || []);
  };

  const handleContactSelect = (contactId: string) => {
    const contact = contacts.find((c) => c.id === contactId);
    if (contact) {
      setFormData({
        ...formData,
        contact_id: contact.id,
        phone: contact.phone,
      });
    }
  };

  const handleWeekDayToggle = (day: number) => {
    const newWeekDays = formData.week_days.includes(day)
      ? formData.week_days.filter((d) => d !== day)
      : [...formData.week_days, day];
    setFormData({ ...formData, week_days: newWeekDays });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!profile) {
      toast({
        title: "Erro",
        description: "Você precisa estar logado",
        variant: "destructive",
      });
      return;
    }

    try {
      setLoading(true);

      // Validações específicas
      if (formData.frequency === "weekly" && formData.week_days.length === 0) {
        toast({
          title: "Erro",
          description: "Selecione pelo menos um dia da semana",
          variant: "destructive",
        });
        return;
      }

      // Validar schema
      const validatedData = disparoSchema.parse(formData);

      // Calcular next_run_at
      let nextRun: string | null = null;
      
      if (validatedData.frequency === "once" && formData.send_date) {
        // Para disparo único, usar a data selecionada + horário
        // Preservar timezone local sem converter para UTC
        const sendDate = new Date(formData.send_date);
        const year = sendDate.getFullYear();
        const month = String(sendDate.getMonth() + 1).padStart(2, '0');
        const day = String(sendDate.getDate()).padStart(2, '0');
        const [hours, minutes] = validatedData.send_time.split(":");
        
        // Obter offset do timezone local em minutos e converter para formato ±HH:MM
        const tzOffset = -sendDate.getTimezoneOffset();
        const tzSign = tzOffset >= 0 ? '+' : '-';
        const tzHours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0');
        const tzMins = String(Math.abs(tzOffset) % 60).padStart(2, '0');
        
        // Criar string ISO com timezone offset correto
        nextRun = `${year}-${month}-${day}T${hours}:${minutes}:00${tzSign}${tzHours}:${tzMins}`;
      } else {
        const { data, error: calcError } = await supabase.rpc(
          "calculate_next_run",
          {
            p_frequency: validatedData.frequency,
            p_send_time: validatedData.send_time,
            p_week_days: validatedData.week_days || null,
            p_month_day: validatedData.month_day || null,
          }
        );
        nextRun = data;

        if (calcError) {
          console.error("Erro ao calcular próximo agendamento:", calcError);
        }
      }

      if (disparo) {
        // Editar
        const updateData: any = {
          nome_disparo: validatedData.nome_disparo,
          instance_id: validatedData.instance_id,
          contact_id: formData.contact_id,
          phone: validatedData.phone,
          message_text: validatedData.message_text,
          frequency: validatedData.frequency,
          week_days: validatedData.week_days || null,
          month_day: validatedData.month_day || null,
          send_time: validatedData.send_time,
          next_run_at: nextRun,
        };

        const { error } = await supabase
          .from("scheduled_messages")
          .update(updateData)
          .eq("id", disparo.id);

        if (error) throw error;

        toast({
          title: "Sucesso",
          description: "Disparo atualizado com sucesso!",
        });
      } else {
        // Criar
        const insertData: any = {
          nome_disparo: validatedData.nome_disparo,
          instance_id: validatedData.instance_id,
          contact_id: formData.contact_id,
          phone: validatedData.phone,
          message_text: validatedData.message_text,
          frequency: validatedData.frequency,
          week_days: validatedData.week_days || null,
          month_day: validatedData.month_day || null,
          send_time: validatedData.send_time,
          next_run_at: nextRun,
          created_by: profile.id,
        };

        const { error } = await supabase
          .from("scheduled_messages")
          .insert(insertData);

        if (error) {
          if (error.code === "23505") {
            toast({
              title: "Erro",
              description: "Já existe um disparo idêntico cadastrado.",
              variant: "destructive",
            });
            return;
          }
          throw error;
        }

        toast({
          title: "Sucesso",
          description: "Disparo criado com sucesso!",
        });
      }

      onSuccess();
    } catch (error: any) {
      console.error("Erro ao salvar disparo:", error);
      toast({
        title: "Erro",
        description: error.message || "Não foi possível salvar o disparo.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredContacts = contacts.filter(
    (c) =>
      c.name?.toLowerCase().includes(searchContact.toLowerCase()) ||
      c.phone.includes(searchContact)
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="nome_disparo">Nome do Disparo</Label>
        <Input
          id="nome_disparo"
          value={formData.nome_disparo}
          onChange={(e) => setFormData({ ...formData, nome_disparo: e.target.value })}
          placeholder="Ex: Agenda Dr. Maikon - Hospital X"
          maxLength={100}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="instance_id">Instância WhatsApp</Label>
        <Select
          value={formData.instance_id}
          onValueChange={(value) => setFormData({ ...formData, instance_id: value })}
          required
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione a instância" />
          </SelectTrigger>
          <SelectContent>
            {instancias.map((inst) => (
              <SelectItem key={inst.id} value={inst.id}>
                {inst.nome_instancia}
                {!inst.ativo && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    (inativa)
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="contact">Contato</Label>
        <Input
          placeholder="Buscar contato por nome ou telefone"
          value={searchContact}
          onChange={(e) => setSearchContact(e.target.value)}
        />
        {searchContact && filteredContacts.length > 0 && (
          <div className="border rounded-md max-h-40 overflow-y-auto">
            {filteredContacts.map((contact) => (
              <button
                key={contact.id}
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-accent"
                onClick={() => {
                  handleContactSelect(contact.id);
                  setSearchContact("");
                }}
              >
                <div className="font-medium">{contact.name || "Sem nome"}</div>
                <div className="text-sm text-muted-foreground">{contact.phone}</div>
              </button>
            ))}
          </div>
        )}
        <Input
          id="phone"
          value={formData.phone}
          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          placeholder="Ou digite o telefone (DDI + DDD + número)"
          maxLength={20}
          required
        />
        <p className="text-xs text-muted-foreground">
          Ex: 5547999999999
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="frequency">Frequência</Label>
          <Select
            value={formData.frequency}
            onValueChange={(value: any) => setFormData({ ...formData, frequency: value })}
            required
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="once">Único</SelectItem>
              <SelectItem value="daily">Diário</SelectItem>
              <SelectItem value="weekly">Semanal</SelectItem>
              <SelectItem value="monthly">Mensal</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {formData.frequency === "once" && (
          <div className="space-y-2">
            <Label>Data de envio</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !formData.send_date && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {formData.send_date ? (
                    format(formData.send_date, "PPP", { locale: ptBR })
                  ) : (
                    <span>Selecione a data</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={formData.send_date}
                  onSelect={(date) => date && setFormData({ ...formData, send_date: date })}
                  disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                  initialFocus
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="send_time">Horário</Label>
          <Input
            id="send_time"
            type="time"
            value={formData.send_time}
            onChange={(e) => setFormData({ ...formData, send_time: e.target.value })}
            required
          />
        </div>
      </div>

      {formData.frequency === "weekly" && (
        <div className="space-y-2">
          <Label>Dias da semana</Label>
          <div className="grid grid-cols-4 gap-2">
            {WEEKDAY_OPTIONS.map((day) => (
              <div key={day.value} className="flex items-center space-x-2">
                <Checkbox
                  id={`day-${day.value}`}
                  checked={formData.week_days.includes(day.value)}
                  onCheckedChange={() => handleWeekDayToggle(day.value)}
                />
                <label
                  htmlFor={`day-${day.value}`}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  {day.label}
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

      {formData.frequency === "monthly" && (
        <div className="space-y-2">
          <Label htmlFor="month_day">Dia do mês</Label>
          <Input
            id="month_day"
            type="number"
            min={1}
            max={31}
            value={formData.month_day}
            onChange={(e) =>
              setFormData({ ...formData, month_day: parseInt(e.target.value) })
            }
            required
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="message_text">Mensagem</Label>
        <Textarea
          id="message_text"
          value={formData.message_text}
          onChange={(e) => setFormData({ ...formData, message_text: e.target.value })}
          placeholder="Digite a mensagem que será enviada automaticamente"
          rows={4}
          maxLength={1000}
          required
        />
        <p className="text-xs text-muted-foreground">
          {formData.message_text.length}/1000 caracteres
        </p>
      </div>

      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Salvando..." : disparo ? "Atualizar" : "Criar Disparo"}
        </Button>
      </div>
    </form>
  );
}
