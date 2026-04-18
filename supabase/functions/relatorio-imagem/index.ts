import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DadosRelatorio {
  disparos: {
    hoje: number;
    ontem: number;
    anteontem: number;
    mes: number;
  };
  porEspecialidade: Array<{ especialidade: string; enviados: number; respondidos: number; taxa: number }>;
  tarefas: {
    criadasSemana: number;
    atrasadas: number;
    realizadasSemana: number;
  };
}

function getDateRange(daysAgo: number): { start: string; end: string } {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(0, 0, 0, 0);
  const start = date.toISOString();
  date.setHours(23, 59, 59, 999);
  const end = date.toISOString();
  return { start, end };
}

function getWeekStart(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString();
}

function getMonthStart(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY não configurada" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Buscando dados para relatório...");

    // Ranges de data
    const hoje = getDateRange(0);
    const ontem = getDateRange(1);
    const anteontem = getDateRange(2);
    const inicioSemana = getWeekStart();
    const inicioMes = getMonthStart();
    const agora = new Date().toISOString();

    // 1. Disparos por dia
    const { count: disparosHoje } = await supabase
      .from("campanha_envios")
      .select("*", { count: "exact", head: true })
      .gte("enviado_em", hoje.start)
      .lte("enviado_em", hoje.end)
      .eq("status", "enviado");

    const { count: disparosOntem } = await supabase
      .from("campanha_envios")
      .select("*", { count: "exact", head: true })
      .gte("enviado_em", ontem.start)
      .lte("enviado_em", ontem.end)
      .eq("status", "enviado");

    const { count: disparosAnteontem } = await supabase
      .from("campanha_envios")
      .select("*", { count: "exact", head: true })
      .gte("enviado_em", anteontem.start)
      .lte("enviado_em", anteontem.end)
      .eq("status", "enviado");

    const { count: disparosMes } = await supabase
      .from("campanha_envios")
      .select("*", { count: "exact", head: true })
      .gte("enviado_em", inicioMes)
      .eq("status", "enviado");

    // 2. Enviados por especialidade (join com leads)
    const { data: enviosComLead } = await supabase
      .from("campanha_envios")
      .select("lead_id, telefone, status")
      .gte("enviado_em", inicioMes)
      .eq("status", "enviado");

    // Buscar leads para pegar especialidade
    const leadIds = [...new Set(enviosComLead?.map(e => e.lead_id) || [])];
    const { data: leads } = await supabase
      .from("leads")
      .select("id, especialidade, telefone")
      .in("id", leadIds.length > 0 ? leadIds : ["00000000-0000-0000-0000-000000000000"]);

    // Mapa de lead_id para especialidade
    const leadEspecialidade: Record<string, string> = {};
    leads?.forEach(l => {
      leadEspecialidade[l.id] = l.especialidade || "não definida";
    });

    // Agrupar por especialidade
    const porEspecialidade: Record<string, { enviados: number; telefones: Set<string> }> = {};
    enviosComLead?.forEach(e => {
      const esp = leadEspecialidade[e.lead_id] || "não definida";
      if (!porEspecialidade[esp]) {
        porEspecialidade[esp] = { enviados: 0, telefones: new Set() };
      }
      porEspecialidade[esp].enviados++;
      porEspecialidade[esp].telefones.add(e.telefone);
    });

    // Buscar respostas (mensagens recebidas de contatos que receberam disparo)
    const todosTelefones = new Set<string>();
    enviosComLead?.forEach(e => todosTelefones.add(e.telefone));

    // Normalizar telefones para busca
    const telefonesArray = Array.from(todosTelefones);
    
    // Buscar mensagens recebidas (from_me = false) no mês
    const { data: mensagensRecebidas } = await supabase
      .from("messages")
      .select("contact_id")
      .eq("from_me", false)
      .gte("created_at", inicioMes);

    // Buscar contatos para mapear telefone
    const contactIds = [...new Set(mensagensRecebidas?.map(m => m.contact_id) || [])];
    const { data: contatos } = await supabase
      .from("contacts")
      .select("id, phone")
      .in("id", contactIds.length > 0 ? contactIds : ["00000000-0000-0000-0000-000000000000"]);

    const contatoTelefone: Record<string, string> = {};
    contatos?.forEach(c => {
      contatoTelefone[c.id] = c.phone;
    });

    // Contar respostas por especialidade
    const respondidosPorEsp: Record<string, number> = {};
    mensagensRecebidas?.forEach(m => {
      const tel = contatoTelefone[m.contact_id];
      if (tel && todosTelefones.has(tel)) {
        // Encontrar especialidade do telefone
        const lead = leads?.find(l => l.telefone === tel);
        const esp = lead?.especialidade || "não definida";
        respondidosPorEsp[esp] = (respondidosPorEsp[esp] || 0) + 1;
      }
    });

    const especialidadesArray = Object.entries(porEspecialidade).map(([esp, data]) => ({
      especialidade: esp,
      enviados: data.enviados,
      respondidos: respondidosPorEsp[esp] || 0,
      taxa: data.enviados > 0 ? Math.round((respondidosPorEsp[esp] || 0) / data.enviados * 100) : 0,
    })).sort((a, b) => b.enviados - a.enviados).slice(0, 8);

    // 3. Tarefas
    const { count: tarefasCriadasSemana } = await supabase
      .from("task_flow_tasks")
      .select("*", { count: "exact", head: true })
      .is("deleted_at", null)
      .gte("created_at", inicioSemana);

    // Buscar coluna de concluído
    const { data: colunas } = await supabase
      .from("task_flow_columns")
      .select("id, nome, tipo");

    const colunaConcluido = colunas?.find(c => 
      c.nome.toLowerCase().includes("finalizada") ||
      c.nome.toLowerCase().includes("conclu") || 
      c.tipo === "concluido" ||
      c.nome.toLowerCase().includes("feito") ||
      c.nome.toLowerCase().includes("done")
    );

    // Tarefas realizadas na semana
    const { count: tarefasRealizadasSemana } = await supabase
      .from("task_flow_tasks")
      .select("*", { count: "exact", head: true })
      .is("deleted_at", null)
      .eq("column_id", colunaConcluido?.id || "00000000-0000-0000-0000-000000000000")
      .gte("updated_at", inicioSemana);

    // Tarefas atrasadas (prazo passou, não concluídas, excluindo hoje)
    const inicioHoje = new Date();
    inicioHoje.setHours(0, 0, 0, 0);
    const { count: tarefasAtrasadas } = await supabase
      .from("task_flow_tasks")
      .select("*", { count: "exact", head: true })
      .is("deleted_at", null)
      .lt("prazo", inicioHoje.toISOString())
      .neq("column_id", colunaConcluido?.id || "00000000-0000-0000-0000-000000000000");

    const dados: DadosRelatorio = {
      disparos: {
        hoje: disparosHoje || 0,
        ontem: disparosOntem || 0,
        anteontem: disparosAnteontem || 0,
        mes: disparosMes || 0,
      },
      porEspecialidade: especialidadesArray,
      tarefas: {
        criadasSemana: tarefasCriadasSemana || 0,
        atrasadas: tarefasAtrasadas || 0,
        realizadasSemana: tarefasRealizadasSemana || 0,
      },
    };

    console.log("Dados coletados:", JSON.stringify(dados, null, 2));

    // Verificar se quer só JSON (dados sem imagem)
    const url = new URL(req.url);
    if (url.searchParams.get("format") === "json") {
      return new Response(JSON.stringify(dados), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Gerar imagem com IA
    const dataAtual = new Date().toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

    const especialidadesTexto = dados.porEspecialidade.length > 0 
      ? dados.porEspecialidade.map(e => 
          `• ${e.especialidade}: ${e.enviados} enviados | ${e.taxa}% resposta`
        ).join("\n")
      : "• Sem dados";

    const prompt = `Create an ultra-clean, minimalist business dashboard image.

CRITICAL DESIGN RULES:
- Pure white background (#FFFFFF)
- Primary accent color: teal (#0D9488)
- Secondary text: gray (#6B7280)
- NO gradients, NO shadows, NO 3D effects
- Extremely minimal - like Apple or Notion design
- Size: 1024x1024 pixels square
- Lots of white space

HEADER (top):
- Left side: A simple teal circle with letter "M" inside (logo)
- Next to it: "Maikonect" in bold teal (#0D9488) modern font
- Below: "${dataAtual}" in small gray text

CONTENT (3 horizontal sections):

SECTION 1 - "Disparos" label in gray
Four numbers in a row with teal text:
${dados.disparos.hoje} (label: Hoje)
${dados.disparos.ontem} (label: Ontem)  
${dados.disparos.anteontem} (label: Anteontem)
${dados.disparos.mes} (label: Mês)

SECTION 2 - "Especialidades" label in gray
${especialidadesTexto}

SECTION 3 - "Tarefas" label in gray
Three metrics:
${dados.tarefas.criadasSemana} Criadas
${dados.tarefas.realizadasSemana} Concluídas (green check)
${dados.tarefas.atrasadas} Atrasadas (red/orange)

STYLE:
- Numbers should be large and bold in teal
- Labels small and gray
- Use thin lines or minimal borders if needed
- Typography: clean sans-serif like Inter or SF Pro
- Everything aligned and balanced
- Premium, sophisticated, minimal aesthetic
- Ultra high resolution`;

    console.log("Gerando imagem com IA...");

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("Erro na API de IA:", errorText);
      return new Response(
        JSON.stringify({ error: "Erro ao gerar imagem", details: errorText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiResponse.json();
    const imageUrl = aiData.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!imageUrl) {
      console.error("Imagem não retornada:", JSON.stringify(aiData));
      return new Response(
        JSON.stringify({ error: "Imagem não gerada", dados }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extrair base64 da imagem (formato: data:image/png;base64,XXXXX)
    const base64Match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!base64Match) {
      return new Response(
        JSON.stringify({ error: "Formato de imagem inválido" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const mimeType = `image/${base64Match[1]}`;
    const base64Data = base64Match[2];

    console.log("Imagem gerada com sucesso!");

    // Retornar JSON com base64 para Evolution API
    return new Response(
      JSON.stringify({
        success: true,
        media: base64Data,
        mediatype: mimeType,
        mimetype: mimeType,
        fileName: `relatorio-${new Date().toISOString().split('T')[0]}.png`,
        caption: `📊 Relatório CRM - ${dataAtual}`,
        dados,
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (error) {
    console.error("Erro ao gerar relatório:", error);
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    return new Response(
      JSON.stringify({ error: "Erro interno", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
