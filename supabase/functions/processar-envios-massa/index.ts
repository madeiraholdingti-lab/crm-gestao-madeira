import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// DDDs válidos do Brasil
const VALID_DDDS = [
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24,
  27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46,
  47, 48, 49,
  51, 53, 54, 55,
  61,
  62, 64,
  63,
  65, 66,
  67,
  68,
  69,
  71, 73, 74, 75, 77,
  79,
  81, 87,
  82,
  83,
  84,
  85, 88,
  86, 89,
  91, 93, 94,
  92, 97,
  95,
  96,
  98, 99,
];

// Tamanho do lote diário
const BATCH_SIZE = 70;

interface PhoneValidationResult {
  isValid: boolean;
  formatted: string;
  error?: string;
}

/**
 * Formata e valida número de celular brasileiro
 */
function formatBrazilianPhone(phone: string): PhoneValidationResult {
  let digits = phone.replace(/\D/g, "");
  
  if (!digits) {
    return { isValid: false, formatted: "", error: "Número vazio" };
  }

  // Remover prefixos de operadora antigos
  if (digits.startsWith("0") && digits.length > 11) {
    digits = digits.substring(1);
  }
  
  while (digits.startsWith("00")) {
    digits = digits.substring(1);
  }
  
  let ddi = "";
  let ddd = "";
  let numero = "";
  
  if (digits.startsWith("55")) {
    ddi = "55";
    const resto = digits.substring(2);
    
    if (resto.length === 10) {
      ddd = resto.substring(0, 2);
      numero = "9" + resto.substring(2);
    } else if (resto.length === 11) {
      ddd = resto.substring(0, 2);
      numero = resto.substring(2);
    } else {
      return { isValid: false, formatted: digits, error: `Número inválido: ${digits.length} dígitos` };
    }
  } else if (digits.length === 10) {
    ddi = "55";
    ddd = digits.substring(0, 2);
    numero = "9" + digits.substring(2);
  } else if (digits.length === 11) {
    ddi = "55";
    ddd = digits.substring(0, 2);
    numero = digits.substring(2);
  } else if (digits.length === 8 || digits.length === 9) {
    return { isValid: false, formatted: digits, error: "Número sem DDD" };
  } else {
    return { isValid: false, formatted: digits, error: `Tamanho inválido: ${digits.length} dígitos` };
  }
  
  const dddNum = parseInt(ddd, 10);
  if (!VALID_DDDS.includes(dddNum)) {
    return { isValid: false, formatted: digits, error: `DDD inválido: ${ddd}` };
  }
  
  if (!numero.startsWith("9")) {
    return { isValid: false, formatted: digits, error: "Número de celular deve começar com 9" };
  }
  
  if (numero.length !== 9) {
    return { isValid: false, formatted: digits, error: `Número deve ter 9 dígitos, tem ${numero.length}` };
  }
  
  const formatted = `${ddi}${ddd}${numero}`;
  return { isValid: true, formatted };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const { envio_id, test_mode, limit } = body;

    // Usar limit do body ou BATCH_SIZE padrão (70)
    const batchLimit = limit || BATCH_SIZE;

    console.log("[ENVIOS-MASSA] Iniciando processamento em lote", { envio_id, test_mode, batchLimit });

    // Buscar configuração global
    const { data: config, error: configError } = await supabase
      .from("config_global")
      .select("webhook_ia_disparos")
      .maybeSingle();

    if (configError) {
      console.error("[ENVIOS-MASSA] Erro ao buscar config:", configError);
      throw new Error("Erro ao buscar configuração global");
    }

    const webhookUrl = config?.webhook_ia_disparos;

    if (!webhookUrl && !test_mode) {
      throw new Error("Webhook de disparos não configurado em Configurações > Apps");
    }

    // Buscar IDs de leads na blacklist para excluí-los
    const { data: blacklistData } = await supabase
      .from("lead_blacklist")
      .select("lead_id");
    
    const blacklistedLeadIds = new Set((blacklistData || []).map(b => b.lead_id));
    console.log(`[ENVIOS-MASSA] ${blacklistedLeadIds.size} leads na blacklist serão ignorados`);

    // Buscar leads pendentes do envio (status = 'enviar' ou 'reenviar')
    // IMPORTANTE: Exclui 'tratando' e 'processando' para evitar reprocessamento
    // em caso de chamadas concorrentes (botão duplo-clique, cron + manual)
    let query = supabase
      .from("campanha_envios")
      .select(`
        id,
        lead_id,
        telefone,
        status,
        tentativas,
        campanha_id,
        envio_id,
        leads (
          id,
          nome,
          tipo_lead,
          especialidade
        ),
        envios_disparo (
          id,
          status,
          campanha_id,
          campanhas_disparo (
            id,
            nome,
            mensagem,
            tipo,
            script_ia_id
          ),
          instancias_whatsapp (
            id,
            nome_instancia,
            instancia_id
          )
        )
      `)
      .in("status", ["enviar", "reenviar"])
      .not("status", "in", '("tratando","processando","enviado")')
      .limit(batchLimit);

    if (envio_id) {
      query = query.eq("envio_id", envio_id);
    }

    const { data: pendentes, error: pendentesError } = await query;

    if (pendentesError) {
      console.error("[ENVIOS-MASSA] Erro ao buscar pendentes:", pendentesError);
      throw new Error("Erro ao buscar leads pendentes");
    }

    // Filtrar leads que estão na blacklist
    const pendentesLimpos = (pendentes || []).filter(item => !blacklistedLeadIds.has(item.lead_id));
    
    // Marcar leads na blacklist como "bloqueado"
    const leadsBlacklisted = (pendentes || []).filter(item => blacklistedLeadIds.has(item.lead_id));
    if (leadsBlacklisted.length > 0) {
      console.log(`[ENVIOS-MASSA] ${leadsBlacklisted.length} leads estão na blacklist - marcando como bloqueado`);
      const idsBlacklisted = leadsBlacklisted.map(l => l.id);
      await supabase
        .from("campanha_envios")
        .update({ 
          status: "bloqueado",
          erro: "Lead na blacklist - não recebe disparos"
        })
        .in("id", idsBlacklisted);
    }

    if (!pendentesLimpos || pendentesLimpos.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Nenhum lead pendente para envio",
          processed: 0,
          blacklisted: leadsBlacklisted.length,
          batch_size: batchLimit,
          leads: []
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[ENVIOS-MASSA] Encontrados ${pendentesLimpos.length} leads pendentes (lote de ${batchLimit}, ${leadsBlacklisted.length} na blacklist)`);

    // Preparar o lote para enviar ao n8n
    const leadsValidos: any[] = [];
    const leadsInvalidos: any[] = [];
    let dadosFixos: any = null;

    const MAX_TENTATIVAS = 3;

    // Números de teste que ignoram guards (limite de tentativas, cooldown, etc.)
    const TEST_BYPASS_NUMBERS = new Set(["5547999758708"]);

    for (const item of pendentesLimpos) {
      // Verificar limite de tentativas
      const tentativasAtuais = (item as any).tentativas || 0;
      const isBypassNumber = TEST_BYPASS_NUMBERS.has(item.telefone);
      if (tentativasAtuais >= MAX_TENTATIVAS && !isBypassNumber) {
        console.warn(`[ENVIOS-MASSA] Lead ${item.lead_id} atingiu limite de ${MAX_TENTATIVAS} tentativas. Marcando como erro.`);
        await supabase
          .from("campanha_envios")
          .update({ 
            status: "erro",
            erro: `Limite de ${MAX_TENTATIVAS} tentativas excedido`
          })
          .eq("id", item.id);
        leadsInvalidos.push({
          lead_id: item.lead_id,
          telefone_original: item.telefone,
          error: `Limite de ${MAX_TENTATIVAS} tentativas excedido`
        });
        continue;
      }

      const lead = item.leads as any;
      const envio = item.envios_disparo as any;
      const campanha = envio?.campanhas_disparo;
      const instancia = envio?.instancias_whatsapp;

      // Formatar número
      const phoneResult = formatBrazilianPhone(item.telefone);

      if (!phoneResult.isValid) {
        console.warn(`[ENVIOS-MASSA] Número inválido para lead ${item.lead_id}: ${phoneResult.error}`);
        
        // Marcar como NoZap
        await supabase
          .from("campanha_envios")
          .update({ 
            status: "NoZap",
            erro: `Número inválido: ${phoneResult.error}`
          })
          .eq("id", item.id);

        leadsInvalidos.push({
          lead_id: item.lead_id,
          telefone_original: item.telefone,
          error: phoneResult.error
        });
        continue;
      }

      // Adicionar ao lote válido (apenas dados que variam por lead)
      leadsValidos.push({
        campanha_envio_id: item.id,
        lead_id: item.lead_id,
        nome: lead?.nome || null,
        numero: phoneResult.formatted,
        telefone_original: item.telefone,
        tipo_lead: lead?.tipo_lead || null,
        especialidade: lead?.especialidade || null,
        status_anterior: item.status,
      });

      // Capturar dados fixos do primeiro item válido
      if (!dadosFixos) {
        dadosFixos = {
          campanha: {
            id: item.campanha_id,
            nome: campanha?.nome || null,
            tipo: campanha?.tipo || null,
            mensagem: campanha?.mensagem || null,
            script_ia_id: campanha?.script_ia_id || null,
          },
          instancia: {
            nome: instancia?.nome_instancia || null,
            id: instancia?.instancia_id || null,
          },
        };
      }
    }

    if (leadsValidos.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: `Nenhum lead válido no lote. ${leadsInvalidos.length} inválidos.`,
          processed: 0,
          invalidos: leadsInvalidos.length,
          batch_size: batchLimit
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Marcar todos os leads válidos como "tratando" e incrementar tentativas
    const idsParaProcessar = leadsValidos.map(l => l.campanha_envio_id);
    
    // Incrementar tentativas para cada lead antes de enviar
    for (const id of idsParaProcessar) {
      await supabase
        .from("campanha_envios")
        .update({ tentativas: ((pendentesLimpos.find(p => p.id === id) as any)?.tentativas || 0) + 1 })
        .eq("id", id);
    }
    
    // Update em lote para status
    await supabase
      .from("campanha_envios")
      .update({ status: "tratando" })
      .in("id", idsParaProcessar);

    console.log(`[ENVIOS-MASSA] Marcados ${idsParaProcessar.length} leads como 'tratando'`);

    if (test_mode) {
      // Em modo teste, retornar o payload que seria enviado
      return new Response(
        JSON.stringify({
          success: true,
          test_mode: true,
          message: `Modo teste: ${leadsValidos.length} leads prontos para envio`,
          batch_size: batchLimit,
          leads_validos: leadsValidos.length,
          leads_invalidos: leadsInvalidos.length,
          payload: {
            ...dadosFixos,
            envio_id: envio_id || null,
            callback_url: `${supabaseUrl}/functions/v1/n8n-disparo-callback`,
            total: leadsValidos.length,
            lote: leadsValidos,
          }
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Enviar LOTE COMPLETO para o webhook do n8n
    try {
      console.log(`[ENVIOS-MASSA] Enviando lote de ${leadsValidos.length} leads para webhook: ${webhookUrl}`);
      
      const payload = {
        ...dadosFixos,
        envio_id: envio_id || null,
        callback_url: `${supabaseUrl}/functions/v1/n8n-disparo-callback`,
        total: leadsValidos.length,
        lote: leadsValidos,
      };

      // Retry com backoff para lidar com falhas temporárias de DNS no edge runtime
      const MAX_RETRIES = 3;
      let response: Response | null = null;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          console.log(`[ENVIOS-MASSA] Tentativa ${attempt}/${MAX_RETRIES} de envio ao webhook`);
          response = await fetch(webhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
          });
          lastError = null;
          break; // Sucesso, sair do loop
        } catch (fetchErr) {
          lastError = fetchErr as Error;
          console.warn(`[ENVIOS-MASSA] Tentativa ${attempt} falhou: ${lastError.message}`);
          if (attempt < MAX_RETRIES) {
            const delay = attempt * 2000; // 2s, 4s
            console.log(`[ENVIOS-MASSA] Aguardando ${delay}ms antes de retry...`);
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }

      if (lastError || !response) {
        throw lastError || new Error("Falha ao conectar ao webhook após retries");
      }

      const responseText = await response.text();
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = { raw: responseText };
      }

      if (!response.ok) {
        console.error(`[ENVIOS-MASSA] Erro do webhook: ${response.status}`, responseText);
        
        // Reverter status para 'reenviar' em caso de erro no webhook
        await supabase
          .from("campanha_envios")
          .update({ 
            status: "reenviar",
            erro: `Webhook retornou ${response.status}: ${responseText.substring(0, 200)}`
          })
          .in("id", idsParaProcessar);

        return new Response(
          JSON.stringify({
            success: false,
            error: `Webhook retornou ${response.status}`,
            message: responseText.substring(0, 500),
            leads_afetados: idsParaProcessar.length
          }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[ENVIOS-MASSA] Resposta do webhook:`, responseData);

      // IMPORTANTE: Se o n8n retornou success=false com tranfer=true, reverter leads para reenviar
      const successValue = responseData?.success;
      const isSuccessFalse = successValue === false || successValue === "false";
      const hasTranfer = responseData?.tranfer === true || responseData?.tranfer === "true";

      if (isSuccessFalse && hasTranfer) {
        console.log(`[ENVIOS-MASSA] ⚠️ n8n retornou success=false com tranfer=true. Revertendo ${idsParaProcessar.length} leads para 'reenviar'`);
        
        const { error: revertError } = await supabase
          .from("campanha_envios")
          .update({ 
            status: "reenviar",
            erro: "Problema na instância - transferido para reenvio"
          })
          .in("id", idsParaProcessar);

        if (revertError) {
          console.error("[ENVIOS-MASSA] Erro ao reverter leads:", revertError);
        } else {
          console.log(`[ENVIOS-MASSA] ${idsParaProcessar.length} leads revertidos para 'reenviar'`);
        }

        return new Response(
          JSON.stringify({
            success: false,
            message: `Instância com problema. ${idsParaProcessar.length} leads revertidos para reenviar.`,
            batch_size: batchLimit,
            leads_revertidos: idsParaProcessar.length,
            webhook_response: responseData
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[ENVIOS-MASSA] Lote enviado com sucesso. Aguardando callback do n8n.`);

      // Atualizar envio com timestamp de iniciado
      if (envio_id) {
        await supabase
          .from("envios_disparo")
          .update({ 
            status: "em_andamento",
            iniciado_em: new Date().toISOString()
          })
          .eq("id", envio_id);
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: `Lote de ${leadsValidos.length} leads enviado ao n8n. Aguardando callback.`,
          batch_size: batchLimit,
          leads_enviados: leadsValidos.length,
          leads_invalidos: leadsInvalidos.length,
          webhook_response: responseData
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } catch (webhookError) {
      console.error(`[ENVIOS-MASSA] Erro ao chamar webhook:`, webhookError);
      
      // Reverter status para 'reenviar'
      await supabase
        .from("campanha_envios")
        .update({ 
          status: "reenviar",
          erro: webhookError instanceof Error ? webhookError.message : String(webhookError)
        })
        .in("id", idsParaProcessar);

      return new Response(
        JSON.stringify({
          success: false,
          error: webhookError instanceof Error ? webhookError.message : "Erro desconhecido ao chamar webhook"
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

  } catch (error) {
    console.error("[ENVIOS-MASSA] Erro geral:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Erro desconhecido"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
