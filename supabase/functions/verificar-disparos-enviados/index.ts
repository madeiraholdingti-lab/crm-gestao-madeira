import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const batchSize = body.batch_size || 10;
    const delayMs = body.delay_ms || 2000; // delay between each number check

    // Get config
    const { data: config } = await supabase
      .from("config_global")
      .select("evolution_base_url, evolution_api_key")
      .single();

    if (!config) throw new Error("Config não encontrada");

    // Get leads with status 'enviado' but no wa_message_id, grouped by instance
    const { data: pendingLeads, error: leadsError } = await supabase
      .from("campanha_envios")
      .select("id, telefone, envio_id, campanha_id")
      .eq("status", "enviado")
      .is("wa_message_id", null)
      .limit(batchSize);

    if (leadsError) throw new Error(`Erro ao buscar leads: ${leadsError.message}`);
    if (!pendingLeads || pendingLeads.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "Nenhum lead pendente de verificação", remaining: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get envio_ids to find instances
    const envioIds = [...new Set(pendingLeads.map(l => l.envio_id).filter(Boolean))];
    
    const { data: envios } = await supabase
      .from("envios_disparo")
      .select("id, instancia_id")
      .in("id", envioIds);

    // Map envio_id -> instancia_id
    const envioInstanciaMap: Record<string, string> = {};
    for (const e of envios || []) {
      envioInstanciaMap[e.id] = e.instancia_id;
    }

    // Get all needed instances
    const instanciaIds = [...new Set(Object.values(envioInstanciaMap).filter(Boolean))];
    
    const { data: instancias } = await supabase
      .from("instancias_whatsapp")
      .select("id, nome_instancia, instancia_id")
      .in("id", instanciaIds);

    const instanciaMap: Record<string, { nome: string; evolutionId: string }> = {};
    for (const inst of instancias || []) {
      instanciaMap[inst.id] = { nome: inst.nome_instancia, evolutionId: inst.instancia_id };
    }

    console.log(`[VERIF-DISPAROS] Processando ${pendingLeads.length} leads em ${instanciaIds.length} instâncias`);

    let foundCount = 0;
    let notFoundCount = 0;
    let errorCount = 0;
    const results: any[] = [];

    for (const lead of pendingLeads) {
      const instanciaId = lead.envio_id ? envioInstanciaMap[lead.envio_id] : null;
      if (!instanciaId || !instanciaMap[instanciaId]) {
        console.log(`[VERIF-DISPAROS] Instância não encontrada para envio ${lead.envio_id}`);
        errorCount++;
        continue;
      }

      const instancia = instanciaMap[instanciaId];
      const phone = lead.telefone;
      
      // Format as JID for Evolution API query
      const remoteJid = `${phone}@s.whatsapp.net`;

      try {
        const evolutionUrl = `${config.evolution_base_url}/chat/findMessages/${encodeURIComponent(instancia.nome)}`;
        
        const response = await fetch(evolutionUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": config.evolution_api_key || "",
          },
          body: JSON.stringify({
            where: {
              key: {
                remoteJid: remoteJid,
                fromMe: true,
              },
            },
            limit: 5,
          }),
        });

        if (!response.ok) {
          console.error(`[VERIF-DISPAROS] Evolution API error for ${phone}: ${response.status}`);
          errorCount++;
          continue;
        }

        const data = await response.json();
        const messages = data.messages?.records || [];
        
        // Filter for fromMe messages only
        const sentMessages = messages.filter((m: any) => m.key?.fromMe === true);

        if (sentMessages.length > 0) {
          const firstSent = sentMessages[0];
          const waMessageId = firstSent.key?.id;
          
          if (waMessageId) {
            await supabase
              .from("campanha_envios")
              .update({ wa_message_id: waMessageId })
              .eq("id", lead.id);

            foundCount++;
            results.push({ phone, status: "found", wa_message_id: waMessageId, instance: instancia.nome });
            console.log(`[VERIF-DISPAROS] ✅ ${phone} - wa_message_id: ${waMessageId}`);
          }
        } else {
          notFoundCount++;
          results.push({ phone, status: "not_found", instance: instancia.nome });
          console.log(`[VERIF-DISPAROS] ❌ ${phone} - não encontrado`);
        }

        // Small delay between API calls to avoid rate limiting
        if (delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }

      } catch (err) {
        console.error(`[VERIF-DISPAROS] Erro ao verificar ${phone}:`, err);
        errorCount++;
      }
    }

    // Count remaining
    const { count: remaining } = await supabase
      .from("campanha_envios")
      .select("id", { count: "exact", head: true })
      .eq("status", "enviado")
      .is("wa_message_id", null);

    console.log(`[VERIF-DISPAROS] Resultado: ${foundCount} encontrados, ${notFoundCount} não encontrados, ${errorCount} erros. Restantes: ${remaining}`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: pendingLeads.length,
        found: foundCount,
        not_found: notFoundCount,
        errors: errorCount,
        remaining: remaining || 0,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[VERIF-DISPAROS] Erro geral:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
