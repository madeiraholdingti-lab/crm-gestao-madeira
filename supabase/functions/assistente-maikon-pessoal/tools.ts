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
  // Mídia capturada no turno atual do webhook — usado pelas tools de indexação G4.
  currentAudioBase64?: string | null;
  currentAudioMime?: string | null;
  currentAudioDuracaoSeg?: number;
  currentWaMessageId?: string | null;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

// Helpers compartilhados
function normalizarFone(s: string): string {
  return s.replace(/\D/g, '');
}

// Pega access_token do Google p/ user atual. Refresh automático via OAuth.
// Retorna { ok: true, token } ou { ok: false, error }.
async function googleAccessToken(
  ctx: ToolContext,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const encKey = Deno.env.get('GOOGLE_TOKEN_ENCRYPTION_KEY');
  if (!encKey) return { ok: false, error: 'GOOGLE_TOKEN_ENCRYPTION_KEY ausente' };
  const { data: contas, error } = await ctx.supa.rpc('get_active_google_accounts_decrypted', {
    key: encKey,
  });
  if (error) return { ok: false, error: error.message };
  const conta = (contas || []).find((c: { user_id: string }) => c.user_id === ctx.userId) as
    | { id: string; refresh_token: string; access_token: string; expires_at: string | null }
    | undefined;
  if (!conta) return { ok: false, error: 'Maikon não tem conta Google ativa — re-autoriza em /perfil' };

  const expiresAt = conta.expires_at ? new Date(conta.expires_at).getTime() : 0;
  if (conta.access_token && expiresAt - Date.now() > 5 * 60 * 1000) {
    return { ok: true, token: conta.access_token };
  }
  // Refresh
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  if (!clientId || !clientSecret) return { ok: false, error: 'GOOGLE_CLIENT_ID/SECRET ausentes' };
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: conta.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!r.ok) return { ok: false, error: `refresh ${r.status}` };
  const j = await r.json() as { access_token: string; expires_in: number };
  await ctx.supa.rpc('update_google_account_tokens', {
    p_account_id: conta.id,
    p_access_token: j.access_token,
    p_expires_at: new Date(Date.now() + j.expires_in * 1000).toISOString(),
    p_encryption_key: encKey,
  });
  return { ok: true, token: j.access_token };
}

function decodeBase64Url(s: string): string {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 ? norm + '='.repeat(4 - (norm.length % 4)) : norm;
  try {
    const bin = atob(pad);
    // Decode as UTF-8
    return new TextDecoder('utf-8').decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  } catch {
    return '';
  }
}

function gmailHeader(headers: Array<{ name: string; value: string }> | undefined, nome: string): string {
  if (!headers) return '';
  const h = headers.find(x => x.name.toLowerCase() === nome.toLowerCase());
  return h?.value || '';
}

function gmailExtractText(payload: { mimeType?: string; body?: { data?: string }; parts?: unknown[] } | undefined): string {
  if (!payload) return '';
  if (payload.mimeType?.startsWith('text/plain') && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const p of payload.parts as Array<{ mimeType?: string; body?: { data?: string }; parts?: unknown[] }>) {
      const t = gmailExtractText(p);
      if (t) return t;
    }
  }
  // Fallback: tenta html stripado
  if (payload.mimeType?.startsWith('text/html') && payload.body?.data) {
    return decodeBase64Url(payload.body.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  }
  return '';
}

// ============================================================================
// CRM - Contatos (busca, criação, atualização)
// ============================================================================

const buscarContato: ToolDefinition = {
  name: 'buscar_contato',
  description: 'Busca contato por nome, telefone ou parte do nome. Use quando Maikon mencionar um nome ("acha o Dr. Pedro Silva"), pedir info de um contato, ou quando precisar do contact_id pra outra tool. Retorna até 8 matches com perfil profissional, instituição, instâncias em que tem conversa.',
  input_schema: {
    type: 'object',
    properties: {
      termo: { type: 'string', description: 'Nome (parcial), telefone (com ou sem DDD), ou jid' },
    },
    required: ['termo'],
  },
  async handler(args, ctx) {
    const termo = (args.termo as string).trim();
    if (!termo) return { ok: false, error: 'termo vazio' };

    // Heurística: se 5+ dígitos, busca por telefone; senão por nome
    const digitos = normalizarFone(termo);
    let q = ctx.supa
      .from('contacts')
      .select('id, name, phone, jid, lid_jid, perfil_profissional, especialidade, instituicao')
      .limit(8);

    if (digitos.length >= 5) {
      // Busca pelos últimos 8 dígitos pra ignorar variações de DDD/9
      const sufixo = digitos.slice(-8);
      q = q.ilike('phone', `%${sufixo}%`);
    } else {
      q = q.ilike('name', `%${termo}%`);
    }

    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const contatos = (data || []) as Array<{
      id: string; name: string | null; phone: string;
      perfil_profissional: string | null; especialidade: string | null; instituicao: string | null;
    }>;

    // Pra cada contato, conta conversas (rápido)
    const ids = contatos.map(c => c.id);
    let convsPorContato: Record<string, number> = {};
    if (ids.length > 0) {
      const { data: convs } = await ctx.supa
        .from('conversas')
        .select('contact_id')
        .in('contact_id', ids);
      for (const c of (convs || []) as Array<{ contact_id: string }>) {
        convsPorContato[c.contact_id] = (convsPorContato[c.contact_id] || 0) + 1;
      }
    }

    return {
      ok: true,
      total: contatos.length,
      contatos: contatos.map(c => ({
        id: c.id,
        nome: c.name || '(sem nome)',
        telefone: c.phone,
        perfil_profissional: c.perfil_profissional,
        especialidade: c.especialidade,
        instituicao: c.instituicao,
        conversas: convsPorContato[c.id] || 0,
      })),
    };
  },
};

const criarContato: ToolDefinition = {
  name: 'criar_contato',
  description: 'Cria contato novo no CRM. AÇÃO QUE MODIFICA. Confirme com o Maikon antes ("vou criar contato X com telefone Y, OK?"). Telefone deve incluir DDD. Use quando ele falar "salva esse contato" ou cadastrar alguém novo.',
  input_schema: {
    type: 'object',
    properties: {
      nome: { type: 'string' },
      telefone: { type: 'string', description: 'Telefone com DDD, com ou sem +55. Ex: 5547999998888 ou 47999998888.' },
      perfil_profissional: { type: 'string', description: 'Ex: cirurgiao_cardiaco, anestesista, gestor, paciente, enfermeiro' },
      especialidade: { type: 'string' },
      instituicao: { type: 'string' },
    },
    required: ['nome', 'telefone'],
  },
  async handler(args, ctx) {
    const digitos = normalizarFone(args.telefone as string);
    if (digitos.length < 10) return { ok: false, error: 'telefone inválido (precisa DDD)' };
    // Adiciona 55 se não tiver
    const phone = digitos.startsWith('55') ? digitos : `55${digitos}`;
    const jid = `${phone}@s.whatsapp.net`;

    const { data: existe } = await ctx.supa
      .from('contacts')
      .select('id, name')
      .eq('jid', jid)
      .maybeSingle();
    if (existe) {
      return { ok: false, error: 'já existe', contato_id: (existe as { id: string }).id, nome: (existe as { name: string }).name };
    }

    const { data, error } = await ctx.supa
      .from('contacts')
      .insert({
        name: args.nome,
        phone,
        jid,
        perfil_profissional: args.perfil_profissional || null,
        especialidade: args.especialidade || null,
        instituicao: args.instituicao || null,
        perfil_confirmado: !!args.perfil_profissional,
      })
      .select('id, name, phone')
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, contato_id: (data as { id: string }).id, nome: (data as { name: string }).name, telefone: phone };
  },
};

const atualizarContato: ToolDefinition = {
  name: 'atualizar_contato',
  description: 'Atualiza dados de um contato existente. Use pra tagear perfil profissional, vincular instituição, corrigir nome. Não usa pra renomear pessoas — só pra completar dados faltantes.',
  input_schema: {
    type: 'object',
    properties: {
      contato_id: { type: 'string', description: 'UUID do contato (use buscar_contato antes pra achar)' },
      nome: { type: 'string' },
      perfil_profissional: { type: 'string' },
      especialidade: { type: 'string' },
      instituicao: { type: 'string' },
    },
    required: ['contato_id'],
  },
  async handler(args, ctx) {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (args.nome) update.name = args.nome;
    if (args.perfil_profissional) {
      update.perfil_profissional = args.perfil_profissional;
      update.perfil_confirmado = true;
      update.classificado_em = new Date().toISOString();
    }
    if (args.especialidade) update.especialidade = args.especialidade;
    if (args.instituicao) update.instituicao = args.instituicao;

    const { error } = await ctx.supa
      .from('contacts')
      .update(update)
      .eq('id', args.contato_id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, atualizado: Object.keys(update).filter(k => k !== 'updated_at') };
  },
};

