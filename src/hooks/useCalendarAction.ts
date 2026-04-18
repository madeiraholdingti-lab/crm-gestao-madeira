import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface CalendarVerifyPayload {
  tipo: "calendar";
  subtipo: "verify";
  messages: Array<{
    text: string;
    from_me: boolean;
    timestamp: string;
  }>;
  contato: string;
  origem: "whatsapp";
  timezone: string;
  id_conversa: string;
}

export interface CalendarConfirmPayload {
  tipo: "calendar";
  subtipo: "confirmed";
  action: "create" | "update" | "retry";
  event_id?: string;
  id_agenda?: string;
  inicio: string;
  fim: string;
}

export interface CalendarVerifyResponse {
  success: boolean;
  status?: "success" | "warning";
  action?: "create" | "update";
  message?: string;
  new_start?: string;
  new_end?: string;
  titulo?: string;
  descricao?: string;
  event_id?: string;
  current_start?: string;
  current_end?: string;
  id_agenda?: string;
  // Legacy fields for backwards compatibility
  conflict?: boolean;
  conflictMessage?: string;
  evento?: {
    inicio: string;
    fim: string;
    titulo?: string;
    descricao?: string;
  };
}

export interface CalendarConfirmResponse {
  status?: string;
  message?: string;
  action?: "finish" | string;
  success?: boolean;
  eventId?: string;
}

export type CalendarModalStatus = "idle" | "loading" | "conflict" | "ready" | "confirming" | "success" | "error";

export interface CalendarActionState {
  status: CalendarModalStatus;
  countdown: number;
  action: "create" | "update" | null;
  message: string | null;
  successMessage: string | null;
  evento: {
    inicio: string;
    fim: string;
    titulo: string;
    descricao: string;
  } | null;
  currentEvento: {
    inicio: string;
    fim: string;
  } | null;
  eventId: string | null;
  idAgenda: string | null;
  conflictMessage: string | null;
  errorMessage: string | null;
}

