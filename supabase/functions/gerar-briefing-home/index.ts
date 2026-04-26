import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { user_id } = await req.json();

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: "user_id é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // admin_geral / medico veem TODOS os eventos da agenda + TODAS as conversas.
    // Outros roles (secretária etc) veem só os eventos onde são donos.
    const { data: userRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user_id)
      .maybeSingle();
    const role = userRole?.role || "secretaria_medica";
    const isAdminOrMedico = role === "admin_geral" || role === "medico";

    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY não configurada" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== COLETAR DADOS =====

    const agora = new Date();
    const duasHorasAtras = new Date(agora.getTime() - 2 * 60 * 60 * 1000).toISOString();

    // 1. Conversas pendentes via RPC nova `conversas_pendentes_atendimento`.
    //    Ela calcula da TABELA messages (fonte de verdade), não do cache
    //    last_message_from_me que pode estar desatualizado.
    //    Filtra: chip de atendimento, status ativo, não ignorada,
    //    msg do contato é a última E foi há >= 30min (não flagar conversas
    //    sendo respondidas agora mesmo).
    const { data: pendentesRaw } = await supabase
      .rpc("conversas_pendentes_atendimento", { p_min_minutos: 30, p_lookback_dias: 14 });

    // Adapta o formato pra reaproveitar o resto do código
    const conversasAbertas = (pendentesRaw || []).map((p: {
      conversa_id: string;
      responsavel_atual: string | null;
      ultima_msg_em: string | null;
      ultima_msg_texto: string | null;
      nome_contato: string | null;
      numero_contato: string;
      status: string;
    }) => ({
      id: p.conversa_id,
      responsavel_atual: p.responsavel_atual,
      ultima_interacao: p.ultima_msg_em,
      ultima_mensagem: p.ultima_msg_texto,
      nome_contato: p.nome_contato,
      numero_contato: p.numero_contato,
      status: p.status,
    }));

    // 2. Buscar nomes dos responsáveis
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, nome")
      .eq("ativo", true);

    const profileMap = new Map((profiles || []).map(p => [p.id, p.nome]));

    // Agrupar conversas por responsável (incluindo "Sem atribuição")
    const porResponsavel = new Map<string, { total: number; semResposta2h: number; nomes: string[] }>();
    for (const conv of conversasAbertas || []) {
      const nome = conv.responsavel_atual
        ? (profileMap.get(conv.responsavel_atual) || "Sem nome")
        : "Sem atribuição";
      const grupo = porResponsavel.get(nome) || { total: 0, semResposta2h: 0, nomes: [] };
      grupo.total++;
      if (conv.ultima_interacao && conv.ultima_interacao < duasHorasAtras) {
        grupo.semResposta2h++;
        grupo.nomes.push(conv.nome_contato || conv.numero_contato);
      }
      porResponsavel.set(nome, grupo);
    }

    // 3. Tarefas atrasadas — excluir as que estão em colunas de "Finalizada"/"Concluída"
    //    Bug anterior: contava tasks finalizadas com prazo no passado como "atrasadas"
    //    (ex: 190 total, só 1 realmente pendente). JOIN + filtro por nome da coluna.
    const { data: tarefasAtrasadasRaw } = await supabase
      .from("task_flow_tasks")
      .select("id, titulo, prazo, column_id, task_flow_columns!task_flow_tasks_column_id_fkey(nome)")
      .is("deleted_at", null)
      .lt("prazo", agora.toISOString())
      .not("prazo", "is", null);

    const tarefasAtrasadas = (tarefasAtrasadasRaw || []).filter((t: any) => {
      const nomeCol = (t.task_flow_columns?.nome || '').toLowerCase();
      return !nomeCol.includes('finaliz') && !nomeCol.includes('conclu');
    });

    // 4. Eventos da agenda de amanhã
    const amanha = new Date(agora);
    amanha.setDate(amanha.getDate() + 1);
    const inicioAmanha = new Date(amanha.getFullYear(), amanha.getMonth(), amanha.getDate()).toISOString();
    const fimAmanha = new Date(amanha.getFullYear(), amanha.getMonth(), amanha.getDate() + 1).toISOString();

    // Para admin/medico: todos os eventos do dia (importante porque o OAuth
    // do Google Calendar foi feito pela Iza, então medico_id dos eventos é dela,
    // não do Maikon). Pra outros roles: só eventos onde o user é dono.
    let eventosQuery = supabase
      .from("eventos_agenda")
      .select("titulo, data_hora_inicio, tipo_evento")
      .gte("data_hora_inicio", inicioAmanha)
      .lt("data_hora_inicio", fimAmanha);
    if (!isAdminOrMedico) {
      eventosQuery = eventosQuery.eq("medico_id", user_id);
    }
    const { data: eventosAmanha } = await eventosQuery;

    // ===== MONTAR CONTEXTO PARA IA =====

    let contexto = "DADOS ATUAIS DO CRM:\n\n";

    // Secretárias
    contexto += "ATENDIMENTO DAS SECRETÁRIAS:\n";
    if (porResponsavel.size === 0) {
      contexto += "- Nenhuma conversa aberta no momento\n";
    } else {
      for (const [nome, dados] of porResponsavel) {
        contexto += `- ${nome}: ${dados.total} conversa(s) aberta(s)`;
        if (dados.semResposta2h > 0) {
          contexto += `, ${dados.semResposta2h} sem resposta há mais de 2h (${dados.nomes.slice(0, 3).join(", ")})`;
        }
        contexto += "\n";
      }
    }

    // Tarefas
    contexto += `\nTAREFAS ATRASADAS: ${(tarefasAtrasadas || []).length}\n`;
    for (const t of (tarefasAtrasadas || []).slice(0, 5)) {
      contexto += `- "${t.titulo}" (prazo: ${t.prazo})\n`;
    }

    // Agenda
    contexto += `\nAGENDA DE AMANHÃ: ${(eventosAmanha || []).length} evento(s)\n`;
    for (const e of eventosAmanha || []) {
      contexto += `- ${e.titulo} (${e.tipo_evento || "evento"})\n`;
    }

    // Total de conversas abertas
    const totalAbertas = conversasAbertas?.length || 0;
    const totalSemResposta2h = Array.from(porResponsavel.values()).reduce((acc, g) => acc + g.semResposta2h, 0);
    contexto += `\nRESUMO: ${totalAbertas} conversas abertas, ${totalSemResposta2h} sem resposta há +2h, ${(tarefasAtrasadas || []).length} tarefas atrasadas`;

    // ===== CHAMAR OPENAI =====

    const hora = agora.getHours();
    const periodo = hora < 12 ? "manhã" : hora < 18 ? "tarde" : "noite";

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Você é um assistente do Dr. Maikon Madeira, cirurgião cardíaco em Itajaí/SC.
Resuma em 3-4 frases o que está acontecendo agora no CRM dele.
Mencione quem das secretárias precisa de atenção, se há algo urgente, e o que ele tem agendado.
Seja direto, use linguagem natural brasileira. Destaque o que precisa de ação dele.
Se tudo estiver em dia, diga isso de forma positiva e breve.
Comece com uma saudação com base no horário (Bom dia/Boa tarde/Boa noite).`
          },
          {
            role: "user",
            content: `Horário atual: ${hora}h (${periodo})\n\n${contexto}`
          }
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    let conteudo: string;
    const linksAcao: Array<{ label: string; href: string }> = [];

    if (!response.ok) {
      console.error("[BRIEFING] Erro OpenAI:", response.status, await response.text());
      // Fallback sem IA
      conteudo = `${totalAbertas} conversa(s) aberta(s), ${totalSemResposta2h} sem resposta há mais de 2h, ${(tarefasAtrasadas || []).length} tarefa(s) atrasada(s), ${(eventosAmanha || []).length} evento(s) amanhã.`;
    } else {
      const openaiData = await response.json();
      conteudo = openaiData?.choices?.[0]?.message?.content || "Não foi possível gerar o briefing.";
    }

    // Links de ação rápida
    if (totalSemResposta2h > 0) {
      linksAcao.push({ label: "Ver conversas pendentes", href: "/sdr-zap" });
    }
    if ((tarefasAtrasadas || []).length > 0) {
      linksAcao.push({ label: "Ver tarefas atrasadas", href: "/task-flow" });
    }
    if ((eventosAmanha || []).length > 0) {
      linksAcao.push({ label: "Ver agenda", href: "/home" });
    }

    // ===== HIGHLIGHTS ESTRUTURADOS =====
    // Bullets com números destacados e ícones de severidade pra Maikon
    // bater o olho e entender em 2 segundos. Renderizados ACIMA do texto da IA.
    // Severity: 'red' = ação urgente, 'yellow' = atenção, 'green' = em dia.
    const highlights: Array<{ severity: 'red' | 'yellow' | 'green'; label: string; metric: number; unit: string; href?: string }> = [];

    // Conversas pendentes urgentes (>2h sem resposta)
    if (totalSemResposta2h > 0) {
      highlights.push({
        severity: totalSemResposta2h >= 5 ? 'red' : 'yellow',
        label: 'conversas sem resposta há +2h',
        metric: totalSemResposta2h,
        unit: totalSemResposta2h === 1 ? 'conversa' : 'conversas',
        href: '/sdr-zap',
      });
    } else if (totalAbertas === 0) {
      highlights.push({
        severity: 'green',
        label: 'Nenhuma conversa aberta com as secretárias',
        metric: 0,
        unit: '',
      });
    } else {
      highlights.push({
        severity: 'green',
        label: 'conversas em atendimento, nada crítico',
        metric: totalAbertas,
        unit: totalAbertas === 1 ? 'conversa' : 'conversas',
      });
    }

    // Tarefas atrasadas
    const nTarefas = (tarefasAtrasadas || []).length;
    if (nTarefas > 0) {
      highlights.push({
        severity: nTarefas >= 10 ? 'red' : 'yellow',
        label: 'atrasadas',
        metric: nTarefas,
        unit: nTarefas === 1 ? 'tarefa' : 'tarefas',
        href: '/task-flow',
      });
    } else {
      highlights.push({
        severity: 'green',
        label: 'Nenhuma tarefa atrasada',
        metric: 0,
        unit: '',
      });
    }

    // Agenda de amanhã
    const nEventos = (eventosAmanha || []).length;
    if (nEventos > 0) {
      highlights.push({
        severity: 'yellow',
        label: nEventos === 1 ? 'compromisso amanhã' : 'compromissos amanhã',
        metric: nEventos,
        unit: '',
        href: '/home',
      });
    } else {
      highlights.push({
        severity: 'green',
        label: 'Agenda de amanhã livre',
        metric: 0,
        unit: '',
      });
    }

    // Salvar no banco. links_acao guarda { links, highlights } pra preservar
    // os highlights ao recarregar do cache.
    await supabase.from("briefings_home").insert({
      user_id,
      conteudo,
      links_acao: { links: linksAcao, highlights },
    });

    return new Response(
      JSON.stringify({ conteudo, links_acao: linksAcao, highlights }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: unknown) {
    console.error("[BRIEFING] Erro:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