const buscarConversa: ToolDefinition = {
  name: 'buscar_conversa',
  description: 'Lista conversas WhatsApp de um contato em todas as instâncias da clínica. Use quando Maikon perguntar "tive conversa com X?", "qual a última msg do Y?". Retorna até 5 conversas com instância, status, última msg, há quanto tempo.',
  input_schema: {
    type: 'object',
    properties: {
      contato_id: { type: 'string', description: 'UUID do contato (preferencial)' },
      termo: { type: 'string', description: 'Alternativa: nome ou telefone. Se passado, faz busca interna primeiro.' },
    },
  },
  async handler(args, ctx) {
    let contactId = args.contato_id as string | undefined;
    if (!contactId && args.termo) {
      const r = await buscarContato.handler({ termo: args.termo }, ctx) as { contatos?: Array<{ id: string }> };
      contactId = r.contatos?.[0]?.id;
    }
    if (!contactId) return { ok: false, error: 'contato não encontrado' };

    const { data, error } = await ctx.supa
      .from('conversas')
      .select('id, status, ultima_mensagem, ultima_interacao, last_message_from_me, tags, instancias_whatsapp(nome_instancia)')
      .eq('contact_id', contactId)
      .order('ultima_interacao', { ascending: false })
      .limit(5);
    if (error) return { ok: false, error: error.message };

    return {
      ok: true,
      contato_id: contactId,
      total: (data || []).length,
      conversas: (data || []).map((c: {
        id: string; status: string; ultima_mensagem: string | null;
        ultima_interacao: string | null; last_message_from_me: boolean | null;
        tags: string[] | null; instancias_whatsapp?: { nome_instancia: string };
      }) => ({
        conversa_id: c.id,
        instancia: c.instancias_whatsapp?.nome_instancia || '?',
        status: c.status,
        ultima_msg: (c.ultima_mensagem || '').slice(0, 200),
        ultima_interacao: c.ultima_interacao,
        ultima_foi_nossa: c.last_message_from_me,
        tags: c.tags || [],
      })),
    };
  },
};

