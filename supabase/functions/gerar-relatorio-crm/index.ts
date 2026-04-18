import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  tipo_relatorio: "completo" | "leads" | "campanhas" | "conversas" | "agenda" | "tarefas";
  data_inicio: string;
  data_fim: string;
  filtros?: {
    campanha_id?: string;
    instancia_id?: string;
    tipo_lead?: string[];
    especialidade?: string[];
  };
  formato?: "json" | "resumo";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Validar autenticação
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Token de autenticação não fornecido" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validar JWT
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData.user) {
      console.error("Erro de autenticação:", authError);
      return new Response(
        JSON.stringify({ error: "Token inválido ou expirado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = userData.user.id;
    console.log(`Relatório solicitado por: ${userId}`);

    // Parse do body
    const body: RequestBody = await req.json();
    const { tipo_relatorio, data_inicio, data_fim, filtros, formato = "json" } = body;

    // Validação básica
    if (!tipo_relatorio || !data_inicio || !data_fim) {
      return new Response(
        JSON.stringify({ error: "Parâmetros obrigatórios: tipo_relatorio, data_inicio, data_fim" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validar datas
    const inicio = new Date(data_inicio);
    const fim = new Date(data_fim);
    if (isNaN(inicio.getTime()) || isNaN(fim.getTime())) {
      return new Response(
        JSON.stringify({ error: "Datas inválidas. Use o formato YYYY-MM-DD" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const dias = Math.ceil((fim.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    console.log(`Gerando relatório: ${tipo_relatorio} de ${data_inicio} a ${data_fim}`);

    // Objeto de resposta
    const relatorio: Record<string, unknown> = {
      periodo: {
        inicio: data_inicio,
        fim: data_fim,
        dias,
      },
      gerado_em: new Date().toISOString(),
      gerado_por: userId,
    };

    // Funções de busca por categoria
    const buscarLeads = async () => {
      let query = supabase.from("leads").select("*", { count: "exact" });
      
      if (filtros?.tipo_lead?.length) {
        query = query.in("tipo_lead", filtros.tipo_lead);
      }
      if (filtros?.especialidade?.length) {
        query = query.in("especialidade", filtros.especialidade);
      }

      const { data: todosLeads, count: totalLeads } = await query;

      // Leads no período
      const { count: novosPeriodo } = await supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .gte("created_at", data_inicio)
        .lte("created_at", `${data_fim}T23:59:59`);

      // Contagem por status
      const ativos = todosLeads?.filter(l => l.ativo === true).length || 0;
      const inativos = todosLeads?.filter(l => l.ativo === false).length || 0;

      // Agrupamento por tipo
      const porTipo: Record<string, number> = {};
      todosLeads?.forEach(lead => {
        const tipo = lead.tipo_lead || "não definido";
        porTipo[tipo] = (porTipo[tipo] || 0) + 1;
      });

      const porTipoArray = Object.entries(porTipo).map(([tipo, quantidade]) => ({
        tipo,
        quantidade,
        percentual: totalLeads ? Math.round((quantidade / totalLeads) * 100 * 10) / 10 : 0,
      }));

      // Agrupamento por especialidade
      const porEspecialidade: Record<string, number> = {};
      todosLeads?.forEach(lead => {
        if (lead.especialidade) {
          porEspecialidade[lead.especialidade] = (porEspecialidade[lead.especialidade] || 0) + 1;
        }
      });

      const porEspecialidadeArray = Object.entries(porEspecialidade).map(([especialidade, quantidade]) => ({
        especialidade,
        quantidade,
      }));

      return {
        total: totalLeads || 0,
        novos_periodo: novosPeriodo || 0,
        ativos,
        inativos,
        por_tipo: porTipoArray,
        por_especialidade: porEspecialidadeArray,
      };
    };

    const buscarCampanhas = async () => {
      // Total de campanhas
      const { data: campanhas, count: totalCampanhas } = await supabase
        .from("campanhas_disparo")
        .select("*", { count: "exact" });

      const campanhasAtivas = campanhas?.filter(c => c.status === "em_andamento" || c.status === "ativa").length || 0;

      // Envios no período
      let queryEnvios = supabase
        .from("campanha_envios")
        .select("*", { count: "exact" })
        .gte("created_at", data_inicio)
        .lte("created_at", `${data_fim}T23:59:59`);

      if (filtros?.campanha_id) {
        queryEnvios = queryEnvios.eq("campanha_id", filtros.campanha_id);
      }

      const { data: envios, count: totalEnvios } = await queryEnvios;

      const enviados = envios?.filter(e => e.status === "enviado" || e.status === "sucesso").length || 0;
      const pendentes = envios?.filter(e => e.status === "pendente").length || 0;
      const falhas = envios?.filter(e => e.status === "falha" || e.status === "erro").length || 0;
      const taxaSucesso = totalEnvios ? Math.round((enviados / totalEnvios) * 100 * 10) / 10 : 0;

      // Performance por campanha
      const porCampanha = campanhas?.map(c => {
        const enviosCampanha = envios?.filter(e => e.campanha_id === c.id) || [];
        const sucessoCampanha = enviosCampanha.filter(e => e.status === "enviado" || e.status === "sucesso").length;
        const falhasCampanha = enviosCampanha.filter(e => e.status === "falha" || e.status === "erro").length;

        return {
          id: c.id,
          nome: c.nome,
          tipo: c.tipo,
          total_enviados: enviosCampanha.length,
          sucesso: sucessoCampanha,
          falhas: falhasCampanha,
          taxa_sucesso: enviosCampanha.length ? Math.round((sucessoCampanha / enviosCampanha.length) * 100 * 10) / 10 : 0,
        };
      }) || [];

      return {
        total_campanhas: totalCampanhas || 0,
        campanhas_ativas: campanhasAtivas,
        envios: {
          total: totalEnvios || 0,
          enviados,
          pendentes,
          falhas,
          taxa_sucesso: taxaSucesso,
        },
        por_campanha: porCampanha,
      };
    };

    const buscarConversas = async () => {
      // Conversas ativas
      const { data: conversas, count: totalAtivas } = await supabase
        .from("conversas")
        .select("*", { count: "exact" })
        .neq("status", "concluido");

      // Novas no período
      const { count: novasPeriodo } = await supabase
        .from("conversas")
        .select("*", { count: "exact", head: true })
        .gte("created_at", data_inicio)
        .lte("created_at", `${data_fim}T23:59:59`);

      // Por status
      const { data: todasConversas } = await supabase.from("conversas").select("status");
      const porStatus: Record<string, number> = {};
      todasConversas?.forEach(c => {
        const status = c.status || "indefinido";
        porStatus[status] = (porStatus[status] || 0) + 1;
      });

      // Mensagens no período
      const { count: mensagensEnviadas } = await supabase
        .from("mensagens")
        .select("*", { count: "exact", head: true })
        .eq("remetente", "sistema")
        .gte("created_at", data_inicio)
        .lte("created_at", `${data_fim}T23:59:59`);

      const { count: mensagensRecebidas } = await supabase
        .from("mensagens")
        .select("*", { count: "exact", head: true })
        .eq("remetente", "contato")
        .gte("created_at", data_inicio)
        .lte("created_at", `${data_fim}T23:59:59`);

      return {
        total_ativas: totalAtivas || 0,
        novas_periodo: novasPeriodo || 0,
        por_status: porStatus,
        mensagens: {
          enviadas: mensagensEnviadas || 0,
          recebidas: mensagensRecebidas || 0,
        },
      };
    };

    const buscarAgenda = async () => {
      const { data: eventos, count: totalEventos } = await supabase
        .from("eventos_agenda")
        .select("*", { count: "exact" })
        .gte("data_hora_inicio", data_inicio)
        .lte("data_hora_inicio", `${data_fim}T23:59:59`);

      const consultas = {
        agendadas: eventos?.filter(e => e.tipo_evento === "consulta").length || 0,
        confirmadas: eventos?.filter(e => e.tipo_evento === "consulta" && e.status === "confirmado").length || 0,
        realizadas: eventos?.filter(e => e.tipo_evento === "consulta" && e.status === "realizado").length || 0,
        canceladas: eventos?.filter(e => e.tipo_evento === "consulta" && e.status === "cancelado").length || 0,
        no_show: eventos?.filter(e => e.tipo_evento === "consulta" && e.status === "no_show").length || 0,
      };

      const taxaComparecimento = consultas.confirmadas > 0
        ? Math.round((consultas.realizadas / consultas.confirmadas) * 100 * 10) / 10
        : 0;

      // Por dia da semana
      const diasSemana = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
      const porDiaSemana: Record<string, number> = {};
      eventos?.forEach(e => {
        const dia = new Date(e.data_hora_inicio).getDay();
        const nomeDia = diasSemana[dia];
        porDiaSemana[nomeDia] = (porDiaSemana[nomeDia] || 0) + 1;
      });

      const porDiaSemanaArray = Object.entries(porDiaSemana).map(([dia, total]) => ({ dia, total }));

      return {
        total_eventos: totalEventos || 0,
        consultas,
        taxa_comparecimento: taxaComparecimento,
        por_dia_semana: porDiaSemanaArray,
      };
    };

    const buscarTarefas = async () => {
      // Buscar colunas para mapear status
      const { data: colunas } = await supabase
        .from("task_flow_columns")
        .select("id, nome, tipo");

      const { data: tarefas, count: totalTarefas } = await supabase
        .from("task_flow_tasks")
        .select("*, responsavel:task_flow_profiles(nome)", { count: "exact" });

      // Mapear status por coluna
      const porStatus: Record<string, number> = {};
      tarefas?.forEach(t => {
        const coluna = colunas?.find(c => c.id === t.column_id);
        const nomeColuna = coluna?.nome || "indefinido";
        porStatus[nomeColuna] = (porStatus[nomeColuna] || 0) + 1;
      });

      // Tarefas atrasadas (prazo anterior a hoje, excluindo hoje, e não finalizadas)
      const inicioHoje = new Date();
      inicioHoje.setHours(0, 0, 0, 0);
      const colunaConcluido = colunas?.find(c => c.nome.toLowerCase().includes("finalizada") || c.nome.toLowerCase().includes("conclu") || c.tipo === "concluido");
      const atrasadas = tarefas?.filter(t => 
        t.prazo && 
        new Date(t.prazo) < inicioHoje && 
        t.column_id !== colunaConcluido?.id &&
        !t.deleted_at
      ).length || 0;

      // Taxa de conclusão
      const concluidas = tarefas?.filter(t => t.column_id === colunaConcluido?.id).length || 0;
      const taxaConclusao = totalTarefas ? Math.round((concluidas / totalTarefas) * 100 * 10) / 10 : 0;

      // Por responsável
      const porResponsavel: Record<string, { total: number; concluidas: number; nome: string }> = {};
      tarefas?.forEach(t => {
        if (t.responsavel_id) {
          const nome = t.responsavel?.nome || "Sem nome";
          if (!porResponsavel[t.responsavel_id]) {
            porResponsavel[t.responsavel_id] = { total: 0, concluidas: 0, nome };
          }
          porResponsavel[t.responsavel_id].total++;
          if (t.column_id === colunaConcluido?.id) {
            porResponsavel[t.responsavel_id].concluidas++;
          }
        }
      });

      const porResponsavelArray = Object.values(porResponsavel).map(r => ({
        nome: r.nome,
        total: r.total,
        concluidas: r.concluidas,
      }));

      return {
        total: totalTarefas || 0,
        por_status: porStatus,
        atrasadas,
        taxa_conclusao: taxaConclusao,
        por_responsavel: porResponsavelArray,
      };
    };

    // Executar buscas conforme tipo de relatório
    if (tipo_relatorio === "completo" || tipo_relatorio === "leads") {
      relatorio.leads = await buscarLeads();
    }

    if (tipo_relatorio === "completo" || tipo_relatorio === "campanhas") {
      relatorio.campanhas = await buscarCampanhas();
    }

    if (tipo_relatorio === "completo" || tipo_relatorio === "conversas") {
      relatorio.conversas = await buscarConversas();
    }

    if (tipo_relatorio === "completo" || tipo_relatorio === "agenda") {
      relatorio.agenda = await buscarAgenda();
    }

    if (tipo_relatorio === "completo" || tipo_relatorio === "tarefas") {
      relatorio.tarefas = await buscarTarefas();
    }

    // Resumo geral para relatório completo
    if (tipo_relatorio === "completo") {
      const leads = relatorio.leads as { total: number; novos_periodo: number } | undefined;
      const campanhas = relatorio.campanhas as { envios: { total: number; taxa_sucesso: number } } | undefined;
      const conversas = relatorio.conversas as { total_ativas: number } | undefined;
      const tarefas = relatorio.tarefas as { taxa_conclusao: number } | undefined;

      relatorio.resumo_geral = {
        total_leads: leads?.total || 0,
        leads_novos_periodo: leads?.novos_periodo || 0,
        total_disparos: campanhas?.envios?.total || 0,
        taxa_sucesso_geral: campanhas?.envios?.taxa_sucesso || 0,
        conversas_ativas: conversas?.total_ativas || 0,
        taxa_conclusao_tarefas: tarefas?.taxa_conclusao || 0,
      };
    }

    // Formato resumido
    if (formato === "resumo" && tipo_relatorio === "completo") {
      return new Response(
        JSON.stringify({
          periodo: relatorio.periodo,
          resumo_geral: relatorio.resumo_geral,
          gerado_em: relatorio.gerado_em,
          gerado_por: relatorio.gerado_por,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Relatório gerado com sucesso");

    return new Response(
      JSON.stringify(relatorio),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Erro ao gerar relatório:", error);
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    return new Response(
      JSON.stringify({ error: "Erro interno ao processar relatório", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
