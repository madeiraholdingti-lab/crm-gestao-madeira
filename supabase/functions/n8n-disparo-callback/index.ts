import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Configurações de horário de São Paulo (UTC-3)
const BRAZIL_TZ_OFFSET = -3;
const HORARIO_INICIO_REENVIO = 8;  // 8:00
const HORARIO_FIM_REENVIO = 16;    // 16:00

/**
 * Retorna a data/hora atual em São Paulo
 */
function getBrazilDateTime(): { brazilHour: number; brazilDay: number } {
  const now = new Date();
  // Para obter o dia correto em São Paulo, precisamos considerar o offset
  const utcHour = now.getUTCHours();
  const brazilHour = (utcHour + 24 + BRAZIL_TZ_OFFSET) % 24;
  
  // Ajustar o dia se o offset mudar o dia
  let brazilDate = new Date(now);
  if (utcHour + BRAZIL_TZ_OFFSET < 0) {
    brazilDate.setUTCDate(brazilDate.getUTCDate() - 1);
  }
  const brazilDay = brazilDate.getUTCDay(); // 0 = Domingo, 6 = Sábado
  
  return { brazilHour, brazilDay };
}

/**
 * Verifica se é um dia válido para envio automático (Segunda a Sexta)
 * Sábado (6) e Domingo (0) só permitem disparos manuais
 */
function isDiaValidoParaEnvioAutomatico(diasSemana: number[] | null): boolean {
  const { brazilDay } = getBrazilDateTime();
  
  // Se não tiver dias configurados, usa padrão Segunda-Sexta
  const diasPermitidos = diasSemana && diasSemana.length > 0 ? diasSemana : [1, 2, 3, 4, 5];
  
  const isValid = diasPermitidos.includes(brazilDay);
  console.log(`[N8N-CALLBACK] Dia atual (São Paulo): ${brazilDay} (0=Dom, 6=Sáb) | Dias permitidos: [${diasPermitidos.join(',')}] | Válido: ${isValid}`);
  
  return isValid;
}

/**
 * Verifica se está dentro da janela de reenvio automático (8h-16h São Paulo)
 */
function isDentroJanelaReenvio(): boolean {
  const now = new Date();
  const { brazilHour } = getBrazilDateTime();
  console.log(`[N8N-CALLBACK] Horário atual: ${now.toISOString()} | São Paulo: ${brazilHour}h`);
  return brazilHour >= HORARIO_INICIO_REENVIO && brazilHour < HORARIO_FIM_REENVIO;
}

/**
 * Webhook de callback para o n8n atualizar status dos leads após processamento
 * 
 * Payload para atualização de leads individuais:
 * {
 *   "updates": [
 *     {
 *       "telefone": "5547999999999",
 *       "campanha_id": "uuid",
 *       "envio_id": "uuid",
 *       "status": "enviado" | "erro" | "reenviar" | "NoZap",
 *       "erro": "mensagem de erro opcional",
 *       "wa_message_id": "id da mensagem no whatsapp opcional"
 *     }
 *   ]
 * }
 * 
 * Payload para sinalizar fim do lote (dispara novo lote automaticamente):
 * {
 *   "success": true,
 *   "envio_id": "uuid"
 * }
 */

interface LeadUpdate {
  telefone?: string;
  numero?: string; // Alias para telefone (usado pelo n8n)
  campanha_id?: string;
  envio_id?: string;
  lead_id?: string;
  status: "enviado" | "erro" | "reenviar" | "NoZap" | "pendente";
  erro?: string | null;
  wa_message_id?: string | null;
  data_envio?: string; // Opcional - formato: dd-MM-yyyy ou ISO
}