const resumirConversa: ToolDefinition = {
  name: 'resumir_conversa',
  description: 'Resume conversa de um contato usando as últimas N mensagens (modelo messages). Use quando Maikon perguntar "resume a conversa com X", "do que tratamos com Y", "o que ficou pendente com Z". Usa Haiku 4.5 (barato).',
  input_schema: {
    type: 'object',
    properties: {
      contato_id: { type: 'string', description: 'UUID do contato' },
      ultimas_n: { type: 'integer', default: 30, minimum: 5, maximum: 100 },
    },
    required: ['contato_id'],
  },
  async handler(args, ctx) {
    const ultimas = (args.ultimas_n as number) || 30;
    const { data: msgs, error } = await ctx.supa
      .from('messages')
      .select('text, from_me, wa_timestamp, message_type, instance')
      .eq('contact_id', args.contato_id)
      .order('wa_timestamp', { ascending: false })
      .limit(ultimas);
    if (error) return { ok: false, error: error.message };
    if (!msgs || msgs.length === 0) return { ok: false, error: 'sem mensagens' };

    const { data: contato } = await ctx.supa
      .from('contacts')
      .select('name, phone, perfil_profissional, instituicao')
      .eq('id', args.contato_id)
      .single();
    const c = contato as { name: string | null; phone: string; perfil_profissional: string | null; instituicao: string | null } | null;

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return { ok: false, error: 'ANTHROPIC_API_KEY ausente' };

    // Monta histórico ordem cronológica
    const historico = (msgs as Array<{ text: string | null; from_me: boolean; wa_timestamp: number | null; message_type: string | null }>)
      .reverse()
      .map(m => `${m.from_me ? 'Equipe' : 'Contato'}: ${m.text || `[${m.message_type || 'mídia'}]`}`)
      .join('\n');

    const prompt = `Resume essa conversa do CRM do Dr. Maikon Madeira em PT-BR.

Contato: ${c?.name || '?'} (${c?.phone || ''})${c?.perfil_profissional ? ` — ${c.perfil_profissional}` : ''}${c?.instituicao ? ` da ${c.instituicao}` : ''}

CONVERSA (${msgs.length} últimas mensagens):
${historico.slice(0, 8000)}

ENTREGA:
- 1 frase: do que se trata
- 2-3 bullets: pontos principais discutidos
- 1 frase: pendência atual (se houver) ou "conversa em dia"
Total: máximo 80 palavras. Direto, sem floreio.`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!r.ok) return { ok: false, error: `Anthropic ${r.status}` };
    const j = await r.json();
    const resumo = (j.content?.[0]?.text || '').trim();

    return {
      ok: true,
      contato: c?.name || '(sem nome)',
      total_msgs_analisadas: msgs.length,
      resumo,
    };
  },
};

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
      .select('id, titulo, prazo, responsavel_id, task_flow_columns!task_flow_tasks_column_id_fkey(nome), task_flow_profiles!task_flow_tasks_responsavel_id_fkey(nome)')
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
      .filter((t: { task_flow_profiles?: { nome?: string } }) => {
        if (!respNome) return true;
        return (t.task_flow_profiles?.nome || '').toLowerCase().includes(respNome);
      });
    return {
      total: list.length,
      tarefas: list.slice(0, 15).map((t: { id: string; titulo: string; prazo: string | null; task_flow_profiles?: { nome?: string } }) => ({
        id: t.id,
        titulo: t.titulo,
        prazo: t.prazo,
        responsavel: t.task_flow_profiles?.nome || '—',
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
    // task_flow_profiles é separado de profiles — é o perfil dentro do board (Iza, Mariana, Maikon)
    const { data: tfProfiles } = await ctx.supa
      .from('task_flow_profiles')
      .select('id, nome')
      .eq('ativo', true);
    const respNome = (args.responsavel_nome as string).toLowerCase().trim();
    const dono = (tfProfiles || []).find((p: { nome?: string }) =>
      (p.nome || '').toLowerCase().includes(respNome)
    ) as { id: string; nome: string } | undefined;
    if (!dono) {
      return { ok: false, error: `Responsável "${args.responsavel_nome}" não encontrado em task_flow_profiles` };
    }
    // Pega 1ª coluna não-finalizada (ordenada)
    const { data: colunas } = await ctx.supa
      .from('task_flow_columns')
      .select('id, nome, ordem')
      .order('ordem')
      .limit(5);
    const colInicial = (colunas || []).find((c: { nome?: string }) => {
      const n = (c.nome || '').toLowerCase();
      return !n.includes('finaliz') && !n.includes('conclu');
    }) as { id: string } | undefined;

    // Resolve criado_por_id (procura task_flow_profile do Maikon, fallback null)
    let criadoPorId: string | null = null;
    const maikon = (tfProfiles || []).find((p: { nome?: string }) =>
      (p.nome || '').toLowerCase().includes('maikon'),
    ) as { id: string } | undefined;
    if (maikon) criadoPorId = maikon.id;

    const { data, error } = await ctx.supa
      .from('task_flow_tasks')
      .insert({
        titulo: args.titulo,
        descricao: args.descricao || null,
        responsavel_id: dono.id,
        criado_por_id: criadoPorId,
        prazo: args.prazo_iso || null,
        column_id: colInicial?.id || null,
        origem: 'ia',
      })
      .select('id, titulo')
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, tarefa_id: (data as { id: string }).id, titulo: (data as { titulo: string }).titulo, atribuida_a: dono.nome };
  },
};

// ============================================================================
// Tarefas — atualização avançada (Fase 3)
// ============================================================================

async function getMaikonTaskFlowProfileId(ctx: ToolContext): Promise<string | null> {
  const { data } = await ctx.supa
    .from('task_flow_profiles')
    .select('id')
    .ilike('nome', '%maikon%')
    .eq('ativo', true)
    .limit(1)
    .maybeSingle();
  return (data as { id?: string } | null)?.id || null;
}

const atualizarTarefa: ToolDefinition = {
  name: 'atualizar_tarefa',
  description: 'Atualiza tarefa existente: muda prazo, responsável, descrição, ou move pra outra coluna do Kanban. AÇÃO QUE MODIFICA — confirme antes. Use buscar tarefas (listar_tarefas) pra obter o tarefa_id.',
  input_schema: {
    type: 'object',
    properties: {
      tarefa_id: { type: 'string' },
      novo_prazo_iso: { type: 'string', description: 'Novo prazo ISO 8601, ou null pra remover prazo' },
      novo_responsavel_nome: { type: 'string', description: 'Iza, Mariana, Maikon' },
      nova_descricao: { type: 'string' },
      mover_pra_coluna: { type: 'string', description: 'Nome (parcial) da coluna destino, ex: "Em Andamento", "Concluída"' },
    },
    required: ['tarefa_id'],
  },
  async handler(args, ctx) {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    let mudancas: string[] = [];

    if (args.novo_prazo_iso !== undefined) {
      update.prazo = args.novo_prazo_iso || null;
      mudancas.push('prazo');
    }
    if (args.nova_descricao) {
      update.descricao = args.nova_descricao;
      mudancas.push('descrição');
    }
    if (args.novo_responsavel_nome) {
      const { data: tfProfiles } = await ctx.supa
        .from('task_flow_profiles')
        .select('id, nome')
        .eq('ativo', true);
      const novo = (tfProfiles || []).find((p: { nome?: string }) =>
        (p.nome || '').toLowerCase().includes((args.novo_responsavel_nome as string).toLowerCase()),
      ) as { id: string } | undefined;
      if (!novo) return { ok: false, error: `responsável "${args.novo_responsavel_nome}" não encontrado` };
      update.responsavel_id = novo.id;
      mudancas.push('responsável');
    }
    if (args.mover_pra_coluna) {
      const { data: cols } = await ctx.supa
        .from('task_flow_columns')
        .select('id, nome');
      const col = ((cols || []) as Array<{ id: string; nome: string }>).find(c =>
        c.nome.toLowerCase().includes((args.mover_pra_coluna as string).toLowerCase()),
      );
      if (!col) return { ok: false, error: `coluna "${args.mover_pra_coluna}" não encontrada` };
      update.column_id = col.id;
      mudancas.push(`movida pra "${col.nome}"`);
    }

    const { error } = await ctx.supa
      .from('task_flow_tasks')
      .update(update)
      .eq('id', args.tarefa_id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, mudancas };
  },
};

const concluirTarefa: ToolDefinition = {
  name: 'concluir_tarefa',
  description: 'Move uma tarefa pra coluna de finalizada/concluída. Atalho pra "atualizar_tarefa + mover_pra_coluna=Concluída". Use quando Maikon disser "marca tarefa X como feita".',
  input_schema: {
    type: 'object',
    properties: {
      tarefa_id: { type: 'string' },
    },
    required: ['tarefa_id'],
  },
  async handler(args, ctx) {
    const { data: cols } = await ctx.supa
      .from('task_flow_columns')
      .select('id, nome');
    const colFinal = ((cols || []) as Array<{ id: string; nome: string }>).find(c => {
      const n = c.nome.toLowerCase();
      return n.includes('conclu') || n.includes('finaliz') || n.includes('feito') || n.includes('done');
    });
    if (!colFinal) return { ok: false, error: 'nenhuma coluna de finalizada encontrada' };
    const { error } = await ctx.supa
      .from('task_flow_tasks')
      .update({ column_id: colFinal.id, updated_at: new Date().toISOString() })
      .eq('id', args.tarefa_id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, movida_para: colFinal.nome };
  },
};

const comentarTarefa: ToolDefinition = {
  name: 'comentar_tarefa',
  description: 'Adiciona um comentário/nota numa tarefa. Comentário é registrado em nome do Maikon. Use quando ele disser "adiciona nota X na tarefa Y" ou pra registrar atualização sem mover/mudar.',
  input_schema: {
    type: 'object',
    properties: {
      tarefa_id: { type: 'string' },
      texto: { type: 'string' },
    },
    required: ['tarefa_id', 'texto'],
  },
  async handler(args, ctx) {
    const autorId = await getMaikonTaskFlowProfileId(ctx);
    const { error } = await ctx.supa
      .from('task_flow_comments')
      .insert({
        task_id: args.tarefa_id,
        autor_id: autorId,
        texto: args.texto,
        tipo: 'nota',
      });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
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
      .select('id, titulo, data_hora_inicio, data_hora_fim, tipo_evento, descricao, google_event_id, origem')
      .gte('data_hora_inicio', inicio.toISOString())
      .lt('data_hora_inicio', fim.toISOString())
      .order('data_hora_inicio');
    if (error) throw new Error(error.message);
    return {
      periodo,
      total: (data || []).length,
      eventos: (data || []).map((e: {
        id: string; titulo: string; data_hora_inicio: string; data_hora_fim: string | null;
        tipo_evento?: string; google_event_id: string | null; origem?: string;
      }) => ({
        evento_id: e.id,
        google_event_id: e.google_event_id,
        titulo: e.titulo,
        quando: e.data_hora_inicio,
        ate: e.data_hora_fim,
        tipo: e.tipo_evento || 'evento',
        origem: e.origem || 'crm',
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
// Disparos / Campanhas (Fase 2 — write completo)
// ============================================================================

const detalharCampanha: ToolDefinition = {
  name: 'detalhar_campanha',
  description: 'Retorna detalhe completo de UMA campanha: status, métricas (enviados/sucesso/falhas/taxa resposta), leads quentes pendentes, chip(s) usados e saúde, briefing resumido. Use quando Maikon perguntar "como tá a campanha X?" ou "qual taxa da Pediatria Chapecó?".',
  input_schema: {
    type: 'object',
    properties: {
      campanha_id: { type: 'string', description: 'UUID. Use listar_campanhas pra encontrar se não souber.' },
      nome: { type: 'string', description: 'Alternativa: nome (parcial). Se passado, busca primeiro.' },
    },
  },
  async handler(args, ctx) {
    let id = args.campanha_id as string | undefined;
    if (!id && args.nome) {
      const { data: m } = await ctx.supa
        .from('campanhas_disparo')
        .select('id')
        .ilike('nome', `%${args.nome}%`)
        .limit(1)
        .maybeSingle();
      id = (m as { id?: string } | null)?.id;
    }
    if (!id) return { ok: false, error: 'campanha não encontrada' };

    const { data: campanha, error } = await ctx.supa
      .from('campanhas_disparo')
      .select('id, nome, descricao, status, ativo, total_leads, enviados, sucesso, falhas, tipo, instancia_id, chip_ids, briefing_ia, iniciado_em')
      .eq('id', id)
      .single();
    if (error) return { ok: false, error: error.message };
    const c = campanha as {
      id: string; nome: string; status: string; ativo: boolean;
      total_leads: number; enviados: number; sucesso: number; falhas: number;
      tipo: string | null; instancia_id: string | null; chip_ids: string[] | null;
      briefing_ia: Record<string, unknown> | null; iniciado_em: string | null;
    };

    // Maturidade dos envios (frio/morno/quente)
    const { data: matAgg } = await ctx.supa
      .from('campanha_envios')
      .select('maturidade')
      .eq('campanha_id', id);
    const maturidade = { frio: 0, morno: 0, quente: 0, sem: 0 };
    for (const r of (matAgg || []) as Array<{ maturidade: string | null }>) {
      const k = (r.maturidade || 'sem') as keyof typeof maturidade;
      maturidade[k] = (maturidade[k] || 0) + 1;
    }

    // Handoffs disparados
    const { count: handoffs } = await ctx.supa
      .from('campanha_envios')
      .select('id', { count: 'exact', head: true })
      .eq('campanha_id', id)
      .eq('handoff_disparado', true);

    // Chip(s) usados — saúde
    const chipIds = c.chip_ids || (c.instancia_id ? [c.instancia_id] : []);
    let chipsInfo: Array<{ nome: string; ativo: boolean; finalidade: string | null }> = [];
    if (chipIds.length > 0) {
      const { data: chips } = await ctx.supa
        .from('instancias_whatsapp')
        .select('nome_instancia, ativo, finalidade')
        .in('id', chipIds);
      chipsInfo = ((chips || []) as Array<{ nome_instancia: string; ativo: boolean; finalidade: string | null }>)
        .map(x => ({ nome: x.nome_instancia, ativo: x.ativo, finalidade: x.finalidade }));
    }

    const taxaResposta = c.enviados > 0 ? Math.round(((handoffs || 0) / c.enviados) * 100) : 0;

    return {
      ok: true,
      campanha: {
        id: c.id,
        nome: c.nome,
        tipo: c.tipo,
        status: c.status,
        ativa_efetivamente: c.status === 'ativa' && c.ativo,
        iniciado_em: c.iniciado_em,
      },
      metricas: {
        total_leads: c.total_leads,
        enviados: c.enviados,
        sucesso: c.sucesso,
        falhas: c.falhas,
        taxa_envio_pct: c.total_leads > 0 ? Math.round((c.enviados / c.total_leads) * 100) : 0,
        handoffs: handoffs || 0,
        taxa_resposta_pct: taxaResposta,
        maturidade,
      },
      chips: chipsInfo,
      briefing_resumo: c.briefing_ia
        ? Object.keys(c.briefing_ia).slice(0, 5)
        : 'sem briefing v9',
    };
  },
};

const enviarMensagemAvulsa: ToolDefinition = {
  name: 'enviar_mensagem_avulsa',
  description: 'Envia 1 mensagem WhatsApp avulsa do chip de DISPARO (NÃO de atendimento) pra um contato. AÇÃO QUE MODIFICA. SEMPRE confirme antes ("vou mandar do chip X pra Y a msg ZZ, OK?"). Use quando Maikon disser "manda mensagem pro Hospital Y dizendo que volto na segunda".',
  input_schema: {
    type: 'object',
    properties: {
      contato_id: { type: 'string', description: 'UUID do contato. Use buscar_contato antes.' },
      telefone: { type: 'string', description: 'Alternativa: telefone direto (com DDD).' },
      texto: { type: 'string', description: 'Mensagem a enviar.' },
      chip_disparo_id: { type: 'string', description: 'UUID do chip de disparo. Se omitido, escolhe o primeiro chip ativo com finalidade=disparo.' },
    },
    required: ['texto'],
  },
  async handler(args, ctx) {
    if (!args.contato_id && !args.telefone) return { ok: false, error: 'precisa contato_id ou telefone' };

    let phone = '';
    if (args.contato_id) {
      const { data } = await ctx.supa.from('contacts').select('phone').eq('id', args.contato_id).single();
      phone = (data as { phone?: string } | null)?.phone || '';
    } else {
      phone = normalizarFone(args.telefone as string);
      if (!phone.startsWith('55')) phone = `55${phone}`;
    }
    if (!phone) return { ok: false, error: 'telefone não resolvido' };

    // Seleciona chip
    let chipId = args.chip_disparo_id as string | undefined;
    let chipNome = '';
    if (!chipId) {
      const { data: chip } = await ctx.supa
        .from('instancias_whatsapp')
        .select('id, nome_instancia')
        .eq('finalidade', 'disparo')
        .eq('ativo', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!chip) return { ok: false, error: 'nenhum chip de disparo ativo' };
      chipId = (chip as { id: string }).id;
      chipNome = (chip as { nome_instancia: string }).nome_instancia;
    } else {
      const { data: chip } = await ctx.supa
        .from('instancias_whatsapp')
        .select('nome_instancia, finalidade, ativo')
        .eq('id', chipId)
        .single();
      const cc = chip as { nome_instancia: string; finalidade: string; ativo: boolean } | null;
      if (!cc || !cc.ativo) return { ok: false, error: 'chip inativo ou inexistente' };
      if (cc.finalidade && cc.finalidade !== 'disparo') {
        return { ok: false, error: `chip "${cc.nome_instancia}" é de ${cc.finalidade}, não disparo. Anti-ban: não use chip de atendimento pra disparo.` };
      }
      chipNome = cc.nome_instancia;
    }

    // Envia via Evolution
    const { data: cfg } = await ctx.supa
      .from('config_global')
      .select('evolution_base_url, evolution_api_key')
      .single();
    const url = (cfg as { evolution_base_url?: string } | null)?.evolution_base_url;
    const key = (cfg as { evolution_api_key?: string } | null)?.evolution_api_key;
    if (!url || !key) return { ok: false, error: 'config Evolution incompleta' };

    const r = await fetch(`${url}/message/sendText/${encodeURIComponent(chipNome)}`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: phone, text: args.texto }),
    });
    if (!r.ok) {
      const txt = await r.text();
      return { ok: false, error: `Evolution ${r.status}: ${txt.slice(0, 200)}` };
    }
    return {
      ok: true,
      enviado_de: chipNome,
      enviado_para: phone,
      texto_preview: (args.texto as string).slice(0, 100),
    };
  },
};

const criarCampanha: ToolDefinition = {
  name: 'criar_campanha',
  description: 'Cria campanha de prospecção/evento/reativação. AÇÃO QUE MODIFICA — confirme tudo antes. Cria em status=rascunho (não dispara). Pra ativar, use controlar_campanha. Briefing v9 vai num campo JSONB que a IA usa pra responder.',
  input_schema: {
    type: 'object',
    properties: {
      nome: { type: 'string' },
      tipo: { type: 'string', enum: ['prospeccao', 'evento', 'reativacao', 'divulgacao', 'pos_operatorio'], default: 'prospeccao' },
      mensagem_inicial: { type: 'string', description: 'Texto base pra primeiro envio. Pode usar {{nome}} pra personalizar.' },
      chip_disparo_id: { type: 'string', description: 'UUID do chip (use listar pra escolher). Aceita só finalidade=disparo.' },
      briefing: {
        type: 'object',
        description: 'Opcional. Estrutura v9 (oportunidade, persona, handoff_telefones[], etc). Se omitido, IA usa fallback.',
      },
    },
    required: ['nome', 'mensagem_inicial', 'chip_disparo_id'],
  },
  async handler(args, ctx) {
    // Valida chip
    const { data: chip } = await ctx.supa
      .from('instancias_whatsapp')
      .select('finalidade, ativo')
      .eq('id', args.chip_disparo_id)
      .single();
    const cc = chip as { finalidade: string; ativo: boolean } | null;
    if (!cc) return { ok: false, error: 'chip não encontrado' };
    if (cc.finalidade && cc.finalidade !== 'disparo') {
      return { ok: false, error: `chip é de ${cc.finalidade}, não disparo` };
    }

    const { data, error } = await ctx.supa
      .from('campanhas_disparo')
      .insert({
        nome: args.nome,
        tipo: args.tipo || 'prospeccao',
        mensagem: args.mensagem_inicial,
        instancia_id: args.chip_disparo_id,
        chip_ids: [args.chip_disparo_id],
        briefing_ia: args.briefing || null,
        status: 'rascunho',
        ativo: true,
        created_by: ctx.userId,
      })
      .select('id, nome, status')
      .single();
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      campanha_id: (data as { id: string }).id,
      nome: (data as { nome: string }).nome,
      status: (data as { status: string }).status,
      proximo_passo: 'Adicionar leads via adicionar_leads_campanha, depois ativar via controlar_campanha(acao=ativar).',
    };
  },
};

const controlarCampanha: ToolDefinition = {
  name: 'controlar_campanha',
  description: 'Muda status de uma campanha: ativar, pausar, retomar, finalizar. AÇÃO QUE MODIFICA. Confirme antes de ativar/finalizar.',
  input_schema: {
    type: 'object',
    properties: {
      campanha_id: { type: 'string' },
      acao: { type: 'string', enum: ['ativar', 'pausar', 'retomar', 'finalizar'] },
    },
    required: ['campanha_id', 'acao'],
  },
  async handler(args, ctx) {
    const mapaStatus: Record<string, { status: string; ativo: boolean }> = {
      ativar: { status: 'ativa', ativo: true },
      pausar: { status: 'pausada', ativo: false },
      retomar: { status: 'ativa', ativo: true },
      finalizar: { status: 'concluida', ativo: false },
    };
    const novo = mapaStatus[args.acao as string];
    if (!novo) return { ok: false, error: 'ação inválida' };

    const update: Record<string, unknown> = {
      status: novo.status,
      ativo: novo.ativo,
      updated_at: new Date().toISOString(),
    };
    if (args.acao === 'ativar' || args.acao === 'retomar') {
      update.iniciado_em = new Date().toISOString();
    }
    if (args.acao === 'finalizar') update.concluido_em = new Date().toISOString();

    const { error } = await ctx.supa
      .from('campanhas_disparo')
      .update(update)
      .eq('id', args.campanha_id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, novo_status: novo.status, ativo: novo.ativo };
  },
};

const adicionarLeadsCampanha: ToolDefinition = {
  name: 'adicionar_leads_campanha',
  description: 'Adiciona leads à campanha. Aceita filtros (perfil_profissional, especialidade, instituicao) ou IDs explícitos. Cria entries em campanha_envios pendentes. Atualiza total_leads na campanha. AÇÃO QUE MODIFICA — mostre quantos leads vão entrar antes.',
  input_schema: {
    type: 'object',
    properties: {
      campanha_id: { type: 'string' },
      filtro_perfil: { type: 'string', description: 'Ex: cirurgiao_cardiaco, anestesista' },
      filtro_especialidade: { type: 'string' },
      filtro_instituicao: { type: 'string' },
      lead_ids: { type: 'array', items: { type: 'string' }, description: 'Alternativa: lista direta de leads.id' },
      limite: { type: 'integer', default: 500, maximum: 2000 },
      simular: { type: 'boolean', default: false, description: 'Se true, só conta quantos seriam — não insere.' },
    },
    required: ['campanha_id'],
  },
  async handler(args, ctx) {
    let leadsQ = ctx.supa.from('leads').select('id, telefone, nome', { count: 'exact' }).eq('ativo', true);
    if (args.lead_ids && Array.isArray(args.lead_ids) && args.lead_ids.length > 0) {
      leadsQ = leadsQ.in('id', args.lead_ids as string[]);
    } else {
      // Filtros via JOIN com contacts (lead.telefone == contact.phone aproximado)
      // Pra simplicidade no MVP, filtro direto em leads.tags ou tipo_lead.
      // TODO: linkar leads <-> contacts via telefone pra usar perfil_profissional.
      if (args.filtro_perfil) leadsQ = leadsQ.contains('tags', [args.filtro_perfil]);
    }
    leadsQ = leadsQ.limit((args.limite as number) || 500);
    const { data: leads, error, count } = await leadsQ;
    if (error) return { ok: false, error: error.message };
    const total = count || (leads || []).length;
    if (args.simular) return { ok: true, simulacao: true, leads_que_entrariam: total };

    if (!leads || leads.length === 0) return { ok: false, error: 'nenhum lead corresponde' };

    // Cria envios em batches de 100
    const envios = (leads as Array<{ id: string; telefone: string }>).map(l => ({
      campanha_id: args.campanha_id,
      lead_id: l.id,
      telefone: l.telefone,
      status: 'pendente',
    }));
    let inseridos = 0;
    for (let i = 0; i < envios.length; i += 100) {
      const batch = envios.slice(i, i + 100);
      const { error: errIns } = await ctx.supa.from('campanha_envios').insert(batch);
      if (errIns) return { ok: false, error: errIns.message, ja_inseridos: inseridos };
      inseridos += batch.length;
    }

    // Atualiza total na campanha (incremental)
    const { data: cAtual } = await ctx.supa
      .from('campanhas_disparo')
      .select('total_leads')
      .eq('id', args.campanha_id)
      .single();
    const totalAtual = (cAtual as { total_leads?: number } | null)?.total_leads || 0;
    await ctx.supa
      .from('campanhas_disparo')
      .update({ total_leads: totalAtual + inseridos, updated_at: new Date().toISOString() })
      .eq('id', args.campanha_id);

    return { ok: true, leads_adicionados: inseridos, total_atualizado: totalAtual + inseridos };
  },
};

// ============================================================================
// Google Calendar — escrita (Fase 5)
// ============================================================================

const GCAL_BASE = 'https://www.googleapis.com/calendar/v3';

const criarEvento: ToolDefinition = {
  name: 'criar_evento',
  description: 'Cria evento na agenda primária do Google Calendar do Maikon. AÇÃO QUE MODIFICA — confirme detalhes antes (título, início, fim, convidados). Fuso default America/Sao_Paulo. O evento aparece no celular dele em segundos.',
  input_schema: {
    type: 'object',
    properties: {
      titulo: { type: 'string' },
      inicio_iso: { type: 'string', description: 'ISO 8601 com timezone, ex: 2026-05-15T14:00:00-03:00' },
      fim_iso: { type: 'string', description: 'ISO 8601 com timezone' },
      descricao: { type: 'string' },
      local: { type: 'string', description: 'Endereço ou ref ("Hospital Marieta")' },
      convidados_emails: { type: 'array', items: { type: 'string' }, description: 'Lista de emails pra convidar' },
    },
    required: ['titulo', 'inicio_iso', 'fim_iso'],
  },
  async handler(args, ctx) {
    const tk = await googleAccessToken(ctx);
    if (!tk.ok) return tk;
    const body = {
      summary: args.titulo,
      description: args.descricao || undefined,
      location: args.local || undefined,
      start: { dateTime: args.inicio_iso, timeZone: 'America/Sao_Paulo' },
      end: { dateTime: args.fim_iso, timeZone: 'America/Sao_Paulo' },
      attendees: Array.isArray(args.convidados_emails)
        ? (args.convidados_emails as string[]).map(email => ({ email }))
        : undefined,
    };
    const r = await fetch(`${GCAL_BASE}/calendars/primary/events?sendUpdates=all`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tk.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const txt = await r.text();
      return { ok: false, error: `Calendar create ${r.status}: ${txt.slice(0, 300)}` };
    }
    const j = await r.json();
    return {
      ok: true,
      google_event_id: j.id,
      titulo: j.summary,
      inicio: j.start?.dateTime,
      fim: j.end?.dateTime,
      link: j.htmlLink,
    };
  },
};

const atualizarEvento: ToolDefinition = {
  name: 'atualizar_evento',
  description: 'Atualiza evento existente no Google Calendar (mudar horário, título, local, descrição). AÇÃO QUE MODIFICA — confirme antes. Use o google_event_id retornado por listar_agenda ou criar_evento.',
  input_schema: {
    type: 'object',
    properties: {
      google_event_id: { type: 'string' },
      titulo: { type: 'string' },
      inicio_iso: { type: 'string' },
      fim_iso: { type: 'string' },
      descricao: { type: 'string' },
      local: { type: 'string' },
    },
    required: ['google_event_id'],
  },
  async handler(args, ctx) {
    const tk = await googleAccessToken(ctx);
    if (!tk.ok) return tk;
    const patch: Record<string, unknown> = {};
    if (args.titulo) patch.summary = args.titulo;
    if (args.descricao) patch.description = args.descricao;
    if (args.local) patch.location = args.local;
    if (args.inicio_iso) patch.start = { dateTime: args.inicio_iso, timeZone: 'America/Sao_Paulo' };
    if (args.fim_iso) patch.end = { dateTime: args.fim_iso, timeZone: 'America/Sao_Paulo' };

    const r = await fetch(`${GCAL_BASE}/calendars/primary/events/${args.google_event_id}?sendUpdates=all`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tk.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!r.ok) {
      const txt = await r.text();
      return { ok: false, error: `Calendar patch ${r.status}: ${txt.slice(0, 300)}` };
    }
    const j = await r.json();
    return { ok: true, titulo: j.summary, inicio: j.start?.dateTime };
  },
};

const cancelarEvento: ToolDefinition = {
  name: 'cancelar_evento',
  description: 'Cancela (deleta) evento do Google Calendar. AÇÃO DESTRUTIVA — confirme com nome do evento e horário antes ("vou cancelar X marcado pra Y, OK?"). Manda notificação aos convidados.',
  input_schema: {
    type: 'object',
    properties: {
      google_event_id: { type: 'string' },
    },
    required: ['google_event_id'],
  },
  async handler(args, ctx) {
    const tk = await googleAccessToken(ctx);
    if (!tk.ok) return tk;
    const r = await fetch(`${GCAL_BASE}/calendars/primary/events/${args.google_event_id}?sendUpdates=all`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tk.token}` },
    });
    if (!r.ok && r.status !== 410) {
      const txt = await r.text();
      return { ok: false, error: `Calendar delete ${r.status}: ${txt.slice(0, 300)}` };
    }
    return { ok: true, cancelado: args.google_event_id };
  },
};

// ============================================================================
// Gmail (Fase 4) — usa scope gmail.modify do mesmo OAuth do Calendar
// ============================================================================

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

const listarEmailsNaoLidos: ToolDefinition = {
  name: 'listar_emails_nao_lidos',
  description: 'Lista emails não lidos da caixa do Maikon (com remetente, assunto, snippet, data). Use quando ele perguntar "tem email novo?", "o que entrou na caixa?".',
  input_schema: {
    type: 'object',
    properties: {
      limite: { type: 'integer', default: 10, minimum: 1, maximum: 30 },
      label: { type: 'string', description: 'Label opcional pra filtrar (ex: INBOX, IMPORTANT)' },
    },
  },
  async handler(args, ctx) {
    const tk = await googleAccessToken(ctx);
    if (!tk.ok) return tk;
    const limite = (args.limite as number) || 10;
    const labelStr = args.label ? `&labelIds=${encodeURIComponent(args.label as string)}` : '&labelIds=INBOX';
    const r = await fetch(`${GMAIL_BASE}/messages?q=is:unread&maxResults=${limite}${labelStr}`, {
      headers: { Authorization: `Bearer ${tk.token}` },
    });
    if (!r.ok) return { ok: false, error: `Gmail list ${r.status}` };
    const j = await r.json();
    const ids = ((j.messages || []) as Array<{ id: string }>).map(m => m.id);
    if (ids.length === 0) return { ok: true, total: 0, emails: [] };

    // Busca metadata em paralelo (limitado a limite)
    const emails = await Promise.all(ids.map(async (id) => {
      const mr = await fetch(`${GMAIL_BASE}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, {
        headers: { Authorization: `Bearer ${tk.token}` },
      });
      if (!mr.ok) return null;
      const m = await mr.json();
      const headers = m.payload?.headers as Array<{ name: string; value: string }>;
      return {
        message_id: id,
        thread_id: m.threadId,
        de: gmailHeader(headers, 'From'),
        assunto: gmailHeader(headers, 'Subject'),
        data: gmailHeader(headers, 'Date'),
        snippet: m.snippet || '',
      };
    }));
    return { ok: true, total: emails.filter(Boolean).length, emails: emails.filter(Boolean) };
  },
};

