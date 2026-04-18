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

// Configurações de envio
const BATCH_SIZE = 70;
const MIN_DELAY_MS = 10000; // 10 segundos
const MAX_DELAY_MS = 15000; // 15 segundos

interface PhoneValidationResult {
  isValid: boolean;
  formatted: string;
  error?: string;
}

function formatBrazilianPhone(phone: string): PhoneValidationResult {
  let digits = phone.replace(/\D/g, "");
  
  if (!digits) {
    return { isValid: false, formatted: "", error: "Número vazio" };
  }

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

function randomDelay(): number {
  return Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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

    const batchLimit = limit || BATCH_SIZE;

    console.log("[DISPARO-DIRETO] Iniciando processamento", { envio_id, test_mode, batchLimit });

    // Buscar configuração global
    const { data: config, error: configError } = await supabase
      .from("config_global")
      .select("evolution_base_url, evolution_api_key")
      .maybeSingle();

    if (configError) {
      console.error("[DISPARO-DIRETO] Erro ao buscar config:", configError);
      throw new Error("Erro ao buscar configuração global");
    }

    const evolutionBaseUrl = config?.evolution_base_url;
    const evolutionApiKey = config?.evolution_api_key || Deno.env.get("EVOLUTION_API_KEY");

    if (!evolutionBaseUrl || !evolutionApiKey) {
      throw new Error("Evolution API não configurada em Configurações > Geral");
    }

    // Buscar leads pendentes do envio
    let query = supabase
      .from("campanha_envios")
      .select(`
        id,
        lead_id,
        telefone,
        status,
        campanha_id,
        envio_id,
        leads (
          id,
          nome,
          email,
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
            tipo
          ),
          instancias_whatsapp (
            id,
            nome_instancia,
            instancia_id
          )
        )
      `)
      .in("status", ["enviar", "reenviar"])
      .limit(batchLimit);

    if (envio_id) {
      query = query.eq("envio_id", envio_id);
    }

    const { data: pendentes, error: pendentesError } = await query;

    if (pendentesError) {
      console.error("[DISPARO-DIRETO] Erro ao buscar pendentes:", pendentesError);
      throw new Error("Erro ao buscar leads pendentes");
    }

    if (!pendentes || pendentes.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Nenhum lead pendente para envio",
          processed: 0,
          enviados: 0,
          falhas: 0
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[DISPARO-DIRETO] Encontrados ${pendentes.length} leads pendentes`);

    // Marcar como 'tratando' (consistente com processar-envios-massa)
    const idsParaProcessar = pendentes.map(p => p.id);
    await supabase
      .from("campanha_envios")
      .update({ status: "tratando" })
      .in("id", idsParaProcessar);

    // Atualizar status do envio
    if (envio_id) {
      await supabase
        .from("envios_disparo")
        .update({ 
          status: "em_andamento",
          iniciado_em: new Date().toISOString()
        })
        .eq("id", envio_id);
    }

    if (test_mode) {
      // Em modo teste, retornar preview
      const preview = pendentes.slice(0, 5).map(item => {
        const lead = item.leads as any;
        const envio = item.envios_disparo as any;
        const campanha = envio?.campanhas_disparo;
        return {
          lead_id: item.lead_id,
          nome: lead?.nome,
          telefone: item.telefone,
          mensagem: campanha?.mensagem?.substring(0, 100) + "..."
        };
      });

      // Reverter status
      await supabase
        .from("campanha_envios")
        .update({ status: "enviar" })
        .in("id", idsParaProcessar);

      return new Response(
        JSON.stringify({
          success: true,
          test_mode: true,
          message: `Modo teste: ${pendentes.length} leads seriam enviados`,
          preview
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Processar cada lead
    let enviados = 0;
    let falhas = 0;
    const resultados: any[] = [];

    for (let i = 0; i < pendentes.length; i++) {
      const item = pendentes[i];
      const lead = item.leads as any;
      const envio = item.envios_disparo as any;
      const campanha = envio?.campanhas_disparo;
      const instancia = envio?.instancias_whatsapp;

      if (!instancia?.nome_instancia || !campanha?.mensagem) {
        console.warn(`[DISPARO-DIRETO] Lead ${item.lead_id} sem instância ou mensagem`);
        await supabase
          .from("campanha_envios")
          .update({ 
            status: "erro",
            erro: "Instância ou mensagem não configurada"
          })
          .eq("id", item.id);
        falhas++;
        continue;
      }

      // Formatar número
      const phoneResult = formatBrazilianPhone(item.telefone);

      if (!phoneResult.isValid) {
        console.warn(`[DISPARO-DIRETO] Número inválido: ${phoneResult.error}`);
        await supabase
          .from("campanha_envios")
          .update({ 
            status: "NoZap",
            erro: `Número inválido: ${phoneResult.error}`
          })
          .eq("id", item.id);
        falhas++;
        continue;
      }

      // Personalizar mensagem
      let mensagemFinal = campanha.mensagem;
      if (lead?.nome) {
        mensagemFinal = mensagemFinal.replace(/\{nome\}/gi, lead.nome);
      }

      // Enviar mensagem via Evolution API
      try {
        const sendUrl = `${evolutionBaseUrl}/message/sendText/${encodeURIComponent(instancia.nome_instancia)}`;
        
        console.log(`[DISPARO-DIRETO] Enviando para ${phoneResult.formatted} via ${instancia.nome_instancia}`);

        const response = await fetch(sendUrl, {
          method: "POST",
          headers: {
            "apikey": evolutionApiKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            number: phoneResult.formatted,
            text: mensagemFinal
          })
        });

        const responseText = await response.text();
        let responseData;
        try {
          responseData = JSON.parse(responseText);
        } catch {
          responseData = { raw: responseText };
        }

        if (response.ok) {
          const waMessageId = responseData?.key?.id || responseData?.message?.key?.id;
          
          await supabase
            .from("campanha_envios")
            .update({ 
              status: "enviado",
              enviado_em: new Date().toISOString(),
              wa_message_id: waMessageId,
              erro: null
            })
            .eq("id", item.id);

          enviados++;
          console.log(`[DISPARO-DIRETO] ✓ Enviado para ${lead?.nome || phoneResult.formatted}`);

          resultados.push({
            lead_id: item.lead_id,
            nome: lead?.nome,
            telefone: phoneResult.formatted,
            status: "enviado",
            wa_message_id: waMessageId
          });
        } else {
          const errorMsg = responseData?.message || responseText.substring(0, 200);
          
          await supabase
            .from("campanha_envios")
            .update({ 
              status: "erro",
              erro: `Evolution API: ${response.status} - ${errorMsg}`
            })
            .eq("id", item.id);

          falhas++;
          console.error(`[DISPARO-DIRETO] ✗ Erro para ${lead?.nome}: ${errorMsg}`);

          resultados.push({
            lead_id: item.lead_id,
            nome: lead?.nome,
            telefone: phoneResult.formatted,
            status: "erro",
            erro: errorMsg
          });
        }
      } catch (sendError) {
        const errorMsg = sendError instanceof Error ? sendError.message : String(sendError);
        
        await supabase
          .from("campanha_envios")
          .update({ 
            status: "erro",
            erro: errorMsg
          })
          .eq("id", item.id);

        falhas++;
        console.error(`[DISPARO-DIRETO] ✗ Exceção para ${lead?.nome}: ${errorMsg}`);

        resultados.push({
          lead_id: item.lead_id,
          nome: lead?.nome,
          telefone: item.telefone,
          status: "erro",
          erro: errorMsg
        });
      }

      // Aguardar intervalo aleatório entre envios (exceto no último)
      if (i < pendentes.length - 1) {
        const delay = randomDelay();
        console.log(`[DISPARO-DIRETO] Aguardando ${delay}ms antes do próximo envio...`);
        await sleep(delay);
      }
    }

    // Atualizar contadores do envio
    if (envio_id) {
      const { data: envioAtual } = await supabase
        .from("envios_disparo")
        .select("enviados, sucesso, falhas")
        .eq("id", envio_id)
        .single();

      const novoEnviados = (envioAtual?.enviados || 0) + enviados + falhas;
      const novoSucesso = (envioAtual?.sucesso || 0) + enviados;
      const novoFalhas = (envioAtual?.falhas || 0) + falhas;

      // Verificar se ainda há pendentes
      const { count: pendentesRestantes } = await supabase
        .from("campanha_envios")
        .select("id", { count: "exact", head: true })
        .eq("envio_id", envio_id)
        .in("status", ["enviar", "reenviar"]);

      const novoStatus = pendentesRestantes === 0 ? "concluida" : "em_andamento";

      await supabase
        .from("envios_disparo")
        .update({ 
          enviados: novoEnviados,
          sucesso: novoSucesso,
          falhas: novoFalhas,
          status: novoStatus,
          ...(novoStatus === "concluida" ? { concluido_em: new Date().toISOString() } : {})
        })
        .eq("id", envio_id);
    }

    console.log(`[DISPARO-DIRETO] Processamento concluído: ${enviados} enviados, ${falhas} falhas`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processados ${pendentes.length} leads`,
        enviados,
        falhas,
        resultados
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[DISPARO-DIRETO] Erro geral:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Erro desconhecido"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