export function useCalendarAction() {
  const [state, setState] = useState<CalendarActionState>({
    status: "idle",
    countdown: 5,
    action: null,
    message: null,
    successMessage: null,
    evento: null,
    currentEvento: null,
    eventId: null,
    idAgenda: null,
    conflictMessage: null,
    errorMessage: null,
  });

  const resetState = useCallback(() => {
    setState({
      status: "idle",
      countdown: 5,
      action: null,
      message: null,
      successMessage: null,
      evento: null,
      currentEvento: null,
      eventId: null,
      idAgenda: null,
      conflictMessage: null,
      errorMessage: null,
    });
  }, []);

  const verifyCalendar = useCallback(async (payload: CalendarVerifyPayload): Promise<void> => {
    setState(prev => ({ ...prev, status: "loading", countdown: 5 }));

    const startTime = Date.now();
    const minWaitTime = 2000; // Mínimo 2 segundos

    // Iniciar countdown
    const countdownInterval = setInterval(() => {
      setState(prev => {
        if (prev.countdown > 0) {
          return { ...prev, countdown: prev.countdown - 1 };
        }
        return prev;
      });
    }, 1000);

    try {
      // Chamar edge function que faz o proxy para o webhook n8n
      const { data, error } = await supabase.functions.invoke('calendar-webhook', {
        body: payload
      });

      // Garantir tempo mínimo de espera
      const elapsedTime = Date.now() - startTime;
      if (elapsedTime < minWaitTime) {
        await new Promise(resolve => setTimeout(resolve, minWaitTime - elapsedTime));
      }

      clearInterval(countdownInterval);

      if (error) {
        console.error('[useCalendarAction] Erro na verificação:', error);
        setState(prev => ({
          ...prev,
          status: "error",
          errorMessage: error.message || "Erro ao verificar agenda",
        }));
        return;
      }

      const response = data as any;
      console.log('[useCalendarAction] Resposta do webhook:', response);

      // O edge function pode retornar 2 formatos:
      // 1) Sucesso: JSON do n8n (geralmente sem "success")
      // 2) Erro: { success: false, error: string, details?: string }
      if (response && typeof response === "object" && "success" in response && response.success === false) {
        setState(prev => ({
          ...prev,
          status: "error",
          errorMessage: response.error || response.message || "Webhook retornou erro",
        }));
        return;
      }

      // NOVO: Tratar resposta com action (create/update)
      if (response.action) {
        const action = response.action;
        const isUpdate = action === "update";
        
        // Verificar se temos as datas necessárias
        if (!response.new_start || !response.new_end) {
          setState(prev => ({
            ...prev,
            status: "error",
            errorMessage: "Webhook não retornou datas válidas para o agendamento.",
          }));
          return;
        }

        setState(prev => ({
          ...prev,
          status: "ready",
          action: action,
          message: response.message || null,
          evento: {
            inicio: response.new_start!,
            fim: response.new_end!,
            titulo: response.titulo || "Agendamento",
            descricao: response.descricao || "",
          },
          currentEvento: isUpdate && response.current_start && response.current_end ? {
            inicio: response.current_start,
            fim: response.current_end,
          } : null,
          eventId: response.event_id || null,
          idAgenda: response.id_agenda || null,
        }));
        return;
      }

      // LEGACY: Tratar resposta antiga com conflict/evento
      if (response.conflict) {
        setState(prev => ({
          ...prev,
          status: "conflict",
          conflictMessage: response.conflictMessage || "Horário ocupado, escolha outra data",
        }));
      } else if (response.evento && response.evento.inicio && response.evento.fim) {
        // SÓ mostrar datas se o webhook retornou um evento com datas válidas
        setState(prev => ({
          ...prev,
          status: "ready",
          action: "create",
          evento: {
            inicio: response.evento!.inicio,
            fim: response.evento!.fim,
            titulo: response.evento!.titulo || "Agendamento",
            descricao: response.evento!.descricao || "",
          },
        }));
      } else {
        // Resposta sem evento válido - mostrar erro
        setState(prev => ({
          ...prev,
          status: "error",
          errorMessage: "Webhook não retornou dados de agendamento. Verifique a configuração do n8n.",
        }));
      }
    } catch (err) {
      clearInterval(countdownInterval);
      console.error('[useCalendarAction] Erro:', err);
      setState(prev => ({
        ...prev,
        status: "error",
        errorMessage: "Erro de conexão ao verificar agenda",
      }));
    }
  }, []);

  const confirmCalendar = useCallback(async (payload: CalendarConfirmPayload): Promise<boolean> => {
    setState(prev => ({ ...prev, status: "confirming" }));

    try {
      const { data, error } = await supabase.functions.invoke('calendar-webhook', {
        body: payload
      });

      if (error) {
        console.error('[useCalendarAction] Erro na confirmação:', error);
        toast.error("Erro ao criar agendamento");
        setState(prev => ({ ...prev, status: "error", errorMessage: error.message }));
        return false;
      }

      const response = data as CalendarConfirmResponse;
      console.log('[useCalendarAction] Resposta do confirmed:', response);

      // Verificar se retornou action: "finish" (sucesso)
      if (response && response.action === "finish") {
        const successMsg = response.message || "Operação realizada com sucesso!";
        setState(prev => ({ ...prev, status: "success", successMessage: successMsg }));
        return true;
      }

      // Considera sucesso quando não houver sinal explícito de erro.
      // (n8n pode retornar JSON sem "success")
      const isOk = !(response && typeof response === "object" && "success" in response && response.success === false);

      if (isOk) {
        setState(prev => ({ ...prev, status: "success", successMessage: response?.message || null }));
        const actionLabel = payload.action === "update" ? "atualizado" : "criado";
        toast.success(`Agendamento ${actionLabel} com sucesso!`);
        return true;
      }

      toast.error(response?.message || "Erro ao criar agendamento");
      setState(prev => ({ ...prev, status: "error", errorMessage: response?.message || "Erro desconhecido" }));
      return false;
    } catch (err) {
      console.error('[useCalendarAction] Erro:', err);
      toast.error("Erro de conexão ao criar agendamento");
      setState(prev => ({ ...prev, status: "error", errorMessage: "Erro de conexão" }));
      return false;
    }
  }, []);

  const updateEvento = useCallback((updates: Partial<CalendarActionState['evento']>) => {
    setState(prev => ({
      ...prev,
      evento: prev.evento ? { ...prev.evento, ...updates } : null,
    }));
  }, []);

  return {
    state,
    verifyCalendar,
    confirmCalendar,
    updateEvento,
    resetState,
  };
}