const buscarEmail: ToolDefinition = {
  name: 'buscar_email',
  description: 'Busca emails na caixa do Maikon usando Gmail search syntax (mesmo da web). Ex: "from:hospital@example.com", "subject:cirurgia", "after:2026/04/01". Use quando ele pedir "acha email do Hospital Y" ou "emails sobre cirurgia este mês".',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Gmail search query (ex: "from:x@y.com", "subject:Z", "newer_than:7d")' },
      limite: { type: 'integer', default: 10, minimum: 1, maximum: 30 },
    },
    required: ['query'],
  },
  async handler(args, ctx) {
    const tk = await googleAccessToken(ctx);
    if (!tk.ok) return tk;
    const limite = (args.limite as number) || 10;
    const r = await fetch(`${GMAIL_BASE}/messages?q=${encodeURIComponent(args.query as string)}&maxResults=${limite}`, {
      headers: { Authorization: `Bearer ${tk.token}` },
    });
    if (!r.ok) return { ok: false, error: `Gmail search ${r.status}` };
    const j = await r.json();
    const ids = ((j.messages || []) as Array<{ id: string }>).map(m => m.id);
    const emails = await Promise.all(ids.map(async (id) => {
      const mr = await fetch(`${GMAIL_BASE}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, {
        headers: { Authorization: `Bearer ${tk.token}` },
      });
      if (!mr.ok) return null;
      const m = await mr.json();
      const headers = m.payload?.headers as Array<{ name: string; value: string }>;
      return {
        message_id: id,
        de: gmailHeader(headers, 'From'),
        assunto: gmailHeader(headers, 'Subject'),
        data: gmailHeader(headers, 'Date'),
        snippet: m.snippet || '',
      };
    }));
    return { ok: true, query: args.query, total: emails.filter(Boolean).length, emails: emails.filter(Boolean) };
  },
};

const resumirEmail: ToolDefinition = {
  name: 'resumir_email',
  description: 'Lê o corpo completo de UM email e resume com Haiku 4.5. Use quando Maikon pedir "resume esse email", ou após listar não lidos quando ele perguntar "o que diz o email do Y?".',
  input_schema: {
    type: 'object',
    properties: {
      message_id: { type: 'string', description: 'message_id do Gmail (de listar_emails_nao_lidos ou buscar_email)' },
    },
    required: ['message_id'],
  },
  async handler(args, ctx) {
    const tk = await googleAccessToken(ctx);
    if (!tk.ok) return tk;
    const r = await fetch(`${GMAIL_BASE}/messages/${args.message_id}?format=full`, {
      headers: { Authorization: `Bearer ${tk.token}` },
    });
    if (!r.ok) return { ok: false, error: `Gmail get ${r.status}` };
    const m = await r.json();
    const headers = m.payload?.headers as Array<{ name: string; value: string }>;
    const corpo = gmailExtractText(m.payload).slice(0, 12000);

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return { ok: false, error: 'ANTHROPIC_API_KEY ausente' };

    const prompt = `Resume esse email pro Dr. Maikon Madeira. PT-BR, direto.

DE: ${gmailHeader(headers, 'From')}
PRA: ${gmailHeader(headers, 'To')}
ASSUNTO: ${gmailHeader(headers, 'Subject')}
DATA: ${gmailHeader(headers, 'Date')}

CORPO:
${corpo || '[corpo vazio ou só HTML não decodificado]'}

ENTREGA:
- 1 frase: do que se trata
- 2-3 bullets: pontos principais
- 1 linha: requer resposta? Se sim, qual o assunto.
Total: máximo 70 palavras.`;

    const ar = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 350,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!ar.ok) return { ok: false, error: `Anthropic ${ar.status}` };
    const aj = await ar.json();
    return {
      ok: true,
      assunto: gmailHeader(headers, 'Subject'),
      de: gmailHeader(headers, 'From'),
      data: gmailHeader(headers, 'Date'),
      resumo: (aj.content?.[0]?.text || '').trim(),
    };
  },
};

const enviarEmail: ToolDefinition = {
  name: 'enviar_email',
  description: 'Envia um email pelo Gmail do Maikon. AÇÃO QUE MODIFICA E É VISÍVEL pra terceiros. SEMPRE confirme texto completo antes ("vou mandar pra X assunto Y, corpo: ZZ — confirma?"). Suporta múltiplos destinatários separados por vírgula.',
  input_schema: {
    type: 'object',
    properties: {
      para: { type: 'string', description: 'Email destinatário(s). Vírgula pra múltiplos.' },
      assunto: { type: 'string' },
      corpo: { type: 'string', description: 'Texto plano. Quebras de linha viram <br> automaticamente.' },
      cc: { type: 'string' },
      em_resposta_a_message_id: { type: 'string', description: 'Opcional: thread reply.' },
    },
    required: ['para', 'assunto', 'corpo'],
  },
  async handler(args, ctx) {
    const tk = await googleAccessToken(ctx);
    if (!tk.ok) return tk;

    let threadId: string | undefined;
    if (args.em_resposta_a_message_id) {
      const tr = await fetch(`${GMAIL_BASE}/messages/${args.em_resposta_a_message_id}?format=metadata`, {
        headers: { Authorization: `Bearer ${tk.token}` },
      });
      if (tr.ok) {
        const tj = await tr.json();
        threadId = tj.threadId;
      }
    }

    // RFC 822
    const rawLines = [
      `To: ${args.para}`,
      args.cc ? `Cc: ${args.cc}` : '',
      `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(args.assunto as string)))}?=`,
      'Content-Type: text/plain; charset=UTF-8',
      'MIME-Version: 1.0',
      '',
      args.corpo,
    ].filter(Boolean).join('\r\n');
    // base64url encode
    const raw = btoa(unescape(encodeURIComponent(rawLines)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const r = await fetch(`${GMAIL_BASE}/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tk.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }),
    });
    if (!r.ok) {
      const txt = await r.text();
      return { ok: false, error: `Gmail send ${r.status}: ${txt.slice(0, 300)}` };
    }
    const j = await r.json();
    return { ok: true, message_id: j.id, thread_id: j.threadId, para: args.para };
  },
};