// Limite de enviados com sucesso por disparo (não mais por dia)
const LIMITE_POR_DISPARO = 350;
// Tamanho do lote enviado ao n8n de cada vez
const BATCH_SIZE = 70;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    console.log("[N8N-CALLBACK] Recebido:", JSON.stringify(body));

    // ============================================================
    // CASO 1: Recebeu {"success": "false"} ou {"success": false} - Falha na instância
    // Opcionalmente pode vir "tranfer": "true" para marcar leads como reenviar
    // ============================================================
    const successValue = body.success;
    const isSuccessFalse = successValue === false || successValue === "false";
    
    if (isSuccessFalse && !body.updates && !body.telefone && !body.lead_id) {
      const hasTranfer = body.tranfer === true || body.tranfer === "true";
      console.log(`[N8N-CALLBACK] ⚠️ ALERTA: success=false recebido! tranfer=${hasTranfer}`);
      
      const envioId = body.envio_id;
      
      if (!envioId) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: "envio_id é obrigatório para processar falha de instância" 
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Se tranfer=true, atualizar os leads com status "enviar" ou "tratando" para "reenviar"
      if (hasTranfer) {
        console.log(`[N8N-CALLBACK] tranfer=true - Atualizando leads 'enviar' e 'tratando' do envio ${envioId}`);
        
        const MAX_TENTATIVAS = 3;
        
        // Buscar leads para verificar tentativas individualmente
        const { data: leadsParaReverter, error: fetchError } = await supabase
          .from("campanha_envios")
          .select("id, tentativas")
          .eq("envio_id", envioId)
          .in("status", ["enviar", "tratando"]);

        if (fetchError) {
          console.error("[N8N-CALLBACK] Erro ao buscar leads:", fetchError);
          return new Response(
            JSON.stringify({ success: false, error: "Erro ao buscar leads" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        let qtdReenviar = 0;
        let qtdErro = 0;

        for (const lead of leadsParaReverter || []) {
          const tentativas = lead.tentativas || 0;
          if (tentativas >= MAX_TENTATIVAS) {
            // Limite atingido - marcar como erro permanente
            await supabase
              .from("campanha_envios")
              .update({ 
                status: "erro",
                erro: `Limite de ${MAX_TENTATIVAS} tentativas excedido`
              })
              .eq("id", lead.id);
            qtdErro++;
          } else {
            // Ainda pode tentar - marcar como reenviar
            await supabase
              .from("campanha_envios")
              .update({ 
                status: "reenviar",
                erro: "Problema na instância - transferido para reenvio"
              })
              .eq("id", lead.id);
            qtdReenviar++;
          }
        }

        console.log(`[N8N-CALLBACK] ${qtdReenviar} leads para reenviar, ${qtdErro} atingiram limite de tentativas`);

        return new Response(
          JSON.stringify({
            success: true,
            message: `tranfer processado: ${qtdReenviar} para reenviar, ${qtdErro} marcados como erro (limite de tentativas)`,
            leads_reenviar: qtdReenviar,
            leads_erro_limite: qtdErro
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Fluxo original: Instância caiu - pausar envio
      console.log("[N8N-CALLBACK] Instância caiu! Pausando envio.");

      // Buscar informações do envio
      const { data: envio, error: envioError } = await supabase
        .from("envios_disparo")
        .select("id, campanha_id, instancia_id, created_by")
        .eq("id", envioId)
        .single();

      if (envioError || !envio) {
        console.error("[N8N-CALLBACK] Erro ao buscar envio:", envioError);
        return new Response(
          JSON.stringify({ success: false, error: "Envio não encontrado" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Buscar nome da instância para a notificação
      let nomeInstancia = "Instância desconhecida";
      if (envio.instancia_id) {
        const { data: instancia } = await supabase
          .from("instancias_whatsapp")
          .select("nome_instancia")
          .eq("id", envio.instancia_id)
          .single();
        
        if (instancia) {
          nomeInstancia = instancia.nome_instancia;
        }
      }

      // Buscar nome da campanha
      let nomeCampanha = "Campanha";
      if (envio.campanha_id) {
        const { data: campanha } = await supabase
          .from("campanhas_disparo")
          .select("nome")
          .eq("id", envio.campanha_id)
          .single();
        
        if (campanha) {
          nomeCampanha = campanha.nome;
        }
      }

      // Marcar leads que estavam "enviar" ou "tratando" - respeitar limite de tentativas
      const MAX_TENTATIVAS_INST = 3;
      const { data: leadsInstCaiu } = await supabase
        .from("campanha_envios")
        .select("id, tentativas")
        .eq("envio_id", envioId)
        .in("status", ["enviar", "tratando"]);

      for (const lead of leadsInstCaiu || []) {
        const tentativas = lead.tentativas || 0;
        if (tentativas >= MAX_TENTATIVAS_INST) {
          await supabase
            .from("campanha_envios")
            .update({ status: "erro", erro: `Limite de ${MAX_TENTATIVAS_INST} tentativas excedido` })
            .eq("id", lead.id);
        } else {
          await supabase
            .from("campanha_envios")
            .update({ status: "reenviar", erro: "Instância caiu durante o envio" })
            .eq("id", lead.id);
        }
      }

      // Pausar o envio E desativar para evitar que o cron pegue novamente
      // O usuário deve usar o botão "Retomar Envios" após reconectar a instância
      await supabase
        .from("envios_disparo")
        .update({
          status: "pausado",
          ativo: false, // CRÍTICO: Impede o cron de reativar automaticamente
          updated_at: new Date().toISOString()
        })
        .eq("id", envioId);

      console.log(`[N8N-CALLBACK] Envio ${envioId} pausado e DESATIVADO (ativo=false). Requer ação manual para retomar.`);

      // NÃO atualizar status da instância - isso vem da Evolution API

      // Criar notificação automática no banco
      const mensagemAlerta = `A instância "${nomeInstancia}" caiu durante o disparo da campanha "${nomeCampanha}". O envio foi pausado automaticamente. Reconecte a instância e retome o disparo.`;
      
      const { error: notifError } = await supabase
        .from("notificacoes")
        .insert({
          user_id: envio.created_by,
          tipo: "instancia_caiu",
          titulo: `🚨 Instância "${nomeInstancia}" desconectada`,
          mensagem: mensagemAlerta,
          dados: {
            envio_id: envioId,
            campanha_id: envio.campanha_id,
            instancia_id: envio.instancia_id,
            nome_instancia: nomeInstancia,
            nome_campanha: nomeCampanha
          }
        });

      if (notifError) {
        console.error("[N8N-CALLBACK] Erro ao criar notificação:", notifError);
      } else {
        console.log("[N8N-CALLBACK] Notificação criada com sucesso");
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "Instância caiu - envio pausado e notificação criada",
          alerta: {
            tipo: "instancia_caiu",
            instancia: nomeInstancia,
            campanha: nomeCampanha,
            envio_id: envioId,
            mensagem: mensagemAlerta
          }
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============================================================
    // CASO 2: Recebeu {"success": true} - Lote foi processado
    // ============================================================
    if (body.success === true && !body.updates && !body.telefone && !body.lead_id) {
      console.log("[N8N-CALLBACK] Recebido sinal de lote concluído");
      
      const envioId = body.envio_id;
      
      if (!envioId) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: "envio_id é obrigatório para processar conclusão do lote" 
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Buscar TODOS os leads deste envio (não só do lote atual)
      // para contar o total acumulado de enviados com sucesso
      const { data: todosLeads, error: todosLeadsError } = await supabase
        .from("campanha_envios")
        .select("id, status")
        .eq("envio_id", envioId);

      if (todosLeadsError) {
        console.error("[N8N-CALLBACK] Erro ao buscar leads do envio:", todosLeadsError);
        throw new Error("Erro ao buscar leads do envio");
      }

      // CRÍTICO: Reverter leads "tratando" que o n8n não processou
      // Isso resolve o problema de leads ficarem presos em "tratando" quando o n8n
      // processa menos leads do que o lote enviado
      const MAX_TENTATIVAS = 3;
      const leadsTratando = (todosLeads || []).filter(l => l.status === "tratando");
      
      if (leadsTratando.length > 0) {
        console.log(`[N8N-CALLBACK] ⚠️ ${leadsTratando.length} leads ainda em 'tratando' após lote concluído. Revertendo...`);
        
        // Buscar tentativas de cada lead tratando
        const { data: leadsTratandoDetalhes } = await supabase
          .from("campanha_envios")
          .select("id, tentativas")
          .eq("envio_id", envioId)
          .eq("status", "tratando");

        let revertidos = 0;
        let erroLimite = 0;
        for (const lead of leadsTratandoDetalhes || []) {
          const tentativas = lead.tentativas || 0;
          if (tentativas >= MAX_TENTATIVAS) {
            await supabase
              .from("campanha_envios")
              .update({ status: "erro", erro: `Limite de ${MAX_TENTATIVAS} tentativas excedido (não processado pelo n8n)` })
              .eq("id", lead.id);
            erroLimite++;
          } else {
            await supabase
              .from("campanha_envios")
              .update({ status: "reenviar", erro: "Não processado pelo n8n neste lote" })
              .eq("id", lead.id);
            revertidos++;
          }
        }
        console.log(`[N8N-CALLBACK] Tratando revertidos: ${revertidos} para reenviar, ${erroLimite} marcados como erro (limite)`);
      }

      // Re-buscar leads após reverter tratando para contagem correta
      const { data: leadsAtualizados } = await supabase
        .from("campanha_envios")
        .select("id, status")
        .eq("envio_id", envioId);

      // Contar status de TODOS os leads do envio
      const contagens = {
        enviado: 0,
        reenviar: 0,
        NoZap: 0,
        erro: 0,
        enviar: 0
      };

      for (const lead of leadsAtualizados || []) {
        if (contagens.hasOwnProperty(lead.status)) {
          contagens[lead.status as keyof typeof contagens]++;
        }
      }

      console.log(`[N8N-CALLBACK] Status TOTAL do envio ${envioId}: enviado=${contagens.enviado}, NoZap=${contagens.NoZap}, reenviar=${contagens.reenviar}, erro=${contagens.erro}, enviar=${contagens.enviar}`);

      // Atualizar contadores do envio com total acumulado
      const { data: envioData, error: updateEnvioError } = await supabase
        .from("envios_disparo")
        .update({
          enviados: contagens.enviado,
          sucesso: contagens.enviado,
          falhas: contagens.NoZap + contagens.erro,
          updated_at: new Date().toISOString()
        })
        .eq("id", envioId)
        .select("campanha_id")
        .single();

      if (updateEnvioError) {
        console.error("[N8N-CALLBACK] Erro ao atualizar contadores:", updateEnvioError);
      }

      // CRÍTICO: Atualizar também os contadores da CAMPANHA (campanhas_disparo)
      // Isso é necessário para que o dashboard mostre os números corretamente
      if (envioData?.campanha_id) {
        // Buscar totais de TODOS os envios desta campanha
        const { data: todosEnviosCampanha, error: campanhaEnviosError } = await supabase
          .from("campanha_envios")
          .select("status")
          .eq("campanha_id", envioData.campanha_id);

        if (!campanhaEnviosError && todosEnviosCampanha) {
          const totalEnviadosCampanha = todosEnviosCampanha.filter(e => e.status === "enviado").length;
          const totalFalhasCampanha = todosEnviosCampanha.filter(e => e.status === "NoZap" || e.status === "erro").length;
          
          const { error: updateCampanhaError } = await supabase
            .from("campanhas_disparo")
            .update({
              enviados: totalEnviadosCampanha,
              sucesso: totalEnviadosCampanha,
              falhas: totalFalhasCampanha,
              updated_at: new Date().toISOString()
            })
            .eq("id", envioData.campanha_id);

          if (updateCampanhaError) {
            console.error("[N8N-CALLBACK] Erro ao atualizar contadores da campanha:", updateCampanhaError);
          } else {
            console.log(`[N8N-CALLBACK] ✅ Campanha ${envioData.campanha_id} atualizada: sucesso=${totalEnviadosCampanha}, falhas=${totalFalhasCampanha}`);
          }
        }
      }

      // Calcular quantos leads ainda faltam para atingir o limite por disparo
      // Fórmula: LIMITE_POR_DISPARO - total_enviados_com_sucesso
      // NoZap não conta como enviado com sucesso (mas também não volta para fila)
      const totalEnviadosSucesso = contagens.enviado;
      const leadsFaltantes = LIMITE_POR_DISPARO - totalEnviadosSucesso;
      
      // Limitar o próximo lote ao BATCH_SIZE (70)
      const proximoLote = Math.min(leadsFaltantes, BATCH_SIZE);

      console.log(`[N8N-CALLBACK] Cálculo: ${LIMITE_POR_DISPARO} limite - ${totalEnviadosSucesso} enviados = ${leadsFaltantes} faltando para o limite (próximo lote: ${proximoLote})`);
      console.log(`[N8N-CALLBACK] Leads disponíveis para envio: ${contagens.enviar} enviar + ${contagens.reenviar} reenviar = ${contagens.enviar + contagens.reenviar}`);

      // Verificar se há leads pendentes para enviar
      const { data: leadsPendentes, error: pendentesError } = await supabase
        .from("campanha_envios")
        .select("id")
        .eq("envio_id", envioId)
        .in("status", ["enviar", "reenviar"])
        .limit(1);

      if (pendentesError) {
        console.error("[N8N-CALLBACK] Erro ao verificar pendentes:", pendentesError);
      }

      const temPendentes = (leadsPendentes && leadsPendentes.length > 0);

      if (leadsFaltantes > 0 && temPendentes) {
        // Buscar dias_semana do envio para validar se é dia permitido
        const { data: envioConfig } = await supabase
          .from("envios_disparo")
          .select("dias_semana")
          .eq("id", envioId)
          .single();

        const diasSemana = envioConfig?.dias_semana || null;

        // VALIDAÇÃO 1: Verificar se é dia da semana permitido
        if (!isDiaValidoParaEnvioAutomatico(diasSemana)) {
          console.log(`[N8N-CALLBACK] ⚠️ Dia não permitido para envio automático (Sábado/Domingo). Novo lote NÃO será disparado.`);
          
          return new Response(
            JSON.stringify({
              success: true,
              message: `Lote processado. Dia não permitido para envio automático. Disparos aos sábados/domingos só podem ser manuais.`,
              status_acumulado: {
                total_enviados: totalEnviadosSucesso,
                limite_disparo: LIMITE_POR_DISPARO,
                faltando: leadsFaltantes,
                leads_pendentes: contagens.enviar + contagens.reenviar,
                nozap: contagens.NoZap,
                reenviar: contagens.reenviar,
                erro: contagens.erro
              },
              motivo_pausa: "dia_nao_permitido",
              dias_permitidos: diasSemana || [1, 2, 3, 4, 5]
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // VALIDAÇÃO 2: Verificar se está dentro da janela de reenvio (8h-16h SP)
        if (!isDentroJanelaReenvio()) {
          console.log(`[N8N-CALLBACK] ⚠️ Fora da janela de reenvio (8h-16h São Paulo). Novo lote NÃO será disparado.`);
          
          return new Response(
            JSON.stringify({
              success: true,
              message: `Lote processado. Fora da janela de reenvio (8h-16h São Paulo). Novo lote não disparado automaticamente.`,
              status_acumulado: {
                total_enviados: totalEnviadosSucesso,
                limite_disparo: LIMITE_POR_DISPARO,
                faltando: leadsFaltantes,
                leads_pendentes: contagens.enviar + contagens.reenviar,
                nozap: contagens.NoZap,
                reenviar: contagens.reenviar,
                erro: contagens.erro
              },
              motivo_pausa: "fora_janela_reenvio",
              janela_permitida: "08:00 às 16:00 (horário de São Paulo)"
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log(`[N8N-CALLBACK] ✅ Dentro da janela de reenvio. Disparando novo lote de ${proximoLote} leads`);

        // Chamar processar-envios-massa para disparar novo lote
        try {
          const response = await fetch(`${supabaseUrl}/functions/v1/processar-envios-massa`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseServiceKey}`
            },
            body: JSON.stringify({
              envio_id: envioId,
              limit: proximoLote // Usa o próximo lote (máximo BATCH_SIZE)
            })
          });

          const responseData = await response.json().catch(() => ({}));
          
          console.log(`[N8N-CALLBACK] Novo lote disparado:`, responseData);

          return new Response(
            JSON.stringify({
              success: true,
              message: `Lote processado. Novo lote de ${proximoLote} leads disparado. Total enviados: ${totalEnviadosSucesso}/${LIMITE_POR_DISPARO}`,
              status_acumulado: {
                total_enviados: totalEnviadosSucesso,
                limite_disparo: LIMITE_POR_DISPARO,
                faltando: leadsFaltantes,
                nozap: contagens.NoZap,
                reenviar: contagens.reenviar,
                erro: contagens.erro
              },
              novo_lote: {
                tamanho: proximoLote,
                response: responseData
              }
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (novoLoteError) {
          console.error("[N8N-CALLBACK] Erro ao disparar novo lote:", novoLoteError);
          
          return new Response(
            JSON.stringify({
              success: true,
              message: "Lote concluído, mas erro ao disparar novo lote",
              status_acumulado: {
                total_enviados: totalEnviadosSucesso,
                limite_disparo: LIMITE_POR_DISPARO
              },
              erro_novo_lote: novoLoteError instanceof Error ? novoLoteError.message : String(novoLoteError)
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else if (!temPendentes) {
        // Não há mais leads pendentes - envio concluído!
        console.log(`[N8N-CALLBACK] Envio ${envioId} concluído! Total enviados: ${totalEnviadosSucesso}. Sem mais leads pendentes.`);

        await supabase
          .from("envios_disparo")
          .update({
            status: "concluido",
            concluido_em: new Date().toISOString()
          })
          .eq("id", envioId);

        return new Response(
          JSON.stringify({
            success: true,
            message: "Envio concluído! Todos os leads foram processados.",
            status_final: {
              total_enviados: totalEnviadosSucesso,
              nozap: contagens.NoZap,
              erro: contagens.erro
            }
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } else {
        // leadsFaltantes <= 0 - Atingiu o limite por disparo!
        console.log(`[N8N-CALLBACK] Limite por disparo atingido! Total enviados: ${totalEnviadosSucesso}/${LIMITE_POR_DISPARO}`);

        // Marcar como concluído (atingiu limite do disparo)
        await supabase
          .from("envios_disparo")
          .update({
            status: "concluido",
            concluido_em: new Date().toISOString()
          })
          .eq("id", envioId);

        return new Response(
          JSON.stringify({
            success: true,
            message: `Limite do disparo atingido! ${totalEnviadosSucesso} mensagens enviadas.`,
            status_final: {
              total_enviados: totalEnviadosSucesso,
              limite_disparo: LIMITE_POR_DISPARO,
              leads_pendentes: contagens.enviar + contagens.reenviar,
              nozap: contagens.NoZap,
              erro: contagens.erro
            }
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ============================================================
    // CASO 3: Atualizações individuais de leads
    // ============================================================

    // ============================================================
    // CASO 2: Atualizações individuais de leads
    // ============================================================
    let updates: LeadUpdate[] = [];
    
    if (Array.isArray(body.updates)) {
      updates = body.updates;
    } else if (body.telefone || body.numero || body.lead_id) {
      // Update único - normaliza 'numero' para 'telefone'
      const normalizedBody = { ...body };
      if (body.numero && !body.telefone) {
        normalizedBody.telefone = body.numero;
      }
      updates = [normalizedBody];
    } else {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Payload inválido. Envie 'updates' (array), campos individuais (telefone/numero, status, etc.), ou {success: true, envio_id: 'uuid'} para sinalizar fim do lote" 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (updates.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "Nenhum update para processar", updated: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[N8N-CALLBACK] Processando ${updates.length} atualizações`);

    const results: any[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const update of updates) {
      try {
        // Normalizar 'numero' para 'telefone' se necessário
        const telefone = update.telefone || update.numero;
        
        // Validar campos obrigatórios
        if (!update.status) {
          results.push({ telefone, success: false, error: "Status é obrigatório" });
          failCount++;
          continue;
        }

        // Processar data_envio se fornecida
        let enviadoEm: string | null = null;
        if (update.status === "enviado") {
          if (update.data_envio) {
            // Tentar parsear formato dd-MM-yyyy
            const match = update.data_envio.match(/^(\d{2})-(\d{2})-(\d{4})$/);
            if (match) {
              const [, day, month, year] = match;
              enviadoEm = new Date(`${year}-${month}-${day}T12:00:00Z`).toISOString();
            } else {
              // Tentar parsear como ISO ou outro formato
              const parsed = new Date(update.data_envio);
              if (!isNaN(parsed.getTime())) {
                enviadoEm = parsed.toISOString();
              } else {
                // Fallback para agora se formato inválido
                enviadoEm = new Date().toISOString();
              }
            }
          } else {
            // Se não forneceu data_envio, usa agora
            enviadoEm = new Date().toISOString();
          }
        }

        // Construir query de busca
        let query = supabase.from("campanha_envios").update({
          status: update.status,
          erro: update.erro || null,
          wa_message_id: update.wa_message_id || null,
          enviado_em: enviadoEm
        });

        // Filtrar por identificadores disponíveis
        if (update.lead_id && update.envio_id) {
          query = query.eq("lead_id", update.lead_id).eq("envio_id", update.envio_id);
        } else if (telefone && update.envio_id) {
          query = query.eq("telefone", telefone).eq("envio_id", update.envio_id);
        } else if (telefone && update.campanha_id) {
          query = query.eq("telefone", telefone).eq("campanha_id", update.campanha_id);
        } else if (update.lead_id) {
          query = query.eq("lead_id", update.lead_id);
        } else if (telefone) {
          query = query.eq("telefone", telefone);
        } else {
          results.push({ 
            telefone, 
            success: false, 
            error: "Identificador obrigatório: telefone/numero ou lead_id" 
          });
          failCount++;
          continue;
        }

        const { error, count } = await query;

        if (error) {
          console.error(`[N8N-CALLBACK] Erro ao atualizar ${telefone}:`, error);
          results.push({ telefone, success: false, error: error.message });
          failCount++;
        } else {
          console.log(`[N8N-CALLBACK] Atualizado ${telefone} -> ${update.status}`);
          
          // Se enviado com sucesso e tem mensagem, salvar na tabela mensagens
          if (update.status === "enviado" && telefone && update.wa_message_id) {
            try {
              // Buscar detalhes do campanha_envio para obter a mensagem
              const { data: envioData } = await supabase
                .from("campanha_envios")
                .select(`
                  id,
                  telefone,
                  envio_id,
                  envios_disparo (
                    campanha_id,
                    campanhas_disparo (
                      mensagem
                    )
                  )
                `)
                .eq("telefone", telefone)
                .eq("envio_id", update.envio_id || "")
                .single();

              const mensagemTexto = (envioData?.envios_disparo as any)?.campanhas_disparo?.mensagem;
              
              if (mensagemTexto) {
                // Buscar ou criar conversa para este número
                // Usa upsert para evitar duplicatas em chamadas concorrentes
                
                // Primeiro buscar conversa existente
                let { data: conversa } = await supabase
                  .from("conversas")
                  .select("id")
                  .eq("numero_contato", telefone)
                  .maybeSingle();

                if (!conversa) {
                  // Criar nova conversa - NÃO criar aqui, deixar para o evolution-webhook
                  // que é o single source of truth para conversas
                  // Isso evita duplicatas quando webhook e callback rodam em paralelo
                  console.log(`[N8N-CALLBACK] Conversa não encontrada para ${telefone} - será criada pelo webhook`);
                }

                if (conversa) {
                  // Inserir mensagem na tabela mensagens
                  const { error: msgError } = await supabase
                    .from("mensagens")
                    .insert({
                      conversa_id: conversa.id,
                      remetente: "atendente",
                      conteudo: mensagemTexto,
                      tipo_mensagem: "texto",
                      wa_message_id: update.wa_message_id,
                      status: "SENT",
                      lida: true
                    });

                  if (msgError) {
                    console.error(`[N8N-CALLBACK] Erro ao salvar mensagem: ${msgError.message}`);
                  } else {
                    console.log(`[N8N-CALLBACK] Mensagem salva para ${telefone} na conversa ${conversa.id}`);
                    
                    // Atualizar última mensagem da conversa
                    await supabase
                      .from("conversas")
                      .update({
                        ultima_mensagem: mensagemTexto.substring(0, 100),
                        ultima_interacao: new Date().toISOString()
                      })
                      .eq("id", conversa.id);
                  }
                }
              }
            } catch (msgSaveError) {
              console.error(`[N8N-CALLBACK] Erro ao salvar mensagem na conversa:`, msgSaveError);
            }
          }
          
          results.push({ telefone, success: true, status: update.status });
          successCount++;
        }
      } catch (itemError) {
        console.error(`[N8N-CALLBACK] Erro ao processar item:`, itemError);
        results.push({ 
          telefone: update.telefone || update.numero, 
          success: false, 
          error: itemError instanceof Error ? itemError.message : "Erro desconhecido" 
        });
        failCount++;
      }
    }

    // Atualizar contadores do envio se tiver envio_id
    const envioIds = [...new Set(updates.filter(u => u.envio_id).map(u => u.envio_id))];
    
    for (const envioId of envioIds) {
      // Buscar contagens atuais
      const { data: contagens } = await supabase
        .from("campanha_envios")
        .select("status")
        .eq("envio_id", envioId);

      if (contagens) {
        const enviados = contagens.filter(c => c.status === "enviado").length;
        const falhas = contagens.filter(c => ["erro", "NoZap"].includes(c.status)).length;
        const sucesso = enviados;

        await supabase
          .from("envios_disparo")
          .update({
            enviados,
            sucesso,
            falhas,
            updated_at: new Date().toISOString()
          })
          .eq("id", envioId);

        console.log(`[N8N-CALLBACK] Contadores atualizados para envio ${envioId}: enviados=${enviados}, sucesso=${sucesso}, falhas=${falhas}`);
      }
    }

    console.log(`[N8N-CALLBACK] Concluído: ${successCount} sucesso, ${failCount} falhas`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processados ${updates.length} updates (${successCount} sucesso, ${failCount} falhas)`,
        updated: successCount,
        failed: failCount,
        results
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[N8N-CALLBACK] Erro geral:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Erro desconhecido"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
