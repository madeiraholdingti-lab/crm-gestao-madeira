import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Timezone offset for Brazil (UTC-3) in hours
const BRAZIL_TZ_OFFSET = -3;

/**
 * Calcula o próximo horário de execução considerando timezone Brasil (UTC-3)
 */
function calculateNextRunBrazil(
  frequency: string,
  sendTime: string, // formato HH:MM:SS ou HH:MM
  weekDays: number[] | null,
  monthDay: number | null
): string | null {
  // Obter hora atual no Brasil
  const nowUtc = new Date();
  const nowBrazil = new Date(nowUtc.getTime() + BRAZIL_TZ_OFFSET * 60 * 60 * 1000);
  
  const [hours, minutes] = sendTime.split(":").map(Number);
  
  if (frequency === "once") {
    // Para disparos únicos, não recalcular - já foi enviado
    return null;
  }
  
  if (frequency === "daily") {
    // Próximo dia no horário especificado
    const nextRun = new Date(nowBrazil);
    nextRun.setHours(hours, minutes, 0, 0);
    
    // Se já passou hoje, agenda para amanhã
    if (nextRun <= nowBrazil) {
      nextRun.setDate(nextRun.getDate() + 1);
    }
    
    // Converter de volta para UTC
    const nextRunUtc = new Date(nextRun.getTime() - BRAZIL_TZ_OFFSET * 60 * 60 * 1000);
    return nextRunUtc.toISOString();
  }
  
  if (frequency === "weekly" && weekDays && weekDays.length > 0) {
    const currentDayOfWeek = nowBrazil.getDay(); // 0 = domingo
    const sortedDays = [...weekDays].sort((a, b) => a - b);
    
    // Encontrar o próximo dia válido
    let daysToAdd = 7; // máximo uma semana
    for (const day of sortedDays) {
      let diff = day - currentDayOfWeek;
      if (diff < 0) diff += 7;
      
      // Se for hoje, verificar se o horário já passou
      if (diff === 0) {
        const todayAtTime = new Date(nowBrazil);
        todayAtTime.setHours(hours, minutes, 0, 0);
        if (todayAtTime > nowBrazil) {
          daysToAdd = 0;
          break;
        }
        // Já passou, continuar procurando
        continue;
      }
      
      if (diff < daysToAdd) {
        daysToAdd = diff;
      }
    }
    
    // Se não encontrou nenhum dia futuro esta semana, pegar o primeiro da próxima
    if (daysToAdd === 7) {
      const firstDay = sortedDays[0];
      daysToAdd = firstDay - currentDayOfWeek;
      if (daysToAdd <= 0) daysToAdd += 7;
    }
    
    const nextRun = new Date(nowBrazil);
    nextRun.setDate(nextRun.getDate() + daysToAdd);
    nextRun.setHours(hours, minutes, 0, 0);
    
    // Converter de volta para UTC
    const nextRunUtc = new Date(nextRun.getTime() - BRAZIL_TZ_OFFSET * 60 * 60 * 1000);
    return nextRunUtc.toISOString();
  }
  
  if (frequency === "monthly" && monthDay) {
    const nextRun = new Date(nowBrazil);
    nextRun.setHours(hours, minutes, 0, 0);
    
    // Tentar este mês
    const lastDayOfMonth = new Date(nextRun.getFullYear(), nextRun.getMonth() + 1, 0).getDate();
    const targetDay = Math.min(monthDay, lastDayOfMonth);
    nextRun.setDate(targetDay);
    
    // Se já passou, ir para o próximo mês
    if (nextRun <= nowBrazil) {
      nextRun.setMonth(nextRun.getMonth() + 1);
      const lastDayNextMonth = new Date(nextRun.getFullYear(), nextRun.getMonth() + 1, 0).getDate();
      nextRun.setDate(Math.min(monthDay, lastDayNextMonth));
    }
    
    // Converter de volta para UTC
    const nextRunUtc = new Date(nextRun.getTime() - BRAZIL_TZ_OFFSET * 60 * 60 * 1000);
    return nextRunUtc.toISOString();
  }
  
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ==================== VERIFICAÇÃO RÁPIDA: há algo para processar? ====================
    const now = new Date().toISOString();

    // Query leve: só verifica se existem envios em massa pendentes
    const { data: enviosMassa, error: enviosMassaError } = await supabase
      .from("envios_disparo")
      .select("id, campanha_id, envios_por_dia")
      .eq("ativo", true)
      .eq("status", "em_andamento")
      .lte("proximo_envio_em", now);

    if (enviosMassaError) {
      console.error("[DISPAROS] Erro ao buscar envios em massa:", enviosMassaError);
    }

    // Query leve: só verifica se existem disparos agendados pendentes
    const { count: disparosCount } = await supabase
      .from("scheduled_messages")
      .select("id", { count: 'exact', head: true })
      .eq("active", true)
      .lte("next_run_at", now);

    const temEnviosMassa = (enviosMassa?.length || 0) > 0;
    const temDisparos = (disparosCount || 0) > 0;

    // EARLY RETURN: nada para processar — sair rápido sem gastar mais recursos
    if (!temEnviosMassa && !temDisparos) {
      return new Response(
        JSON.stringify({ success: true, message: "Nada para processar", envios_massa: 0, disparos: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    console.log(`[DISPAROS] Pendentes: ${enviosMassa?.length || 0} envios em massa, ${disparosCount || 0} disparos agendados`);

    // Só busca config quando realmente vai enviar algo
    const { data: config } = await supabase
      .from("config_global")
      .select("evolution_base_url, evolution_api_key, webhook_ia_disparos")
      .maybeSingle();

    if (!config) {
      throw new Error("Configuração global não encontrada");
    }

    const evolutionBaseUrl = config.evolution_base_url;
    const evolutionApiKey = config.evolution_api_key || Deno.env.get("EVOLUTION_API_KEY");

    // ==================== PARTE 1: DISPAROS EM MASSA ====================
    console.log(`[DISPAROS] Encontrados ${enviosMassa?.length || 0} envios em massa prontos`);

    // Processar cada envio em massa chamando processar-envios-massa
    for (const envioMassa of enviosMassa || []) {
      try {
        console.log(`[DISPAROS] Processando envio em massa ${envioMassa.id}`);
        
        // Chamar a edge function de processamento de envios em massa
        // Envia o lote completo (até 70 leads) - o n8n vai processar item por item
        const response = await fetch(`${supabaseUrl}/functions/v1/processar-envios-massa`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`
          },
          body: JSON.stringify({ 
            envio_id: envioMassa.id
            // Sem limit - usa BATCH_SIZE padrão (70)
          })
        });

        const result = await response.json();
        console.log(`[DISPAROS] Resultado envio ${envioMassa.id}:`, result);

        // Calcular próximo intervalo (10-15 minutos)
        const intervaloMin = 10;
        const intervaloMax = 15;
        const intervaloMinutos = Math.floor(Math.random() * (intervaloMax - intervaloMin + 1)) + intervaloMin;
        const proximoEnvio = new Date(Date.now() + intervaloMinutos * 60 * 1000);

        // Atualizar próximo envio
        await supabase
          .from("envios_disparo")
          .update({ 
            proximo_envio_em: proximoEnvio.toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("id", envioMassa.id);

        console.log(`[DISPAROS] Próximo envio agendado para ${proximoEnvio.toISOString()}`);

      } catch (err) {
        console.error(`[DISPAROS] Erro ao processar envio em massa ${envioMassa.id}:`, err);
      }
    }

    // ==================== PARTE 2: DISPAROS AGENDADOS (scheduled_messages) ====================
    const { data: disparos, error: disparosError } = await supabase
      .from("scheduled_messages")
      .select(`
        *,
        instancias_whatsapp (
          id,
          instancia_id,
          nome_instancia,
          ativo
        ),
        contacts (
          id,
          name,
          phone
        )
      `)
      .eq("active", true)
      .lte("next_run_at", now)
      .order("next_run_at", { ascending: true });

    if (disparosError) {
      throw disparosError;
    }

    console.log(`[DISPAROS] Encontrados ${disparos?.length || 0} disparos agendados prontos`);

    const results = [];

    for (const disparo of disparos || []) {
      try {
        const instancia = disparo.instancias_whatsapp;
        
        // Calcular próximo agendamento com timezone Brasil
        const nextRun = calculateNextRunBrazil(
          disparo.frequency,
          disparo.send_time,
          disparo.week_days,
          disparo.month_day
        );
        
        console.log(`[DISPAROS] Disparo ${disparo.id}: frequency=${disparo.frequency}, send_time=${disparo.send_time}, nextRun=${nextRun}`);

        if (!instancia || !instancia.ativo) {
          console.warn(`[DISPAROS] Instância inativa para disparo ${disparo.id} - reagendando para ${nextRun}`);
          await supabase
            .from("scheduled_messages_log")
            .insert({
              scheduled_message_id: disparo.id,
              success: false,
              error_message: `Instância WhatsApp "${instancia?.nome_instancia || 'desconhecida'}" inativa ou não encontrada`,
            });
          
          // Atualizar next_run_at mesmo em falha para evitar loop infinito
          const updateData: Record<string, unknown> = {
            last_run_at: new Date().toISOString(),
          };
          
          if (disparo.frequency === "once") {
            updateData.active = false;
          } else if (nextRun) {
            updateData.next_run_at = nextRun;
          }
          
          await supabase
            .from("scheduled_messages")
            .update(updateData)
            .eq("id", disparo.id);
            
          results.push({
            disparo_id: disparo.id,
            success: false,
            message: `Instância inativa - reagendado para ${nextRun}`,
          });
          continue;
        }

        // Enviar mensagem via Evolution API
        const sendUrl = `${evolutionBaseUrl}/message/sendText/${encodeURIComponent(instancia.nome_instancia)}`;
        const payload = {
          number: disparo.phone,
          text: disparo.message_text,
        };

        console.log(`[DISPAROS] Enviando para ${disparo.phone} via instância ${instancia.nome_instancia}`);

        const response = await fetch(sendUrl, {
          method: "POST",
          headers: {
            apikey: evolutionApiKey!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const responseBody = await response.text();
        let responseData;
        try {
          responseData = JSON.parse(responseBody);
        } catch (_e) {
          console.warn("[DISPAROS] Resposta não é JSON válido");
        }

        if (!response.ok) {
          console.error(`[DISPAROS] Erro ao enviar: ${response.status} - ${responseBody}`);
          await supabase
            .from("scheduled_messages_log")
            .insert({
              scheduled_message_id: disparo.id,
              success: false,
              error_message: `Erro Evolution API: ${response.status} - ${responseBody.substring(0, 200)}`,
            });
          
          // Atualizar para evitar loop infinito mesmo em erro
          const updateData: Record<string, unknown> = {
            last_run_at: new Date().toISOString(),
          };
          if (disparo.frequency === "once") {
            updateData.active = false;
          } else if (nextRun) {
            updateData.next_run_at = nextRun;
          }
          await supabase
            .from("scheduled_messages")
            .update(updateData)
            .eq("id", disparo.id);
            
          results.push({
            disparo_id: disparo.id,
            success: false,
            error: `Evolution API: ${response.status}`,
          });
          continue;
        }

        // Log de sucesso
        const waMessageId = responseData?.key?.id || responseData?.message?.key?.id;
        await supabase
          .from("scheduled_messages_log")
          .insert({
            scheduled_message_id: disparo.id,
            success: true,
            wa_message_id: waMessageId,
          });

        // Atualizar disparo
        const updateData: Record<string, unknown> = {
          last_run_at: new Date().toISOString(),
        };

        // Se for 'once', desativar após o envio
        if (disparo.frequency === "once") {
          updateData.active = false;
        } else if (nextRun) {
          updateData.next_run_at = nextRun;
        }

        await supabase
          .from("scheduled_messages")
          .update(updateData)
          .eq("id", disparo.id);

        // Enviar notificação de sucesso para o criador do disparo
        if (disparo.created_by) {
          try {
            await supabase
              .from("notificacoes")
              .insert({
                user_id: disparo.created_by,
                tipo: "disparo_agendado_sucesso",
                titulo: "Disparo agendado enviado",
                mensagem: `"${disparo.nome_disparo}" foi enviado para ${disparo.phone}`,
                dados: {
                  disparo_id: disparo.id,
                  telefone: disparo.phone,
                  proximo_envio: nextRun
                }
              });
            console.log(`[DISPAROS] Notificação enviada para usuário ${disparo.created_by}`);
          } catch (notifError) {
            console.error(`[DISPAROS] Erro ao criar notificação:`, notifError);
          }
        }

        results.push({
          disparo_id: disparo.id,
          success: true,
          message: `Enviado para ${disparo.phone}`,
          next_run: nextRun,
        });

        console.log(`[DISPAROS] Sucesso para disparo ${disparo.id}, próximo: ${nextRun}`);
      } catch (error) {
        console.error(`[DISPAROS] Erro ao processar disparo ${disparo.id}:`, error);
        
        await supabase
          .from("scheduled_messages_log")
          .insert({
            scheduled_message_id: disparo.id,
            success: false,
            error_message: error instanceof Error ? error.message : String(error),
          });

        results.push({
          disparo_id: disparo.id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // ==================== PARTE 3: FOLLOW-UPS DE CONVERSAS ====================
    const { data: followUps } = await supabase
      .from("conversas")
      .select("id, responsavel_atual, nome_contato, numero_contato, follow_up_nota")
      .not("follow_up_em", "is", null)
      .lte("follow_up_em", now);

    let followUpsProcessados = 0;

    for (const fu of followUps || []) {
      try {
        if (!fu.responsavel_atual) continue;

        // Buscar dados do responsável para enviar WA
        const { data: profile } = await supabase
          .from("profiles")
          .select("telefone_contato, instancia_padrao_id, nome")
          .eq("id", fu.responsavel_atual)
          .single();

        if (profile?.telefone_contato && profile?.instancia_padrao_id) {
          // Buscar instância para envio
          const { data: instancia } = await supabase
            .from("instancias_whatsapp")
            .select("instancia_id")
            .eq("id", profile.instancia_padrao_id)
            .single();

          if (instancia) {
            const nota = fu.follow_up_nota ? `\n📝 ${fu.follow_up_nota}` : "";
            const mensagem = `⏰ Follow-up: ${fu.nome_contato || fu.numero_contato}${nota}\n\nEssa conversa foi marcada para acompanhamento agora.`;

            await fetch(`${evolutionBaseUrl}/message/sendText/${instancia.instancia_id}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "apikey": evolutionApiKey || "",
              },
              body: JSON.stringify({
                number: profile.telefone_contato,
                text: mensagem,
              }),
            });
          }
        }

        // Criar notificação in-app
        await supabase.from("notificacoes").insert({
          user_id: fu.responsavel_atual,
          tipo: "follow_up",
          titulo: `⏰ Follow-up: ${fu.nome_contato || fu.numero_contato}`,
          mensagem: fu.follow_up_nota || "Conversa marcada para acompanhamento",
          dados: { conversa_id: fu.id },
        });

        // Limpar follow-up após processar
        await supabase
          .from("conversas")
          .update({ follow_up_em: null })
          .eq("id", fu.id);

        followUpsProcessados++;
        console.log(`[FOLLOW-UP] Notificado: ${fu.nome_contato || fu.numero_contato} → ${profile?.nome || fu.responsavel_atual}`);
      } catch (err) {
        console.error(`[FOLLOW-UP] Erro em ${fu.id}:`, err);
      }
    }

    if (followUpsProcessados > 0) {
      console.log(`[FOLLOW-UP] ${followUpsProcessados} follow-ups processados`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        follow_ups: followUpsProcessados,
        results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[DISPAROS] Erro geral:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
