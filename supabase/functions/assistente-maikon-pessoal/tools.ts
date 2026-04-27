// Catálogo de tools que o agente pessoal expõe pro Claude.
// Cada tool tem: spec (JSON Schema enviada pra API) + handler (executa).
//
// Tools são small, focadas, idempotentes onde possível. Ações destrutivas
// (apagar, mass send) DEVEM pedir confirmação do user antes de executar.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

type SupabaseClient = ReturnType<typeof createClient>;

interface ToolContext {
  supa: SupabaseClient;
  userId: string;
  userPhone: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

// ============================================================================
// CRM - Conversas / Atendimento
// ============================================================================

const listarConversasPendentes: ToolDefinition = {
  name: 'listar_conversas_pendentes',
  description: 'Lista quantas conversas estão sem resposta da equipe (Iza, Mariana). Use quando Maikon perguntar sobre o atendimento, conversas em aberto, ou status do dia. Retorna agrupado por secretária.',
  input_schema: {
    type: 'object',
    properties: {
      min_minutos_sem_resposta: {
        type: 'integer',
        description: 'Mínimo de minutos sem resposta pra considerar pendente. Default 30.',
        default: 30,
      },
    },
  },
  async handler(args, ctx) {
    const minMin = (args.min_minutos_sem_resposta as number) ?? 30;
    const { data, error } = await ctx.supa.rpc('conversas_pendentes_atendimento', {
      p_min_minutos: minMin,
      p_lookback_dias: 14,
    });
    if (error) throw new Error(error.message);
    const rows = (data || []) as Array<{
      responsavel_nome: string | null;
      instancia_nome: string;
      minutos_sem_resposta: number;
    }>;
    const porResp = new Map<string, number>();
    for (const r of rows) {
      const k = r.responsavel_nome || 'Sem atribuição';
      porResp.set(k, (porResp.get(k) || 0) + 1);
    }
    return {
      total: rows.length,
      por_responsavel: Object.fromEntries(porResp),
      mais_antigas: rows
        .sort((a, b) => b.minutos_sem_resposta - a.minutos_sem_resposta)
        .slice(0, 5)
        .map(r => ({
          responsavel: r.responsavel_nome || 'Sem atribuição',
          instancia: r.instancia_nome,
          horas_espera: Math.round(r.minutos_sem_resposta / 60),
        })),
    };
  },
};

// ============================================================================
// CRM - Tarefas (Task Flow)
// ============================================================================

const listarTarefas: ToolDefinition = {
  name: 'listar_tarefas',
  description: 'Lista tarefas internas. Pode filtrar por status (atrasadas, hoje, semana, todas) e responsável. Usar quando Maikon perguntar sobre tarefas, pendências, o que está atrasado.',
  input_schema: {
    type: 'object',
    properties: {
      filtro: {
        type: 'string',
        enum: ['atrasadas', 'hoje', 'semana', 'todas'],
        description: 'Período de filtro',
        default: 'atrasadas',
      },
      responsavel_nome: {
        type: 'string',
        description: 'Nome do responsável (Iza, Mariana, Maikon). Vazio = todos.',
      },
    },
  },
  async handler(args, ctx) {
    const filtro = (args.filtro as string) ?? 'atrasadas';
    const respNome = (args.responsavel_nome as string)?.toLowerCase();
    let query = ctx.supa
      .from('task_flow_tasks')
      .select('id, titulo, prazo, assigned_to, task_flow_columns!task_flow_tasks_column_id_fkey(nome), profiles:assigned_to(nome)')
      .is('deleted_at', null)
      .limit(50);
    const agora = new Date().toISOString();
    if (filtro === 'atrasadas') query = query.lt('prazo', agora).not('prazo', 'is', null);
    else if (filtro === 'hoje') {
      const fimDoDia = new Date(); fimDoDia.setHours(23, 59, 59);
      query = query.lt('prazo', fimDoDia.toISOString()).gte('prazo', new Date(new Date().setHours(0, 0, 0)).toISOString());
    } else if (filtro === 'semana') {
      const fim = new Date(); fim.setDate(fim.getDate() + 7);
      query = query.lt('prazo', fim.toISOString()).gte('prazo', agora);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const list = (data || [])
      .filter((t: { task_flow_columns?: { nome?: string } }) => {
        const col = (t.task_flow_columns?.nome || '').toLowerCase();
        return !col.includes('finaliz') && !col.includes('conclu');
      })
      .filter((t: { profiles?: { nome?: string } }) => {
        if (!respNome) return true;
        return (t.profiles?.nome || '').toLowerCase().includes(respNome);
      });
    return {
      total: list.length,
      tarefas: list.slice(0, 15).map((t: { titulo: string; prazo: string | null; profiles?: { nome?: string } }) => ({
        titulo: t.titulo,
        prazo: t.prazo,
        responsavel: t.profiles?.nome || '—',
      })),
    };
  },
};

const criarTarefa: ToolDefinition = {
  name: 'criar_tarefa',
  description: 'Cria uma tarefa nova no Task Flow. AÇÃO QUE MODIFICA. Antes de chamar, confirme o entendimento com o usuário ("vou criar tarefa X com prazo Y pra Iza, OK?"). Use o nome do responsável (Iza, Mariana, Maikon) e o agente resolve pro UUID.',
  input_schema: {
    type: 'object',
    properties: {
      titulo: { type: 'string', description: 'Título da tarefa' },
      descricao: { type: 'string', description: 'Detalhes (opcional)' },
      responsavel_nome: { type: 'string', description: 'Iza, Mariana ou Maikon' },
      prazo_iso: { type: 'string', description: 'Prazo em ISO 8601 (ex: 2026-04-30T18:00:00Z). Se omitido, sem prazo.' },
    },
    required: ['titulo', 'responsavel_nome'],
  },
  async handler(args, ctx) {
    const { data: profiles } = await ctx.supa
      .from('profiles')
      .select('id, nome')
      .eq('ativo', true);
    const respNome = (args.responsavel_nome as string).toLowerCase().trim();
    const dono = (profiles || []).find((p: { nome?: string }) =>
      (p.nome || '').toLowerCase().includes(respNome)
    );
    if (!dono) {
      return { ok: false, error: `Responsável "${args.responsavel_nome}" não encontrado` };
    }
    // Pega 1ª coluna não-finalizada
    const { data: colunas } = await ctx.supa
      .from('task_flow_columns')
      .select('id, nome, ordem')
      .order('ordem')
      .limit(5);
    const colInicial = (colunas || []).find((c: { nome?: string }) => {
      const n = (c.nome || '').toLowerCase();
      return !n.includes('finaliz') && !n.includes('conclu');
    });
    const { data, error } = await ctx.supa
      .from('task_flow_tasks')
      .insert({
        titulo: args.titulo,
        descricao: args.descricao || null,
        assigned_to: (dono as { id: string }).id,
        prazo: args.prazo_iso || null,
        column_id: (colInicial as { id?: string } | undefined)?.id || null,
        created_by: ctx.userId,
      })
      .select('id, titulo')
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, tarefa_id: (data as { id: string }).id, titulo: (data as { titulo: string }).titulo, atribuida_a: (dono as { nome?: string }).nome };
  },
};

// ============================================================================
// Agenda
// ============================================================================

const listarAgenda: ToolDefinition = {
  name: 'listar_agenda',
  description: 'Lista eventos da agenda. Use quando Maikon perguntar "qual minha agenda hoje", "amanhã", "essa semana", etc.',
  input_schema: {
    type: 'object',
    properties: {
      periodo: {
        type: 'string',
        enum: ['hoje', 'amanha', 'semana', 'mes'],
        description: 'Período da agenda',
        default: 'hoje',
      },
    },
  },
  async handler(args, ctx) {
    const periodo = (args.periodo as string) ?? 'hoje';
    const agora = new Date();
    let inicio = new Date(agora);
    let fim = new Date(agora);
    if (periodo === 'hoje') {
      inicio.setHours(0, 0, 0, 0); fim.setHours(23, 59, 59);
    } else if (periodo === 'amanha') {
      inicio.setDate(inicio.getDate() + 1); inicio.setHours(0, 0, 0, 0);
      fim.setDate(fim.getDate() + 1); fim.setHours(23, 59, 59);
    } else if (periodo === 'semana') {
      fim.setDate(fim.getDate() + 7);
    } else if (periodo === 'mes') {
      fim.setMonth(fim.getMonth() + 1);
    }
    const { data, error } = await ctx.supa
      .from('eventos_agenda')
      .select('titulo, data_hora_inicio, data_hora_fim, tipo_evento, descricao')
      .gte('data_hora_inicio', inicio.toISOString())
      .lt('data_hora_inicio', fim.toISOString())
      .order('data_hora_inicio');
    if (error) throw new Error(error.message);
    return {
      periodo,
      total: (data || []).length,
      eventos: (data || []).map((e: { titulo: string; data_hora_inicio: string; tipo_evento?: string }) => ({
        titulo: e.titulo,
        quando: e.data_hora_inicio,
        tipo: e.tipo_evento || 'evento',
      })),
    };
  },
};

// ============================================================================
// Campanhas
// ============================================================================

const listarCampanhas: ToolDefinition = {
  name: 'listar_campanhas',
  description: 'Lista campanhas de prospecção (status, métricas). Use quando Maikon perguntar sobre os disparos, status de campanhas, "como tá o disparo X".',
  input_schema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['ativa', 'rascunho', 'pausada', 'finalizada', 'todas'],
        default: 'todas',
      },
    },
  },
  async handler(args, ctx) {
    const status = (args.status as string) ?? 'todas';
    let q = ctx.supa
      .from('campanhas_disparo')
      .select('id, nome, status, total_leads, enviados, sucesso, falhas, created_at')
      .order('created_at', { ascending: false })
      .limit(20);
    if (status !== 'todas') q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return {
      total: (data || []).length,
      campanhas: data,
    };
  },
};

