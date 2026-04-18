import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Limite diário de envios
const LIMITE_DIARIO = 70;

// Timezone offset for Brazil (UTC-3)
const BRAZIL_TZ_OFFSET = -3;

/**
 * Verifica se estamos dentro do horário permitido de envio
 */
function isWithinSendingWindow(horarioInicio: string, horarioFim: string): boolean {
  const nowUtc = new Date();
  const nowBrazil = new Date(nowUtc.getTime() + BRAZIL_TZ_OFFSET * 60 * 60 * 1000);
  
  const [horaInicio, minInicio] = horarioInicio.split(":").map(Number);
  const [horaFim, minFim] = horarioFim.split(":").map(Number);
  
  const currentMinutes = nowBrazil.getHours() * 60 + nowBrazil.getMinutes();
  const inicioMinutes = horaInicio * 60 + minInicio;
  const fimMinutes = horaFim * 60 + minFim;
  
  return currentMinutes >= inicioMinutes && currentMinutes <= fimMinutes;
}

/**
 * Verifica se hoje é um dia permitido para envio (todos os dias por padrão)
 */
function isSendingDay(diasSemana: number[] | null): boolean {
  const nowUtc = new Date();
  const nowBrazil = new Date(nowUtc.getTime() + BRAZIL_TZ_OFFSET * 60 * 60 * 1000);
  const todayDow = nowBrazil.getDay(); // 0 = domingo
  
  // Se não configurado, usa todos os dias (0-6)
  const dias = diasSemana && diasSemana.length > 0 ? diasSemana : [0, 1, 2, 3, 4, 5, 6];
  return dias.includes(todayDow);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("[LOTE-DIARIO] ========== Iniciando processamento automático às 8h ==========");

    // Buscar envios ativos com status 'agendada' ou 'em_andamento' (não pausados)
    const { data: enviosAtivos, error: enviosError } = await supabase
      .from("envios_disparo")
      .select(`
        id,
        campanha_id,
        ativo,
        status,
        enviados,
        sucesso,
        falhas,
        total_leads,
        envios_por_dia,
        dias_semana,
        horario_inicio,
        horario_fim,
        created_by,
        campanhas_disparo (
          id,
          nome,
          mensagem
        ),
        instancias_whatsapp (
          id,
          nome_instancia,
          instancia_id,
          ativo,
          connection_status
        )
      `)
      .eq("ativo", true)
      .in("status", ["agendada", "em_andamento"]);

    if (enviosError) {
      console.error("[LOTE-DIARIO] Erro ao buscar envios:", enviosError);
      throw new Error("Erro ao buscar envios ativos");
    }

    if (!enviosAtivos || enviosAtivos.length === 0) {
      console.log("[LOTE-DIARIO] Nenhum envio ativo encontrado para processar");
      return new Response(
        JSON.stringify({
          success: true,
          message: "Nenhum envio ativo para processar",
          processed: 0
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[LOTE-DIARIO] Encontrados ${enviosAtivos.length} envios ativos para processar`);

    const results = [];

    for (const envio of enviosAtivos) {
      const envioId = envio.id;
      const limiteDia = envio.envios_por_dia || LIMITE_DIARIO;
      const diasSemana = envio.dias_semana as number[] | null;
      const campanha = envio.campanhas_disparo as any;
      const instancia = envio.instancias_whatsapp as any;

      console.log(`[LOTE-DIARIO] Processando envio ${envioId} - Campanha: ${campanha?.nome || 'sem nome'}`);

      // Verificar se hoje é dia de envio para este envio específico
      if (!isSendingDay(diasSemana)) {
        console.log(`[LOTE-DIARIO] Envio ${envioId} - hoje não é dia de envio configurado`);
        results.push({
          envio_id: envioId,
          success: false,
          reason: "Hoje não é dia de envio configurado",
          dias_semana: diasSemana
        });
        continue;
      }

      // Verificar instância ativa e conectada
      if (!instancia?.ativo) {
        console.log(`[LOTE-DIARIO] Envio ${envioId} - instância inativa`);
        results.push({
          envio_id: envioId,
          success: false,
          reason: "Instância WhatsApp inativa"
        });
        continue;
      }

      if (instancia?.connection_status !== "open" && instancia?.connection_status !== "connected") {
        console.log(`[LOTE-DIARIO] Envio ${envioId} - instância não conectada (${instancia?.connection_status})`);
        results.push({
          envio_id: envioId,
          success: false,
          reason: `Instância não conectada: ${instancia?.connection_status}`
        });
        continue;
      }

      // Contar leads pendentes (enviar, reenviar ou ainda tratando)
      const { count: leadsPendentes, error: countError } = await supabase
        .from("campanha_envios")
        .select("*", { count: "exact", head: true })
        .eq("envio_id", envioId)
        .in("status", ["enviar", "reenviar", "tratando"]);

      if (countError) {
        console.error(`[LOTE-DIARIO] Erro ao contar leads pendentes:`, countError);
        continue;
      }

      if (!leadsPendentes || leadsPendentes === 0) {
        console.log(`[LOTE-DIARIO] Envio ${envioId} - sem leads pendentes, marcando como concluído`);
        
        await supabase
          .from("envios_disparo")
          .update({ 
            status: "concluido",
            concluido_em: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("id", envioId);

        // Notificar criador que o disparo foi concluído
        if (envio.created_by) {
          try {
            await supabase
              .from("notificacoes")
              .insert({
                user_id: envio.created_by,
                tipo: "disparo_massa_concluido",
                titulo: "Disparo em massa concluído",
                mensagem: `Campanha "${campanha?.nome || 'Sem nome'}" finalizou: ${envio.sucesso || 0} enviados, ${envio.falhas || 0} falhas`,
                dados: {
                  envio_id: envioId,
                  campanha_id: envio.campanha_id,
                  total_leads: envio.total_leads,
                  sucesso: envio.sucesso,
                  falhas: envio.falhas
                }
              });
            console.log(`[LOTE-DIARIO] Notificação de conclusão enviada para ${envio.created_by}`);
          } catch (notifError) {
            console.error(`[LOTE-DIARIO] Erro ao criar notificação:`, notifError);
          }
        }

        results.push({
          envio_id: envioId,
          success: true,
          reason: "Todos os leads já foram enviados - concluído",
          total_leads: envio.total_leads,
          sucesso: envio.sucesso,
          falhas: envio.falhas
        });
        continue;
      }

      console.log(`[LOTE-DIARIO] Envio ${envioId}: ${leadsPendentes} leads pendentes, processando lote de ${limiteDia}`);

      // Chamar a edge function processar-envios-massa para este envio
      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/processar-envios-massa`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`
          },
          body: JSON.stringify({
            envio_id: envioId,
            limit: limiteDia
          })
        });

        const responseData = await response.json();

        if (!response.ok) {
          console.error(`[LOTE-DIARIO] Erro ao processar envio ${envioId}:`, responseData);
          
          // Notificar criador sobre erro
          if (envio.created_by) {
            try {
              await supabase
                .from("notificacoes")
                .insert({
                  user_id: envio.created_by,
                  tipo: "disparo_erro",
                  titulo: "Erro no disparo em massa",
                  mensagem: `Campanha "${campanha?.nome || 'Sem nome'}": ${responseData.error || 'erro desconhecido'}`,
                  dados: {
                    envio_id: envioId,
                    campanha_id: envio.campanha_id,
                    erro: responseData.error || response.status
                  }
                });
            } catch (notifError) {
              console.error(`[LOTE-DIARIO] Erro ao criar notificação de erro:`, notifError);
            }
          }
          
          results.push({
            envio_id: envioId,
            success: false,
            reason: `Erro no processamento: ${responseData.error || response.status}`,
            response: responseData
          });
          continue;
        }

        console.log(`[LOTE-DIARIO] Envio ${envioId} processado com sucesso:`, responseData);

        // Notificar sobre resultado do lote (enviados e para reenviar)
        const leadsEnviados = responseData.leads_enviados || 0;
        const leadsInvalidos = responseData.leads_invalidos || 0;
        const leadsReenviar = responseData.leads_reenviar || 0;
        
        if (envio.created_by && (leadsEnviados > 0 || leadsReenviar > 0)) {
          try {
            const tipo = leadsReenviar > 0 ? "disparo_massa_parcial" : "disparo_massa_concluido";
            const titulo = leadsReenviar > 0 
              ? "Lote processado com pendências" 
              : "Lote processado com sucesso";
            const mensagem = leadsReenviar > 0
              ? `${campanha?.nome || 'Campanha'}: ${leadsEnviados} enviados, ${leadsReenviar} para reenvio`
              : `${campanha?.nome || 'Campanha'}: ${leadsEnviados} mensagens enviadas para o n8n`;
            
            await supabase
              .from("notificacoes")
              .insert({
                user_id: envio.created_by,
                tipo,
                titulo,
                mensagem,
                dados: {
                  envio_id: envioId,
                  campanha_id: envio.campanha_id,
                  leads_enviados: leadsEnviados,
                  leads_invalidos: leadsInvalidos,
                  leads_reenviar: leadsReenviar
                }
              });
            console.log(`[LOTE-DIARIO] Notificação de lote enviada para ${envio.created_by}`);
          } catch (notifError) {
            console.error(`[LOTE-DIARIO] Erro ao criar notificação de lote:`, notifError);
          }
        }

        results.push({
          envio_id: envioId,
          success: true,
          leads_processados: leadsEnviados,
          leads_invalidos: leadsInvalidos,
          leads_pendentes: leadsPendentes,
          response: responseData
        });

      } catch (fetchError) {
        console.error(`[LOTE-DIARIO] Erro ao chamar processar-envios-massa:`, fetchError);
        
        // Notificar sobre erro de fetch
        if (envio.created_by) {
          try {
            await supabase
              .from("notificacoes")
              .insert({
                user_id: envio.created_by,
                tipo: "disparo_erro",
                titulo: "Falha no processamento de disparo",
                mensagem: `Campanha "${campanha?.nome || 'Sem nome'}": falha ao processar lote`,
                dados: {
                  envio_id: envioId,
                  erro: fetchError instanceof Error ? fetchError.message : "Erro desconhecido"
                }
              });
          } catch (notifError) {
            console.error(`[LOTE-DIARIO] Erro ao criar notificação de erro:`, notifError);
          }
        }
        
        results.push({
          envio_id: envioId,
          success: false,
          reason: fetchError instanceof Error ? fetchError.message : "Erro ao chamar função de processamento"
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`[LOTE-DIARIO] ========== Concluído: ${successCount}/${enviosAtivos.length} envios processados ==========`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processados ${successCount}/${enviosAtivos.length} envios`,
        total_envios: enviosAtivos.length,
        processados_com_sucesso: successCount,
        results
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[LOTE-DIARIO] Erro geral:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Erro desconhecido"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