const marcarEmailLido: ToolDefinition = {
  name: 'marcar_email_lido',
  description: 'Marca email como lido (remove label UNREAD). Use depois de resumir/responder, ou quando Maikon disser "marca como lido".',
  input_schema: {
    type: 'object',
    properties: {
      message_id: { type: 'string' },
    },
    required: ['message_id'],
  },
  async handler(args, ctx) {
    const tk = await googleAccessToken(ctx);
    if (!tk.ok) return tk;
    const r = await fetch(`${GMAIL_BASE}/messages/${args.message_id}/modify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tk.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
    });
    if (!r.ok) return { ok: false, error: `Gmail modify ${r.status}` };
    return { ok: true };
  },
};

// ============================================================================
// Briefings inteligentes (Fase 7) — agente monta status do dia/semana
// ============================================================================

const gerarBriefing: ToolDefinition = {
  name: 'gerar_briefing',
  description: 'Gera um briefing consolidado pro Maikon (manhã, fim de dia, ou semana). Roda múltiplas queries (agenda + tarefas atrasadas + conversas pendentes + emails não lidos + campanhas ativas) e devolve texto pronto pra ler em 30s. Use quando ele pedir "resume meu dia", "briefing da manhã", "como tá a semana?".',
  input_schema: {
    type: 'object',
    properties: {
      periodo: {
        type: 'string',
        enum: ['manha', 'fim_dia', 'semana'],
        default: 'manha',
        description: 'manha=hoje à frente / fim_dia=feito hoje + pendente / semana=visão 7 dias',
      },
      incluir_emails: { type: 'boolean', default: true },
    },
  },
  async handler(args, ctx) {
    const periodo = (args.periodo as string) || 'manha';
    const incluirEmails = args.incluir_emails !== false;

    // Coletar dados em paralelo
    const tarefasAtrasadasP = ctx.supa
      .from('task_flow_tasks')
      .select('titulo, prazo, task_flow_profiles!task_flow_tasks_responsavel_id_fkey(nome), task_flow_columns!task_flow_tasks_column_id_fkey(nome)')
      .lt('prazo', new Date().toISOString())
      .not('prazo', 'is', null)
      .is('deleted_at', null)
      .limit(20);

    const agora = new Date();
    const fimPeriodo = new Date(agora);
    if (periodo === 'manha' || periodo === 'fim_dia') fimPeriodo.setHours(23, 59, 59);
    else fimPeriodo.setDate(fimPeriodo.getDate() + 7);

    const inicioPeriodo = new Date(agora);
    if (periodo === 'manha') inicioPeriodo.setHours(0, 0, 0, 0);

    const eventosP = ctx.supa
      .from('eventos_agenda')
      .select('titulo, data_hora_inicio, tipo_evento')
      .gte('data_hora_inicio', inicioPeriodo.toISOString())
      .lt('data_hora_inicio', fimPeriodo.toISOString())
      .order('data_hora_inicio')
      .limit(15);

    const conversasPendentesP = ctx.supa.rpc('conversas_pendentes_atendimento', {
      p_min_minutos: 60,
      p_lookback_dias: 7,
    });

    const campanhasAtivasP = ctx.supa
      .from('campanhas_disparo')
      .select('nome, total_leads, enviados, sucesso, falhas')
      .eq('status', 'ativa')
      .eq('ativo', true)
      .limit(5);

    const [tarefasR, eventosR, convsR, campsR] = await Promise.all([
      tarefasAtrasadasP, eventosP, conversasPendentesP, campanhasAtivasP,
    ]);

    // Emails (opcional, requer Google)
    let emailsLinha = '';
    if (incluirEmails) {
      const tk = await googleAccessToken(ctx);
      if (tk.ok) {
        const r = await fetch(`${GMAIL_BASE}/messages?q=is:unread&labelIds=INBOX&maxResults=5`, {
          headers: { Authorization: `Bearer ${tk.token}` },
        });
        if (r.ok) {
          const j = await r.json();
          const total = j.resultSizeEstimate || (j.messages || []).length;
          emailsLinha = total > 0 ? `📨 ${total} email(s) não lido(s).` : '';
        }
      }
    }

    // Formata briefing
    const eventos = ((eventosR.data || []) as Array<{ titulo: string; data_hora_inicio: string; tipo_evento?: string }>);
    const tarefas = ((tarefasR.data || []) as Array<{
      titulo: string; prazo: string; task_flow_profiles?: { nome: string }; task_flow_columns?: { nome: string };
    }>).filter(t => {
      const col = (t.task_flow_columns?.nome || '').toLowerCase();
      return !col.includes('finaliz') && !col.includes('conclu');
    });
    const convs = (convsR.data || []) as Array<{ responsavel_nome: string | null; minutos_sem_resposta: number }>;
    const camps = (campsR.data || []) as Array<{ nome: string; total_leads: number; enviados: number; sucesso: number }>;

    const linhasAgenda = eventos.length === 0
      ? 'Nada na agenda.'
      : eventos.slice(0, 8).map(e => {
          const hora = new Date(e.data_hora_inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
          const dia = new Date(e.data_hora_inicio).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
          return `  ${periodo === 'semana' ? `${dia} ${hora}` : hora} — ${e.titulo}`;
        }).join('\n');

    const linhasTarefas = tarefas.length === 0
      ? 'Nenhuma tarefa atrasada.'
      : tarefas.slice(0, 8).map(t => {
          const dias = Math.floor((Date.now() - new Date(t.prazo).getTime()) / (24 * 3600 * 1000));
          return `  • ${t.titulo} (${t.task_flow_profiles?.nome || '?'}) — ${dias}d atrasada`;
        }).join('\n');

    const convPorResp: Record<string, number> = {};
    for (const c of convs) convPorResp[c.responsavel_nome || 'sem atribuição'] = (convPorResp[c.responsavel_nome || 'sem atribuição'] || 0) + 1;
    const linhaConvs = convs.length === 0
      ? 'Nenhuma conversa pendente >1h.'
      : Object.entries(convPorResp).map(([k, v]) => `  • ${k}: ${v}`).join('\n');

    const linhasCamps = camps.length === 0
      ? 'Nenhuma campanha ativa.'
      : camps.map(c => {
          const taxa = c.total_leads > 0 ? Math.round((c.enviados / c.total_leads) * 100) : 0;
          return `  • ${c.nome}: ${c.enviados}/${c.total_leads} (${taxa}%)`;
        }).join('\n');

    const tituloPeriodo = periodo === 'manha' ? '☀️ Bom dia, doutor — briefing'
      : periodo === 'fim_dia' ? '🌙 Briefing fim de dia'
      : '📊 Visão da semana';

    let texto = `${tituloPeriodo}\n\n📅 AGENDA${periodo === 'semana' ? ' (7 dias)' : ' hoje'}:\n${linhasAgenda}\n\n`;
    texto += `📋 TAREFAS ATRASADAS:\n${linhasTarefas}\n\n`;
    texto += `💬 ATENDIMENTOS PENDENTES (>1h sem resposta):\n${linhaConvs}\n\n`;
    texto += `📢 CAMPANHAS ATIVAS:\n${linhasCamps}`;
    if (emailsLinha) texto += `\n\n${emailsLinha}`;

    return {
      ok: true,
      periodo,
      texto,
      contadores: {
        eventos: eventos.length,
        tarefas_atrasadas: tarefas.length,
        conversas_pendentes: convs.length,
        campanhas_ativas: camps.length,
      },
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
// Crons gerenciáveis
// ============================================================================

const criarCron: ToolDefinition = {
  name: 'criar_cron',
  description: 'Cria um job recorrente. Confirma com o usuário antes de chamar! Tipos: "mensagem" (envia texto pro WhatsApp dele), "briefing" (roda prompt e manda resultado), "versiculo" (envia versículo bíblico + reflexão diária). Ex: "todo dia às 6h, manda versículo e reflexão" -> tipo=versiculo, cron=0 6 * * *',
  input_schema: {
    type: 'object',
    properties: {
      nome: { type: 'string', description: 'Nome curto identificador' },
      tipo: { type: 'string', enum: ['mensagem', 'briefing', 'versiculo'] },
      cron_expression: {
        type: 'string',
        description: 'Cron 5 campos no fuso BRT (min hora dia mês dia_semana). Ex: "0 6 * * *" = todo dia 6h',
      },
      payload: {
        type: 'object',
        description: 'Tipo=mensagem: {texto}. Tipo=briefing: {prompt}. Tipo=versiculo: {} (vazio).',
      },
    },
    required: ['nome', 'tipo', 'cron_expression'],
  },
  async handler(args, ctx) {
    const { data, error } = await ctx.supa
      .from('assistente_crons')
      .insert({
        user_id: ctx.userId,
        nome: args.nome,
        tipo: args.tipo,
        cron_expression: args.cron_expression,
        payload: args.payload || {},
        ativo: true,
      })
      .select('id, nome')
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, cron_id: (data as { id: string }).id, nome: (data as { nome: string }).nome };
  },
};

const listarCrons: ToolDefinition = {
  name: 'listar_crons',
  description: 'Lista crons ativos do usuário. Use quando ele perguntar sobre lembretes recorrentes, "o que tu manda pra mim automaticamente?".',
  input_schema: { type: 'object', properties: {} },
  async handler(_args, ctx) {
    const { data } = await ctx.supa
      .from('assistente_crons')
      .select('id, nome, tipo, cron_expression, ativo, ultima_execucao_em, total_execucoes')
      .eq('user_id', ctx.userId)
      .order('created_at', { ascending: false });
    return { total: (data || []).length, crons: data || [] };
  },
};

const pausarCron: ToolDefinition = {
  name: 'pausar_cron',
  description: 'Pausa ou reativa um cron. Use quando user quiser parar/retomar um lembrete recorrente.',
  input_schema: {
    type: 'object',
    properties: {
      cron_id: { type: 'string', description: 'UUID do cron' },
      ativo: { type: 'boolean', description: 'true=ativo, false=pausado' },
    },
    required: ['cron_id', 'ativo'],
  },
  async handler(args, ctx) {
    const { error } = await ctx.supa
      .from('assistente_crons')
      .update({ ativo: args.ativo, updated_at: new Date().toISOString() })
      .eq('id', args.cron_id)
      .eq('user_id', ctx.userId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
};

// ============================================================================
// Aprendizado por correção
// ============================================================================

const registrarCorrecao: ToolDefinition = {
  name: 'registrar_correcao',
  description: 'Registra uma correção do usuário sobre algo que você fez. Use SEMPRE que ele te corrigir ("não, em vez disso...", "da próxima vez...", "isso ficou ruim, faz assim..."). Não precisa confirmar — registra direto.',
  input_schema: {
    type: 'object',
    properties: {
      contexto: { type: 'string', description: 'O que você fez/respondeu que ficou errado' },
      correcao: { type: 'string', description: 'O que ele pediu pra fazer diferente' },
      categoria: {
        type: 'string',
        enum: ['tom', 'formato', 'conteudo', 'processo'],
      },
      aplicacao: {
        type: 'string',
        description: 'Quando aplicar essa correção (ex: "ao criar tarefa", "ao listar agenda")',
      },
    },
    required: ['contexto', 'correcao'],
  },
  async handler(args, ctx) {
    const { error } = await ctx.supa
      .from('assistente_correcoes')
      .insert({
        user_id: ctx.userId,
        contexto: args.contexto,
        correcao: args.correcao,
        categoria: args.categoria || 'processo',
        aplicacao: args.aplicacao || null,
      });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
};

// ============================================================================
// RAG - Aulas G4 (placeholder, fase 2)
// ============================================================================

const buscarAulasG4: ToolDefinition = {
  name: 'buscar_aulas_g4',
  description: 'Busca semântica nas transcrições das aulas G4 do Maikon. Use quando ele perguntar sobre conteúdo dos cursos: "como o G4 ensina X", "lembra daquela aula sobre Y", "o que aprendi sobre captação". Retorna trechos relevantes com nome da aula e timestamp.',
  input_schema: {
    type: 'object',
    properties: {
      pergunta: { type: 'string', description: 'A pergunta natural do user' },
      top_k: { type: 'integer', default: 5, minimum: 1, maximum: 10 },
    },
    required: ['pergunta'],
  },
  async handler(args, ctx) {
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) return { ok: false, error: 'OpenAI key não configurada' };

    // 1. Embedding da pergunta
    const embR = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: args.pergunta,
      }),
    });
    if (!embR.ok) {
      return { ok: false, error: `embedding ${embR.status}` };
    }
    const embJ = await embR.json();
    const queryEmb = embJ.data?.[0]?.embedding;
    if (!queryEmb) return { ok: false, error: 'embedding vazio' };

    // 2. Busca cosine similarity em pgvector (RPC filtra por user_id)
    const topK = (args.top_k as number) || 5;
    const { data, error } = await ctx.supa.rpc('buscar_aulas_g4_similar', {
      p_user_id: ctx.userId,
      p_query_emb: `[${queryEmb.join(',')}]`,
      p_top_k: topK,
    });

    if (error) {
      if (error.message.includes('does not exist') || error.message.includes('schema cache')) {
        return {
          ok: false,
          error: 'Nenhuma aula G4 indexada ainda. Pede pro Maikon mandar áudio das aulas pra indexar.',
          status: 'sem_indice',
        };
      }
      return { ok: false, error: error.message };
    }

    const trechos = (data || []) as Array<{
      aula_titulo: string;
      texto: string;
      timestamp_inicio_seg: number | null;
      similarity: number;
    }>;

    if (trechos.length === 0) {
      return {
        ok: true,
        pergunta: args.pergunta,
        trechos: [],
        nota: 'Nada relevante encontrado no que está indexado. Talvez essa aula ainda não foi processada.',
      };
    }

    return {
      ok: true,
      pergunta: args.pergunta,
      trechos: trechos.map(t => ({
        aula: t.aula_titulo,
        trecho: t.texto.slice(0, 800),
        em_minuto: t.timestamp_inicio_seg !== null ? Math.floor(t.timestamp_inicio_seg / 60) : null,
        relevancia: Math.round(t.similarity * 100) / 100,
      })),
    };
  },
};

// ============================================================================
// G4 - Indexação (áudio do turno atual ou pasta Drive)
// ============================================================================

const indexarAulaG4Atual: ToolDefinition = {
  name: 'indexar_aula_g4_atual',
  description: 'Indexa o áudio LONGO que o Maikon acabou de mandar nesse turno como uma aula G4. Use APENAS quando ele confirmar que o áudio recebido é uma aula. Roda em background (~1-3min) — você responde "tô indexando" e ele recebe confirmação separada quando terminar.',
  input_schema: {
    type: 'object',
    properties: {
      titulo: {
        type: 'string',
        description: 'Título descritivo da aula (ex: "G4 - Captação - Aula 5"). Se não souber, peça pro Maikon antes de chamar.',
      },
    },
    required: ['titulo'],
  },
  async handler(args, ctx) {
    if (!ctx.currentAudioBase64) {
      return {
        ok: false,
        error: 'Sem áudio capturado nesse turno. Maikon precisa mandar o áudio antes de pedir pra indexar.',
      };
    }
    const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/indexar-aula-g4`;
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    // Fire-and-forget: não esperar resposta (Whisper de aula longa demora)
    // A edge indexar-aula-g4 manda WhatsApp de confirmação ao concluir.
    fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: ctx.userId,
        fonte: 'audio_whatsapp',
        audio_base64: ctx.currentAudioBase64,
        mime: ctx.currentAudioMime || 'audio/ogg',
        wa_message_id: ctx.currentWaMessageId,
        titulo: args.titulo,
      }),
    }).catch(e => console.warn('[indexar_aula_g4_atual] dispatch falhou:', e));
    return {
      ok: true,
      status: 'indexando',
      titulo: args.titulo,
      duracao_min: Math.round((ctx.currentAudioDuracaoSeg || 0) / 60),
      nota: 'Vai demorar ~1-3min. Te aviso quando terminar.',
    };
  },
};