// ============================================================================
// Memória do agente
// ============================================================================

const salvarMemoria: ToolDefinition = {
  name: 'salvar_memoria',
  description: 'Registra um fato/preferência sobre o usuário (Maikon) pra lembrar em conversas futuras. Use quando ele expressar preferência, rotina, ou fato relevante. Ex: "prefiro mensagens curtas", "sempre opero terça e quinta", "Iza é responsável pelo X".',
  input_schema: {
    type: 'object',
    properties: {
      chave: { type: 'string', description: 'Chave curta identificadora (ex: "preferencia_resposta_curta")' },
      valor: { type: 'string', description: 'O fato/preferência em si' },
      categoria: {
        type: 'string',
        enum: ['preferencia', 'fato', 'contato', 'rotina'],
        default: 'fato',
      },
      importancia: { type: 'integer', minimum: 1, maximum: 5, default: 3 },
    },
    required: ['chave', 'valor'],
  },
  async handler(args, ctx) {
    const { error } = await ctx.supa
      .from('assistente_memoria')
      .upsert({
        user_id: ctx.userId,
        chave: args.chave,
        valor: args.valor,
        categoria: args.categoria || 'fato',
        importancia: args.importancia || 3,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,chave' });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
};

const buscarMemoria: ToolDefinition = {
  name: 'buscar_memoria',
  description: 'Busca fatos/preferências guardados sobre o usuário. Use quando precisar de contexto pessoal pra responder.',
  input_schema: {
    type: 'object',
    properties: {
      termo: { type: 'string', description: 'Termo de busca na chave/valor (case-insensitive). Vazio = lista top 10 mais importantes.' },
    },
  },
  async handler(args, ctx) {
    const termo = (args.termo as string) || '';
    let q = ctx.supa
      .from('assistente_memoria')
      .select('chave, valor, categoria, importancia')
      .eq('user_id', ctx.userId)
      .order('importancia', { ascending: false })
      .limit(15);
    if (termo) q = q.or(`chave.ilike.%${termo}%,valor.ilike.%${termo}%`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { total: (data || []).length, memorias: data };
  },
};

// ============================================================================
// Export
// ============================================================================

export const ALL_TOOLS: ToolDefinition[] = [
  listarConversasPendentes,
  listarTarefas,
  criarTarefa,
  listarAgenda,
  listarCampanhas,
  salvarMemoria,
  buscarMemoria,
];

// Schemas pra enviar ao Anthropic API
export const TOOL_SCHEMAS = ALL_TOOLS.map(t => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema,
}));

// Mapa pra invocar handler pelo nome
export const TOOL_HANDLERS: Record<string, ToolDefinition['handler']> =
  Object.fromEntries(ALL_TOOLS.map(t => [t.name, t.handler]));