const indexarAulaDrive: ToolDefinition = {
  name: 'indexar_aula_drive',
  description: 'Indexa um vídeo/áudio de uma pasta do Google Drive do Maikon. Use quando ele citar "indexa do meu Drive a aula X" ou pedir pra processar arquivos de uma pasta. Requer file_id (peça pra ele compartilhar o link, você extrai o ID). Whisper limita 25MB — vídeos grandes precisam ser convertidos pra áudio antes.',
  input_schema: {
    type: 'object',
    properties: {
      drive_file_id: {
        type: 'string',
        description: 'ID do arquivo no Drive (extraído do link, ex: "1AbCdEfGhIj" da URL drive.google.com/file/d/1AbCdEfGhIj/view).',
      },
      titulo: {
        type: 'string',
        description: 'Título descritivo. Se não fornecido, usa o nome do arquivo no Drive.',
      },
    },
    required: ['drive_file_id'],
  },
  async handler(args, ctx) {
    const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/indexar-aula-g4`;
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: ctx.userId,
        fonte: 'drive_video',
        drive_file_id: args.drive_file_id,
        titulo: args.titulo,
      }),
    }).catch(e => console.warn('[indexar_aula_drive] dispatch falhou:', e));
    return {
      ok: true,
      status: 'indexando',
      drive_file_id: args.drive_file_id,
      nota: 'Tô baixando do Drive e processando. ~2-4min. Te aviso quando terminar.',
    };
  },
};

const listarAulasG4: ToolDefinition = {
  name: 'listar_aulas_g4',
  description: 'Lista as aulas G4 já indexadas do Maikon, com status e tamanho. Use quando ele perguntar "quais aulas tenho?", "o que está indexado?".',
  input_schema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['concluida', 'pendente', 'transcrevendo', 'indexando', 'erro', 'todas'],
        default: 'todas',
      },
    },
  },
  async handler(args, ctx) {
    const status = (args.status as string) === 'todas' ? null : (args.status as string) || null;
    const { data, error } = await ctx.supa.rpc('listar_aulas_g4_indexadas', {
      p_user_id: ctx.userId,
      p_status: status,
    });
    if (error) return { ok: false, error: error.message };
    const aulas = (data || []) as Array<{
      titulo: string; fonte: string; duracao_seg: number | null;
      total_chunks: number; status: string; indexada_em: string | null;
    }>;
    return {
      ok: true,
      total: aulas.length,
      aulas: aulas.map(a => ({
        titulo: a.titulo,
        fonte: a.fonte,
        minutos: a.duracao_seg ? Math.round(a.duracao_seg / 60) : null,
        chunks: a.total_chunks,
        status: a.status,
        indexada_em: a.indexada_em,
      })),
    };
  },
};

// ============================================================================
// Export
// ============================================================================

export const ALL_TOOLS: ToolDefinition[] = [
  // CRM - Contatos / Conversas (Fase 1)
  buscarContato,
  criarContato,
  atualizarContato,
  buscarConversa,
  resumirConversa,
  listarConversasPendentes,
  // Tarefas
  listarTarefas,
  criarTarefa,
  atualizarTarefa,
  concluirTarefa,
  comentarTarefa,
  // Agenda
  listarAgenda,
  criarEvento,
  atualizarEvento,
  cancelarEvento,
  // Gmail (Fase 4)
  listarEmailsNaoLidos,
  buscarEmail,
  resumirEmail,
  enviarEmail,
  marcarEmailLido,
  // Campanhas
  listarCampanhas,
  detalharCampanha,
  enviarMensagemAvulsa,
  criarCampanha,
  controlarCampanha,
  adicionarLeadsCampanha,
  // Briefings (Fase 7)
  gerarBriefing,
  // Memória / Crons
  salvarMemoria,
  buscarMemoria,
  criarCron,
  listarCrons,
  pausarCron,
  registrarCorrecao,
  // RAG G4
  buscarAulasG4,
  indexarAulaG4Atual,
  indexarAulaDrive,
  listarAulasG4,
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
