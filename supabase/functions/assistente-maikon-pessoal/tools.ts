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

// Janela "dia inteiro" em BRT pra filtrar timestamptz (UTC) no banco.
// Bug histórico: `new Date().setHours(0,0,0,0)` opera em TZ local — em Deno
// serverless local É UTC, então quando Maikon perguntava agenda às 23h BRT
// (= 02h UTC do dia seguinte), "amanhã" virava o dia subsequente em UTC e
// pegava o dia errado em BRT. Aqui ancoramos em BRT via Intl + offset -03:00.
function diaInteiroBRT(offsetDias: number): { inicio: string; fim: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value || '00';
  const meiaNoiteHojeBRT = new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00-03:00`);
  const inicio = new Date(meiaNoiteHojeBRT);
  inicio.setUTCDate(inicio.getUTCDate() + offsetDias);
  const fim = new Date(inicio);
  fim.setUTCDate(fim.getUTCDate() + 1);
  return { inicio: inicio.toISOString(), fim: fim.toISOString() };
}

// Cotas diárias por tool destrutiva. Conta usos com sucesso nas últimas 24h.
// Retorna {ok: true} se permite, {ok: false, error} se atingiu cota.
const DAILY_LIMITS: Record<string, number> = {
  enviar_email: 20,
  enviar_mensagem_avulsa: 10,
  criar_campanha: 3,
  cancelar_evento: 5,
  criar_evento: 10,
  adicionar_leads_campanha: 5,  // max 5 invocações; cada uma pode adicionar até 2k leads
  controlar_campanha: 10,
  indexar_aula_g4_atual: 8,
  indexar_aula_drive: 8,
  pesquisar_web: 50,  // Tavily free tier dá 1k/mês — 50/dia segura cota e custo
  extrair_url: 50,    // Tavily extract — mesma cota
};

async function checarCota(
  ctx: ToolContext,
  toolName: string,
): Promise<{ ok: true } | { ok: false; error: string; cota_atingida: true }> {
  const limite = DAILY_LIMITS[toolName];
  if (!limite) return { ok: true };
  const dia = new Date(); dia.setHours(0, 0, 0, 0);
  const { data, error } = await ctx.supa
    .from('assistente_audit_log')
    .select('tool_calls')
    .eq('user_id', ctx.userId)
    .gte('created_at', dia.toISOString());
  if (error) return { ok: true }; // se DB falhar, deixa passar (não bloqueia trabalho)
  let usos = 0;
  for (const r of (data || []) as Array<{ tool_calls: Array<{ name?: string; error?: boolean }> }>) {
    for (const tc of (r.tool_calls || [])) {
      if (tc.name === toolName && !tc.error) usos++;
    }
  }
  if (usos >= limite) {
    return {
      ok: false,
      error: `Cota diária atingida pra ${toolName}: ${usos}/${limite} hoje. Reseta à meia-noite.`,
      cota_atingida: true,
    };
  }
  return { ok: true };
}

// Pega access_token do Google p/ user atual. Refresh automático via OAuth.
// Retorna { ok: true, token } ou { ok: false, error }.
async function googleAccessToken(
  ctx: ToolContext,
  preferEmail?: string,
): Promise<{ ok: true; token: string; email: string } | { ok: false; error: string }> {
  const encKey = Deno.env.get('GOOGLE_TOKEN_ENCRYPTION_KEY');
  if (!encKey) return { ok: false, error: 'GOOGLE_TOKEN_ENCRYPTION_KEY ausente' };
  const { data: contas, error } = await ctx.supa.rpc('get_active_google_accounts_decrypted', {
    key: encKey,
  });
  if (error) return { ok: false, error: error.message };
  // Fallback: secretária (Isadora) pode conectar contas Google DO MAIKON em
  // nome dele estando logada com o profile dela. As contas ficam atribuídas
  // ao user_id da Isadora. Pra Madeira achar, comparamos por email canônico
  // do Maikon via env ASSISTENTE_DONO_EMAILS (CSV).
  const ownerEmails = (Deno.env.get('ASSISTENTE_DONO_EMAILS') || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  type ContaGoogle = { id: string; user_id: string; email: string; refresh_token: string; access_token: string; expires_at: string | null };
  const candidatos = ((contas || []) as ContaGoogle[]).filter(c =>
    c.user_id === ctx.userId ||
    (ownerEmails.length > 0 && ownerEmails.includes((c.email || '').toLowerCase()))
  );
  // Seleção:
  //  - Se preferEmail veio (tool quer conta específica), match exato pelo email canônico
  //  - Senão: prefere conta sob próprio user_id; fallback: proxy com email do dono
  let conta: ContaGoogle | undefined;
  if (preferEmail) {
    const target = preferEmail.trim().toLowerCase();
    conta = candidatos.find(c => (c.email || '').toLowerCase() === target);
    if (!conta) return { ok: false, error: `Conta ${preferEmail} não está ativa/autorizada` };
  } else {
    conta = candidatos.find(c => c.user_id === ctx.userId) || candidatos[0];
  }
  if (!conta) return { ok: false, error: 'Maikon não tem conta Google ativa — re-autoriza em /perfil' };

  const expiresAt = conta.expires_at ? new Date(conta.expires_at).getTime() : 0;
  if (conta.access_token && expiresAt - Date.now() > 5 * 60 * 1000) {
    return { ok: true, token: conta.access_token, email: conta.email };
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
  return { ok: true, token: j.access_token, email: conta.email };
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
      const hoje = diaInteiroBRT(0);
      query = query.gte('prazo', hoje.inicio).lt('prazo', hoje.fim);
    } else if (filtro === 'semana') {
      const seteFrente = diaInteiroBRT(7);
      query = query.lt('prazo', seteFrente.fim).gte('prazo', agora);
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
    let inicioIso: string;
    let fimIso: string;
    if (periodo === 'hoje') {
      ({ inicio: inicioIso, fim: fimIso } = diaInteiroBRT(0));
    } else if (periodo === 'amanha') {
      ({ inicio: inicioIso, fim: fimIso } = diaInteiroBRT(1));
    } else if (periodo === 'semana') {
      const hoje = diaInteiroBRT(0);
      const seteFrente = diaInteiroBRT(7);
      inicioIso = hoje.inicio;
      fimIso = seteFrente.fim;
    } else if (periodo === 'mes') {
      const hoje = diaInteiroBRT(0);
      const trintaFrente = diaInteiroBRT(30);
      inicioIso = hoje.inicio;
      fimIso = trintaFrente.fim;
    } else {
      ({ inicio: inicioIso, fim: fimIso } = diaInteiroBRT(0));
    }
    // Filtra eventos pelas CONTAS GOOGLE DO DONO (Maikon).
    // Antes: contas terceiras (ex: Isadora conectou conta dela com agenda
    // compartilhada do Maikon) injetavam 21 eventos confundindo o agente.
    // Pega google_account_id das contas com email canônico do dono.
    const ownerEmails = (Deno.env.get('ASSISTENTE_DONO_EMAILS') || '')
      .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    let ownerAccountIds: string[] = [];
    if (ownerEmails.length > 0) {
      const { data: contas } = await ctx.supa
        .from('google_accounts')
        .select('id, email')
        .eq('ativo', true);
      ownerAccountIds = ((contas || []) as Array<{ id: string; email: string }>)
        .filter(c => ownerEmails.includes((c.email || '').toLowerCase()))
        .map(c => c.id);
    }

    let query = ctx.supa
      .from('eventos_agenda')
      .select('id, titulo, data_hora_inicio, data_hora_fim, tipo_evento, google_event_id, origem, google_account_id, timezone')
      .eq('medico_id', ctx.userId)
      .gte('data_hora_inicio', inicioIso)
      .lt('data_hora_inicio', fimIso)
      .order('data_hora_inicio')
      .limit(200);
    // Filtro por contas do dono OU eventos sem google_account_id (criados manualmente)
    if (ownerAccountIds.length > 0) {
      query = query.or(`google_account_id.in.(${ownerAccountIds.join(',')}),google_account_id.is.null`);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    type Row = { id: string; titulo: string; data_hora_inicio: string; data_hora_fim: string | null; tipo_evento?: string; google_event_id: string | null; origem?: string; timezone?: string | null };

    // Dedup em 2 níveis:
    // 1) Mesmo (titulo+inicio): duplicata exata
    // 2) Mesmo data_hora_inicio E hora_fim com títulos parecidos: mesmo evento
    //    sincronizado de contas diferentes (ex: "Flight to SP" vs "Voo SP")
    const seenExact = new Set<string>();
    const byStart = new Map<string, Row>();
    const eventos: Array<Record<string, unknown>> = [];

    for (const e of (data || []) as Row[]) {
      const exactKey = `${e.titulo}|${e.data_hora_inicio}`;
      if (seenExact.has(exactKey)) continue;
      seenExact.add(exactKey);

      // Dedup por horário próximo (mesmo inicio + fim = mesmo bloco)
      const blockKey = `${e.data_hora_inicio}|${e.data_hora_fim || ''}`;
      const existing = byStart.get(blockKey);
      if (existing) {
        // Mantém o título mais descritivo (mais longo, sem ?? ou abreviação)
        if (e.titulo.length > existing.titulo.length && !e.titulo.includes('??')) {
          byStart.set(blockKey, e);
        }
        continue;
      }
      byStart.set(blockKey, e);
    }

    // Pré-formata data/hora em BRT pra Sonnet — antes ele errava cálculo de
    // dia da semana mesmo com data atual no contexto. Banco salva timestamptz
    // em UTC (correto), aqui converte pra BRT pra display.
    const fmtDia = (iso: string) => {
      return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit' });
    };
    const fmtHora = (iso: string) => {
      return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    };

    for (const e of byStart.values()) {
      eventos.push({
        evento_id: e.id,
        google_event_id: e.google_event_id,
        titulo: e.titulo,
        quando: e.data_hora_inicio,
        ate: e.data_hora_fim,
        dia_semana_brt: fmtDia(e.data_hora_inicio),
        hora_inicio_brt: fmtHora(e.data_hora_inicio),
        hora_fim_brt: e.data_hora_fim ? fmtHora(e.data_hora_fim) : null,
        tipo: e.tipo_evento || 'evento',
        origem: e.origem || 'crm',
      });
    }
    eventos.sort((a, b) => String(a.quando).localeCompare(String(b.quando)));
    return { periodo, total: eventos.length, eventos };
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
    const cota = await checarCota(ctx, 'enviar_mensagem_avulsa');
    if (!cota.ok) return cota;
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
    const cota = await checarCota(ctx, 'criar_campanha');
    if (!cota.ok) return cota;
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
    const cota = await checarCota(ctx, 'controlar_campanha');
    if (!cota.ok) return cota;

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
    const cota = await checarCota(ctx, 'adicionar_leads_campanha');
    if (!cota.ok) return cota;
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
    const cota = await checarCota(ctx, 'criar_evento');
    if (!cota.ok) return cota;
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
    const cota = await checarCota(ctx, 'cancelar_evento');
    if (!cota.ok) return cota;
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
  description: 'Lista emails não lidos da caixa do Maikon (com remetente, assunto, snippet, data). Use quando ele perguntar "tem email novo?", "o que entrou na caixa?". Aceita conta_email opcional pra escolher uma das contas linkadas (maikonmadeira@gmail.com ou maikon.madeira@gestaoservicosaude.com.br). Pra filtrar promo/social/newsletter, NÃO use label — use q_extra com sintaxe Gmail (ex: "-category:promotions -category:social -category:forums"). label é só pra LabelID puro (INBOX/IMPORTANT).',
  input_schema: {
    type: 'object',
    properties: {
      limite: { type: 'integer', default: 10, minimum: 1, maximum: 30 },
      label: { type: 'string', description: 'LabelID puro (INBOX/IMPORTANT). Default INBOX. NÃO aceita query syntax.' },
      conta_email: { type: 'string', description: 'Email da conta Google específica a consultar (opcional)' },
      so_24h: { type: 'boolean', description: 'Se true, filtra só não lidos das últimas 24h' },
      q_extra: { type: 'string', description: 'Termos extra de busca Gmail (ex: "-category:promotions -category:social"). Concatenado ao query is:unread.' },
    },
  },
  async handler(args, ctx) {
    const tk = await googleAccessToken(ctx, args.conta_email as string | undefined);
    if (!tk.ok) return tk;
    const limite = (args.limite as number) || 10;
    const labelStr = args.label ? `&labelIds=${encodeURIComponent(args.label as string)}` : '&labelIds=INBOX';
    const queryParts = ['is:unread'];
    if (args.so_24h) queryParts.push('newer_than:1d');
    if (args.q_extra) queryParts.push(String(args.q_extra));
    const q = encodeURIComponent(queryParts.join(' '));
    const r = await fetch(`${GMAIL_BASE}/messages?q=${q}&maxResults=${limite}${labelStr}`, {
      headers: { Authorization: `Bearer ${tk.token}` },
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return { ok: false, error: `Gmail list ${r.status}: ${body.slice(0, 300)}` };
    }
    const j = await r.json();
    const ids = ((j.messages || []) as Array<{ id: string }>).map(m => m.id);
    if (ids.length === 0) return { ok: true, conta: tk.email, total: 0, emails: [] };

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
    return { ok: true, conta: tk.email, total: emails.filter(Boolean).length, emails: emails.filter(Boolean) };
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
    const cota = await checarCota(ctx, 'enviar_email');
    if (!cota.ok) return cota;
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
// Web Search (Tavily) — Fase 8
// ============================================================================

const pesquisarWeb: ToolDefinition = {
  name: 'pesquisar_web',
  description: 'Pesquisa na internet via Tavily (otimizado pra agentes IA). Use quando Maikon perguntar algo que requer info atual e que não está no CRM nem nas memórias: preço de produto, notícia recente, info sobre pessoa/empresa, processo jurídico, dúvida médica genérica. Retorna resposta sintetizada + 5 fontes. NÃO use pra perguntas sobre o CRM próprio (use as tools do CRM).',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Pergunta natural ou termos de busca em PT-BR ou EN.' },
      profundidade: {
        type: 'string',
        enum: ['rapida', 'completa'],
        default: 'rapida',
        description: 'rapida = básica/rápida (default), completa = mais profunda (custa mais créditos Tavily)',
      },
      incluir_dominios: {
        type: 'array',
        items: { type: 'string' },
        description: 'Restringir a domínios específicos (ex: ["scielo.org", "tjsc.jus.br"])',
      },
      excluir_dominios: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filtrar fora domínios (ex: ["pinterest.com"])',
      },
    },
    required: ['query'],
  },
  async handler(args, ctx) {
    const cota = await checarCota(ctx, 'pesquisar_web');
    if (!cota.ok) return cota;
    const apiKey = Deno.env.get('TAVILY_API_KEY');
    if (!apiKey) return { ok: false, error: 'TAVILY_API_KEY não configurada' };

    const body: Record<string, unknown> = {
      api_key: apiKey,
      query: args.query,
      search_depth: args.profundidade === 'completa' ? 'advanced' : 'basic',
      include_answer: true,
      max_results: 5,
    };
    if (Array.isArray(args.incluir_dominios) && (args.incluir_dominios as string[]).length > 0) {
      body.include_domains = args.incluir_dominios;
    }
    if (Array.isArray(args.excluir_dominios) && (args.excluir_dominios as string[]).length > 0) {
      body.exclude_domains = args.excluir_dominios;
    }

    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const txt = await r.text();
      return { ok: false, error: `Tavily ${r.status}: ${txt.slice(0, 200)}` };
    }
    const j = await r.json() as {
      answer?: string;
      results?: Array<{ title: string; url: string; content: string; score: number }>;
    };

    return {
      ok: true,
      query: args.query,
      resposta_sintetizada: j.answer || null,
      fontes: (j.results || []).map(rs => ({
        titulo: rs.title,
        url: rs.url,
        trecho: (rs.content || '').slice(0, 500),
        relevancia: Math.round(rs.score * 100) / 100,
      })),
    };
  },
};

const extrairUrl: ToolDefinition = {
  name: 'extrair_url',
  description: 'Faz fetch de uma URL específica e devolve o conteúdo textual limpo da página (HTML strippado, ads removidos). Use quando Maikon mandar um LINK pedindo pra você ler/lembrar algo daquela página sem dizer explicitamente a data — você abre o link, extrai data/hora/local do evento (ou tema do vídeo/artigo), e propõe lembrete pra ele confirmar. Diferente de pesquisar_web (que é busca por keywords); aqui você JÁ tem a URL exata. Bom pra: páginas de evento (conferences, simpósios), artigos, posts. Limitado pra: YouTube live e SPAs muito dinâmicas — se vier vazio, pergunta a data direto pro Maikon.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL completa começando com http(s)://' },
    },
    required: ['url'],
  },
  async handler(args, ctx) {
    const cota = await checarCota(ctx, 'extrair_url');
    if (!cota.ok) return cota;
    const apiKey = Deno.env.get('TAVILY_API_KEY');
    if (!apiKey) return { ok: false, error: 'TAVILY_API_KEY não configurada' };
    const url = String(args.url || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'URL inválida (precisa começar com http:// ou https://)' };
    }
    const r = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, urls: [url], extract_depth: 'basic' }),
    });
    if (!r.ok) {
      const txt = await r.text();
      return { ok: false, error: `Tavily extract ${r.status}: ${txt.slice(0, 200)}` };
    }
    const j = await r.json() as {
      results?: Array<{ url: string; raw_content?: string }>;
      failed_results?: Array<{ url: string; error?: string }>;
    };
    const res = j.results?.[0];
    if (!res || !res.raw_content) {
      const fail = j.failed_results?.[0];
      return {
        ok: false,
        error: fail?.error || 'extração retornou vazio (pode ser SPA dinâmica como YouTube live — peça a data direto pro Maikon)',
        url,
      };
    }
    // 8KB de conteúdo é suficiente pra pegar data/hora/título em página típica
    // de evento. Mais que isso explode tokens à toa.
    return {
      ok: true,
      url: res.url,
      conteudo: res.raw_content.slice(0, 8000),
      truncado: res.raw_content.length > 8000,
    };
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

    const hojeBRT = diaInteiroBRT(0);
    let inicioPeriodoIso: string;
    let fimPeriodoIso: string;
    if (periodo === 'manha') {
      inicioPeriodoIso = hojeBRT.inicio;
      fimPeriodoIso = hojeBRT.fim;
    } else if (periodo === 'fim_dia') {
      inicioPeriodoIso = new Date().toISOString();
      fimPeriodoIso = hojeBRT.fim;
    } else {
      inicioPeriodoIso = new Date().toISOString();
      fimPeriodoIso = diaInteiroBRT(7).fim;
    }

    const eventosP = ctx.supa
      .from('eventos_agenda')
      .select('titulo, data_hora_inicio, tipo_evento')
      .gte('data_hora_inicio', inicioPeriodoIso)
      .lt('data_hora_inicio', fimPeriodoIso)
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
  description: 'Cria um lembrete agendado pro próprio Maikon (chega no chip Madeira). SEMPRE confirme HORÁRIO + RECORRÊNCIA antes de chamar. Pra mensagem ENVIADA PRA OUTRA PESSOA pelo chip do Maikon, NÃO use esta — use enviar_mensagem_pelo_chip. Tipos: "mensagem" (texto pro Maikon via chip Madeira), "briefing" (roda prompt e manda resultado), "versiculo" (versículo + reflexão diária).',
  input_schema: {
    type: 'object',
    properties: {
      nome: { type: 'string', description: 'Nome curto identificador' },
      tipo: { type: 'string', enum: ['mensagem', 'briefing', 'versiculo'] },
      cron_expression: {
        type: 'string',
        description: 'Cron 5 campos no fuso BRT (min hora dia mês dia_semana). Ex: "0 6 * * *" = todo dia 6h. Pra one-shot ("hoje 18h30"), use o horário no padrão diário e marque apenas_uma_vez=true.',
      },
      apenas_uma_vez: {
        type: 'boolean',
        description: 'true = lembrete pontual, desativa após 1ª execução. false = recorrente.',
        default: false,
      },
      data_fim: {
        type: 'string',
        description: 'ISO 8601 (ex: "2026-06-30T23:59:00-03:00"). Se setado, worker desativa cron após esta data. Use quando recorrência tem prazo definido ("até dia X", "por 4 semanas").',
      },
      payload: {
        type: 'object',
        description: 'Tipo=mensagem: {texto}. Tipo=briefing: {prompt}. Tipo=versiculo: {} (vazio).',
      },
    },
    required: ['nome', 'tipo', 'cron_expression', 'apenas_uma_vez'],
  },
  async handler(args, ctx) {
    // GUARD anti-spam-eterno: cron recorrente SEM data_fim vira lembrete
    // perpétuo. Caso 24/05 17:36: criou "perguntar toda quarta 9h pra Maria
    // Fernanda" sem ate_data → Maikon receberia toda quarta pra sempre.
    // Regra do prompt diz pra perguntar prazo, mas Madeira pula.
    // Aqui forçamos: recorrente sem data_fim → rejeita com mensagem clara.
    const ehRecorrente = args.apenas_uma_vez !== true;
    const semDataFim = !args.data_fim || (args.data_fim as string).trim() === '';
    if (ehRecorrente && semDataFim) {
      return {
        ok: false,
        error: 'CRON_RECORRENTE_SEM_PRAZO: lembretes recorrentes EXIGEM data_fim pra não virar spam eterno. PERGUNTE ao Maikon "por quanto tempo? até alguma data, mês, ou sempre por X meses?" e chame de novo com data_fim no formato ISO 8601 (ex: 2026-12-31T23:59:00-03:00).',
      };
    }
    const insertPayload = {
      user_id: ctx.userId,
      nome: args.nome,
      tipo: args.tipo,
      cron_expression: args.cron_expression,
      payload: args.payload || {},
      apenas_uma_vez: args.apenas_uma_vez === true,
      data_fim: (args.data_fim as string) || null,
      ativo: true,
    };
    const { data, error } = await ctx.supa
      .from('assistente_crons')
      .insert(insertPayload)
      .select('id, nome')
      .single();
    if (!error) {
      return { ok: true, cron_id: (data as { id: string }).id, nome: (data as { nome: string }).nome };
    }
    // Caso 16-17/05: DB ficou UNHEALTHY ~24h. criar_cron falhou 3 vezes pro
    // Maikon e ele desistiu. Fallback: salva o pedido como memoria pendente
    // pra Madeira poder oferecer recriar quando o DB voltar. Maikon recebe
    // mensagem clara em vez de "Não consegui criar" repetitivo.
    const erroDB = /timeout|statement|connection|terminated|ECONN|database|UNHEALTHY/i.test(error.message);
    if (erroDB) {
      try {
        await ctx.supa.from('assistente_memoria').insert({
          user_id: ctx.userId,
          chave: `cron_pendente_${Date.now()}`,
          valor: JSON.stringify(insertPayload),
          categoria: 'pendencia_tecnica',
          importancia: 4,
        });
      } catch { /* se memoria tb falhou, segue */ }
      return {
        ok: false,
        fallback: 'memoria_salva',
        error: `Banco oscilando agora (${error.message.slice(0,80)}). Salvei o pedido na memória — DIGA AO MAIKON: "Banco do CRM tá oscilando agora. Anotei o lembrete pra recriar assim que estabilizar." e siga pra outra coisa. NÃO repita "Não consegui criar" — informe e segue.`,
      };
    }
    return { ok: false, error: error.message };
  },
};

// ============================================================================
// Envio de mensagem pelo chip do Maikon (Maikon GSS)
// — agora ou agendado, com prazo opcional pra recorrência.
// ============================================================================

const enviarMensagemPeloChip: ToolDefinition = {
  name: 'enviar_mensagem_pelo_chip',
  description: 'Envia mensagem PELO CHIP DO MAIKON (Maikon GSS) pra outra pessoa OU GRUPO. Pode ser AGORA (sem agendar_*) ou agendado (com agendar_para ou cron_expression). REGRAS OBRIGATÓRIAS: 1) Confirme PRA QUEM (nome+número/grupo), QUANDO e TEXTO antes de chamar. 2) Se for GRUPO, use buscar_grupo primeiro pra pegar o JID e passe ele em "numero" (formato 120363xxx@g.us). 3) Se for cron RECORRENTE ("toda segunda 7h"), PERGUNTE até quando vai durar. 4) Whitelist de instâncias: hoje só "Maikon GSS". 5) NÃO envie pro próprio número do Maikon.',
  input_schema: {
    type: 'object',
    properties: {
      instancia: {
        type: 'string',
        enum: ['Maikon GSS'],
        description: 'Chip que envia. Hoje só Maikon GSS liberado.',
      },
      numero: {
        type: 'string',
        description: 'Destinatário: número individual no formato 5547999999999 (55+DDD+número, sem espaços) OU JID de grupo no formato 120363xxx@g.us. Pra mandar em GRUPO, primeiro use buscar_grupo pra resolver nome → JID, depois passe o JID inteiro aqui.',
      },
      texto: { type: 'string', description: 'Texto da mensagem.' },
      cron_expression: {
        type: 'string',
        description: 'Pra agendar recorrente. Cron BRT 5 campos. Ex: "0 7 * * 1" = toda segunda 7h. Omitir = envio imediato OU one-shot via agendar_para.',
      },
      agendar_para: {
        type: 'string',
        description: 'ISO 8601 BRT pra envio one-shot único. Ex: "2026-05-12T07:00:00-03:00". Cria cron one-shot que dispara nessa hora e desativa.',
      },
      ate_data: {
        type: 'string',
        description: 'ISO 8601. Se cron_expression for recorrente, OBRIGATÓRIO ter prazo. Ex: "2026-12-31T23:59:00-03:00" pra fim do ano.',
      },
    },
    required: ['instancia', 'numero', 'texto'],
  },
  async handler(args, ctx) {
    const liberadas = (Deno.env.get('ASSISTENTE_INSTANCIAS_LIBERADAS_ENVIO') || 'Maikon GSS')
      .split(',').map(s => s.trim());
    const instancia = args.instancia as string;
    if (!liberadas.includes(instancia)) {
      return { ok: false, error: `Instância "${instancia}" não está na whitelist. Liberadas: ${liberadas.join(', ')}` };
    }
    const numeroRaw = (args.numero as string).trim();
    let numero: string;
    let isGroupSend = false;
    // Detecta JID de grupo (@g.us). Evolution aceita 'number' = JID de grupo
    // pra postar no grupo. Mantém o JID inteiro pra passar na API.
    if (/@g\.us$/.test(numeroRaw)) {
      numero = numeroRaw;
      isGroupSend = true;
    } else {
      numero = numeroRaw.replace(/\D/g, '');
      if (!numero) return { ok: false, error: 'numero inválido' };
      // Guarda contra bug do Sonnet truncar/adicionar dígito no número.
      // Brasil: 12 dígitos (55+DDD2+8) sem 9 OU 13 dígitos (55+DDD2+9+8) com 9 mobile.
      // Sem 55 inicial: 10 ou 11 dígitos. Tolera 10-13 mas avisa se fora.
      if (numero.length < 10 || numero.length > 13) {
        return {
          ok: false,
          error: `Número "${numero}" tem ${numero.length} dígitos — esperado 10-13 (Brasil). Confirme com o Maikon o número EXATO antes de chamar de novo. Pra GRUPO use o jid completo no formato 120363xxx@g.us (busque com buscar_grupo).`,
        };
      }
      const userPhone = ctx.userPhone?.replace(/\D/g, '') || '';
      if (numero === userPhone) {
        return { ok: false, error: 'Não envia pro próprio Maikon — use criar_cron pra lembrete pessoal.' };
      }
    }
    const texto = args.texto as string;
    const cronExpr = args.cron_expression as string | undefined;
    const agendarPara = args.agendar_para as string | undefined;
    const ateData = args.ate_data as string | undefined;

    // Caso 1: envio imediato (sem agendar_para nem cron)
    if (!cronExpr && !agendarPara) {
      const { data: cfg } = await ctx.supa
        .from('config_global')
        .select('evolution_base_url, evolution_api_key')
        .single();
      const evoUrl = (cfg as { evolution_base_url?: string } | null)?.evolution_base_url;
      const evoKey = (cfg as { evolution_api_key?: string } | null)?.evolution_api_key;
      if (!evoUrl || !evoKey) return { ok: false, error: 'config Evolution incompleta' };
      let r: Response;
      try {
        r = await fetch(`${evoUrl}/message/sendText/${encodeURIComponent(instancia)}`, {
          method: 'POST',
          headers: { apikey: evoKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ number: numero, text: texto }),
        });
      } catch (e) {
        // Falha de rede/DNS = Evolution inacessível (host fora do ar).
        return {
          ok: false,
          chip_indisponivel: true,
          error: `Não consegui falar com o servidor de WhatsApp (Evolution inacessível): ${String((e as Error).message).slice(0, 120)}. Avise o Maikon que o envio falhou e que isso é problema de infraestrutura — não adianta tentar de novo agora.`,
        };
      }
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        // Evolution 500 "Connection Closed" = a instância EXISTE mas o socket
        // dela com o WhatsApp caiu (chip deslogado). Devolve erro ACIONÁVEL —
        // antes o modelo traduzia o "Evolution 500" cru como "problema interno"
        // genérico, sem dizer ao Maikon o que fazer. (caso 31/05 e 01/06)
        const desconectado = r.status >= 500
          || /connection closed|not connected|disconnected|state.*clos|"close"/i.test(body);
        if (desconectado) {
          return {
            ok: false,
            chip_desconectado: true,
            error: `O chip "${instancia}" está desconectado do WhatsApp (Evolution ${r.status}: Connection Closed). Diga ao Maikon, com essas palavras, que NÃO deu pra enviar porque o chip "${instancia}" caiu, e que ele precisa reconectar o QR Code em Config Zaps (/zaps). Não tente outro caminho — sem reconectar, nenhum envio por esse chip funciona.`,
          };
        }
        return { ok: false, error: `Evolution ${r.status}: ${body.slice(0, 200)}` };
      }
      return { ok: true, modo: 'imediato', destino: numero, instancia };
    }

    // Caso 2: agendamento (cria cron tipo mensagem_chip)
    let cronExpression: string;
    let apenasUmaVez = false;
    let dataFim: string | null = null;

    if (agendarPara) {
      // One-shot pra data específica. Convertemos ISO em cron min+hora+dia+mes.
      const dt = new Date(agendarPara);
      if (isNaN(dt.getTime())) return { ok: false, error: 'agendar_para inválido (use ISO 8601)' };
      // Cron no fuso BRT: extrai min/hora/dia/mes na timezone local
      const fmt = (val: number) => val;
      const minBRT = parseInt(dt.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', minute: '2-digit' }), 10);
      const horaBRT = parseInt(dt.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }), 10);
      const diaBRT = parseInt(dt.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', day: '2-digit' }), 10);
      const mesBRT = parseInt(dt.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', month: '2-digit' }), 10);
      cronExpression = `${fmt(minBRT)} ${fmt(horaBRT)} ${fmt(diaBRT)} ${fmt(mesBRT)} *`;
      apenasUmaVez = true;
      dataFim = null;
    } else {
      // Recorrente — exige ate_data
      if (!ateData) {
        return {
          ok: false,
          error: 'Cron recorrente exige ate_data (até quando vai rodar). Pergunta ao Maikon o prazo.',
        };
      }
      cronExpression = cronExpr!;
      apenasUmaVez = false;
      dataFim = ateData;
    }

    const { data, error } = await ctx.supa
      .from('assistente_crons')
      .insert({
        user_id: ctx.userId,
        nome: `Envio "${texto.slice(0, 40)}" para ${numero}`,
        tipo: 'mensagem_chip',
        cron_expression: cronExpression,
        payload: { instancia, numero, texto },
        apenas_uma_vez: apenasUmaVez,
        data_fim: dataFim,
        ativo: true,
      })
      .select('id, nome')
      .single();
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      modo: apenasUmaVez ? 'agendado_one_shot' : 'agendado_recorrente',
      cron_id: (data as { id: string }).id,
      cron_expression: cronExpression,
      data_fim: dataFim,
      destino: numero,
      instancia,
    };
  },
};

const listarCrons: ToolDefinition = {
  name: 'listar_crons',
  description: 'Lista lembretes/avisos agendados do Maikon (crons). Use quando ele perguntar "quais avisos tu manda pra mim?", "lista meus lembretes", "o que tem agendado", OU como passo intermediário antes de cancelar/reagendar um lembrete que ele citou via reply. Por padrão retorna só ATIVOS. Cada item tem: id (pra cancelar), texto_preview (texto que chega pra ele — usar pra match), proxima_humano (descrição PT-BR de quando dispara), recorrente (true/false). Use texto_preview pra parear com a mensagem citada por ele em replies.',
  input_schema: {
    type: 'object',
    properties: {
      incluir_inativos: {
        type: 'boolean',
        description: 'true = inclui crons pausados/cancelados/expirados. Default false (só ativos).',
        default: false,
      },
      termo: {
        type: 'string',
        description: 'Filtra crons cujo texto/nome contém este termo (ilike). Útil quando Maikon pede "cancela todos sobre X" ou cita um trecho de um lembrete.',
      },
    },
  },
  async handler(args, ctx) {
    let query = ctx.supa
      .from('assistente_crons')
      .select('id, nome, tipo, cron_expression, ativo, apenas_uma_vez, data_fim, payload, ultima_execucao_em, total_execucoes, created_at')
      .eq('user_id', ctx.userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (!args.incluir_inativos) query = query.eq('ativo', true);
    const { data } = await query;
    const todos = (data || []) as Array<Record<string, unknown>>;
    const termo = (args.termo as string | undefined)?.toLowerCase();

    // Parse cron expression em descrição BRT pro Maikon. Suporta formatos
    // comuns: "M H * * *" (todo dia), "M H * * D" (dia da semana), "M H D M *"
    // (data específica = one-shot). Não tenta cobrir cron rico — só o que
    // criar_cron emite.
    const diasSem = ['dom','seg','ter','qua','qui','sex','sab'];
    const proxHumano = (expr: string, oneShot: boolean): string => {
      const parts = expr.trim().split(/\s+/);
      if (parts.length !== 5) return expr;
      const [m, h, d, mes, dw] = parts;
      const hm = `${h.padStart(2,'0')}:${m.padStart(2,'0')}`;
      if (oneShot && d !== '*' && mes !== '*') {
        return `${d.padStart(2,'0')}/${mes.padStart(2,'0')} às ${hm}`;
      }
      if (dw !== '*' && d === '*') {
        const dias = dw.split(',').map(n => diasSem[parseInt(n,10)] || n).join('/');
        return `toda ${dias} ${hm}`;
      }
      if (d === '*' && mes === '*' && dw === '*') return `todo dia ${hm}`;
      return `${hm} (${expr})`;
    };

    const enriched = todos.map(c => {
      const payload = (c.payload || {}) as Record<string, unknown>;
      const textoPreview = (payload.texto as string | undefined)
        || (payload.prompt as string | undefined)
        || (c.tipo === 'versiculo' ? 'Versículo + reflexão diária' : (c.nome as string));
      return {
        id: c.id,
        texto_preview: textoPreview ? String(textoPreview).slice(0, 200) : '',
        tipo: c.tipo,
        recorrente: !c.apenas_uma_vez,
        proxima_humano: proxHumano(c.cron_expression as string, c.apenas_uma_vez === true),
        cron_expression: c.cron_expression,
        ativo: c.ativo,
        data_fim: c.data_fim,
        total_execucoes: c.total_execucoes,
        ultima_execucao_em: c.ultima_execucao_em,
      };
    });

    // Normaliza acentos pra match robusto — Maikon ditando áudio Whisper
    // pode transcrever sem acento (Versiculo vs Versículo), e o reply do
    // WhatsApp Web normaliza algumas vezes também.
    const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const filtrados = termo
      ? enriched.filter(c => semAcento(c.texto_preview).includes(semAcento(termo)))
      : enriched;

    return { total: filtrados.length, crons: filtrados };
  },
};

const pausarCron: ToolDefinition = {
  name: 'pausar_cron',
  description: 'Pausa ou reativa UM cron recorrente (semântica de "pausa temporária, vou voltar a usar"). Pra CANCELAR de vez use cancelar_cron. Pra one-shot, prefira sempre cancelar_cron.',
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

const cancelarCron: ToolDefinition = {
  name: 'cancelar_cron',
  description: 'Cancela DEFINITIVAMENTE um ou mais lembretes/avisos agendados do Maikon. Use quando ele pedir "cancela esse aviso", "para de me mandar isso", "pode tirar esse lembrete" — inclusive em reply citando o texto do lembrete. SEMPRE confirme antes de chamar: liste o(s) texto(s) do(s) lembrete(s) que vão sumir ("Vou cancelar: 1) X, 2) Y, OK?"). Aceita múltiplos IDs (ele pode pedir cancelar vários de uma vez). Pra REAGENDAR (cancelar + criar novo com prazo diferente), cancele aqui e depois chame criar_cron com o novo horário. FALLBACK: se passar termo (texto do lembrete) sem cron_ids — ou se cron_ids falhar — a tool busca os crons ativos cujo texto/nome contém o termo e cancela. Pra reply ("retirar" citando "Lembrar do Arthur"), pode passar só termo="Arthur" que resolve.',
  input_schema: {
    type: 'object',
    properties: {
      cron_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array de UUIDs dos crons a cancelar. Opcional se passar termo.',
      },
      termo: {
        type: 'string',
        description: 'Termo do texto do lembrete a cancelar (fallback). Match accent-insensitive contra payload.texto e nome. Use quando não tem UUID ou pra reforçar segurança.',
      },
    },
  },
  async handler(args, ctx) {
    const ids = (args.cron_ids as string[]) || [];
    const termo = (args.termo as string | undefined)?.trim() || '';

    // Path 1: tentou IDs primeiro (caso ideal)
    if (ids.length > 0) {
      const { data, error } = await ctx.supa
        .from('assistente_crons')
        .update({ ativo: false, updated_at: new Date().toISOString() })
        .eq('user_id', ctx.userId)
        .eq('ativo', true)
        .in('id', ids)
        .select('id, nome, payload');
      if (error) return { ok: false, error: error.message };
      const cancelados = (data || []) as Array<{ id: string; nome: string; payload: Record<string, unknown> }>;
      if (cancelados.length > 0) {
        return {
          ok: true,
          via: 'cron_ids',
          cancelados: cancelados.length,
          itens: cancelados.map(c => ({
            id: c.id,
            texto: (c.payload?.texto as string | undefined) || c.nome,
          })),
        };
      }
      // IDs todos furaram — Madeira alucinou. Auto-recovery: busca a última
      // chamada de listar_crons no audit_log do mesmo user (janela 60min) e
      // usa OS IDs CORRETOS retornados lá. Match por ORDEM (preserva intent
      // "1 e 2"). Pega os primeiros N da última listagem.
      // Caso 24/05 22:14: Madeira listou 2 Arthurs, Maikon demorou pra
      // responder "Confirma" — janela de 10min era curta. Aumentado 60min.
      // Também relaxa o match: aceita listar_crons que retornou >=ids.length
      // (não exige igualdade exata).
      // 4h: cobre fluxo "Cancelar X" → Madeira lista → Maikon demora pra
      // responder "Confirma" (cliente ocupado, sai, volta). Caso 24/05
      // 20:05 → 22:14: 2h gap entre lista e confirma. Janela 60min era curta.
      const quatroHorasAtras = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      const { data: recentAudit } = await ctx.supa
        .from('assistente_audit_log')
        .select('tool_calls, created_at')
        .eq('user_id', ctx.userId)
        .gte('created_at', quatroHorasAtras)
        .order('created_at', { ascending: false })
        .limit(60);
      let idsRecuperados: string[] = [];
      for (const row of (recentAudit || []) as Array<{ tool_calls: Array<Record<string, unknown>>; created_at: string }>) {
        for (const tc of row.tool_calls || []) {
          if (tc.name === 'listar_crons' && (tc.result as Record<string, unknown>)?.crons) {
            const crons = ((tc.result as { crons: Array<{ id: string; texto_preview?: string; ativo?: boolean }> }).crons || [])
              .filter(c => c.ativo !== false);
            // Pega os primeiros N da listagem (N = ids.length). Tolera
            // listagem com mais itens — usa só os primeiros.
            if (crons.length >= ids.length) {
              idsRecuperados = crons.slice(0, ids.length).map(c => c.id);
              break;
            }
          }
        }
        if (idsRecuperados.length > 0) break;
      }
      if (idsRecuperados.length > 0) {
        const { data: rec, error: eRec } = await ctx.supa
          .from('assistente_crons')
          .update({ ativo: false, updated_at: new Date().toISOString() })
          .eq('user_id', ctx.userId)
          .eq('ativo', true)
          .in('id', idsRecuperados)
          .select('id, nome, payload');
        if (!eRec && rec && rec.length > 0) {
          return {
            ok: true,
            via: 'auto_recovery_audit',
            cancelados: rec.length,
            itens: (rec as Array<{ id: string; nome: string; payload: Record<string, unknown> }>).map(c => ({
              id: c.id,
              texto: (c.payload?.texto as string | undefined) || c.nome,
            })),
            note: 'IDs originais alucinados — recuperados via última listar_crons',
          };
        }
      }
      // Antes de retornar "não achei", verifica se há recovery candidates
      // INATIVOS — Maikon pode estar pedindo pra cancelar algo que JÁ está
      // cancelado. Comunicação mais útil que "não achei".
      for (const row of (recentAudit || []) as Array<{ tool_calls: Array<Record<string, unknown>>; created_at: string }>) {
        for (const tc of row.tool_calls || []) {
          if (tc.name === 'listar_crons' && (tc.result as Record<string, unknown>)?.crons) {
            const cronsList = (tc.result as { crons: Array<{ id: string; texto_preview?: string }> }).crons || [];
            if (cronsList.length >= ids.length) {
              const idsCheck = cronsList.slice(0, ids.length).map(c => c.id);
              const { data: estado } = await ctx.supa
                .from('assistente_crons')
                .select('id, ativo, payload')
                .in('id', idsCheck);
              const inativos = ((estado || []) as Array<{ id: string; ativo: boolean; payload: Record<string, unknown> }>)
                .filter(c => !c.ativo);
              if (inativos.length === idsCheck.length) {
                return {
                  ok: false,
                  ja_cancelados: true,
                  itens: inativos.map(c => ({ id: c.id, texto: (c.payload?.texto as string | undefined) || '' })),
                  error: 'ESTES_LEMBRETES_JA_ESTAO_CANCELADOS. DIGA AO MAIKON: "Esses lembretes já estavam cancelados anteriormente — não tinha o que fazer." Não diga "não achei".',
                };
              }
            }
          }
        }
      }
      // Sem recovery + sem termo → erro explícito
      if (!termo) {
        return {
          ok: false,
          error: 'NENHUM cron encontrado com esses IDs e auto-recovery falhou. Chame listar_crons agora (com termo se houver) e tente de novo passando os UUIDs corretos OU termo.',
          cron_ids_recebidos: ids,
        };
      }
    }

    // Path 2: fallback por termo. Aplica match accent-insensitive
    // localmente (Postgres LIKE diferencia acentos) buscando candidatos.
    if (!termo) {
      return { ok: false, error: 'precisa de cron_ids OU termo' };
    }
    const { data: candidatos, error: e1 } = await ctx.supa
      .from('assistente_crons')
      .select('id, nome, payload')
      .eq('user_id', ctx.userId)
      .eq('ativo', true)
      .limit(50);
    if (e1) return { ok: false, error: e1.message };

    const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const termoNorm = semAcento(termo);
    const matches = ((candidatos || []) as Array<{ id: string; nome: string; payload: Record<string, unknown> }>)
      .filter(c => {
        const texto = (c.payload?.texto as string | undefined) || c.nome || '';
        return semAcento(texto).includes(termoNorm);
      });

    if (matches.length === 0) {
      return {
        ok: false,
        error: `Nenhum cron ativo bate com termo "${termo}". Pode ter sido cancelado antes ou termo errado. Diga ao Maikon que não achou e peça pra ele citar o texto exato do lembrete.`,
        termo,
      };
    }

    // Múltiplos matches — REQUER desambiguação (não cancela em massa por engano)
    if (matches.length > 1 && ids.length === 0) {
      return {
        ok: false,
        error: 'AMBÍGUO',
        termo,
        candidatos: matches.map(c => ({
          id: c.id,
          texto: (c.payload?.texto as string | undefined) || c.nome,
        })),
        instrucao: `Achei ${matches.length} crons que batem com "${termo}". Liste pro Maikon e pergunte qual cancelar — depois chame cancelar_cron com o cron_id específico.`,
      };
    }

    // 1 match: cancela
    const idsParaCancelar = matches.map(m => m.id);
    const { data, error } = await ctx.supa
      .from('assistente_crons')
      .update({ ativo: false, updated_at: new Date().toISOString() })
      .eq('user_id', ctx.userId)
      .eq('ativo', true)
      .in('id', idsParaCancelar)
      .select('id, nome, payload');
    if (error) return { ok: false, error: error.message };
    const cancelados = (data || []) as Array<{ id: string; nome: string; payload: Record<string, unknown> }>;
    return {
      ok: true,
      via: 'termo_fallback',
      cancelados: cancelados.length,
      itens: cancelados.map(c => ({
        id: c.id,
        texto: (c.payload?.texto as string | undefined) || c.nome,
      })),
    };
  },
};

const cancelarLembretesPorNumero: ToolDefinition = {
  name: 'cancelar_lembretes_por_numero',
  description: 'Cancela lembretes referenciando o NÚMERO de exibição na última mensagem agrupada que o Maikon recebeu (formato "🔔 Lembretes HH:MM (N): / 1) X / 2) Y / 3) Z"). Use quando ele disser "cancela o 1 e 3", "tira 2 e 4", "deixa só o 2", "cancela todos menos o 1", etc. A tool busca a última batch agrupada nas mensagens enviadas pelo chip Madeira nas últimas 6h, parseia as linhas numeradas e cancela os crons correspondentes via match de texto.',
  input_schema: {
    type: 'object',
    properties: {
      numeros: {
        type: 'array',
        items: { type: 'integer' },
        description: 'Lista dos números que ele quer cancelar (ex: [1, 3] pra "cancela 1 e 3"). Pra "deixa só o 2 num grupo de 4", passe [1,3,4].',
      },
      lista_citada: {
        type: 'string',
        description: 'O texto EXATO do bloco de lembretes que o Maikon citou no reply — copie do "[Maikon respondeu/citou esta mensagem anterior:]" do input, incluindo as linhas "1) ...", "2) ...". SEMPRE passe isto quando ele responder citando uma lista numerada. É a fonte mais confiável: o batch agrupado vem do cron-worker, que não fica salvo no banco, então sem este texto a tool pode não achar a lista.',
      },
    },
    required: ['numeros'],
  },
  async handler(args, ctx) {
    const nums = (args.numeros as number[]) || [];
    if (nums.length === 0) return { ok: false, error: 'numeros vazio' };

    type Item = { num: number; texto: string };
    const parsearNumerado = (text: string): Item[] => {
      const result: Item[] = [];
      for (const linha of text.split('\n')) {
        // Tolera prefixo de citação do WhatsApp ("> 1) X") além de "1) X" cru.
        const m = linha.match(/^\s*>?\s*(\d+)\)\s+(.+?)\s*$/);
        if (m) result.push({ num: parseInt(m[1], 10), texto: m[2].trim() });
      }
      return result;
    };

    let items: Item[] = [];
    let batchEm = '';
    let fonte = '';

    // PRIORIDADE 1 — texto citado no reply. O batch agrupado "🔔 Lembretes
    // HH:MM (N)" é enviado pelo cron-worker, que NÃO grava em assistente_audit_log
    // nem em messages (chip Agent-Madeira sem webhook outbound). Logo a busca
    // no banco abaixo NÃO acha esse caso — mas a lista numerada está na própria
    // citação do Maikon. Parseia ela primeiro: é a fonte garantida do fluxo real.
    // (caso 31/05 19:16 e 19:35 — "não achei lista numerada recente")
    const listaCitada = (args.lista_citada as string | undefined)?.trim();
    if (listaCitada) {
      const p = parsearNumerado(listaCitada);
      if (p.length >= 1) {
        items = p;
        batchEm = new Date().toISOString();
        fonte = 'reply_citado';
      }
    }

    // PRIORIDADE 2 — só consulta o banco se a citação não resolveu. Busca a
    // última lista numerada nas últimas 24h em 2 fontes (a mais recente):
    //   (A) assistente_audit_log.resposta_final — Madeira listou pra desambiguar.
    //   (B) messages.text — batch do worker, quando persistido.
    if (items.length === 0) {
      const vinteQuatroHorasAtras = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const [auditRes, msgsRes] = await Promise.all([
        ctx.supa
          .from('assistente_audit_log')
          .select('resposta_final, created_at')
          .eq('user_id', ctx.userId)
          .gte('created_at', vinteQuatroHorasAtras)
          .not('resposta_final', 'is', null)
          .order('created_at', { ascending: false })
          .limit(20),
        ctx.supa
          .from('messages')
          .select('text, created_at')
          .gte('created_at', vinteQuatroHorasAtras)
          .like('text', '%) %')
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      // Coleta candidatas das 2 fontes, ordena por data DESC, pega a primeira
      // que tem 2+ items numerados.
      type Cand = { text: string; at: string; from: string };
      const cands: Cand[] = [];
      for (const r of (auditRes.data || []) as Array<{ resposta_final: string | null; created_at: string }>) {
        if (r.resposta_final) cands.push({ text: r.resposta_final, at: r.created_at, from: 'audit_log' });
      }
      for (const r of (msgsRes.data || []) as Array<{ text: string | null; created_at: string }>) {
        if (r.text) cands.push({ text: r.text, at: r.created_at, from: 'messages' });
      }
      cands.sort((a, b) => b.at.localeCompare(a.at));

      for (const c of cands) {
        const p = parsearNumerado(c.text);
        if (p.length >= 2) {
          items = p;
          batchEm = c.at;
          fonte = c.from;
          break;
        }
      }
    }

    if (items.length === 0) {
      return {
        ok: false,
        error: 'Não achei a lista numerada. Se o Maikon respondeu CITANDO o lembrete, passe o texto citado (as linhas "1) ...", "2) ...") no parâmetro lista_citada. Senão, peça pra ele citar o texto ou use cancelar_cron com termo.',
      };
    }

    // Pra cada número pedido, acha o texto e tenta cancelar via termo
    const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const resultados: Array<{ numero: number; texto: string; cancelado: boolean; motivo?: string }> = [];

    for (const num of nums) {
      const item = items.find(i => i.num === num);
      if (!item) {
        resultados.push({ numero: num, texto: '', cancelado: false, motivo: 'número não existe na batch' });
        continue;
      }
      // Busca cron ativo cujo texto bate
      const { data: candidatos } = await ctx.supa
        .from('assistente_crons')
        .select('id, nome, payload')
        .eq('user_id', ctx.userId)
        .eq('ativo', true)
        .limit(100);
      const alvoNorm = semAcento(item.texto);
      const match = ((candidatos || []) as Array<{ id: string; nome: string; payload: Record<string, unknown> }>)
        .find(c => {
          const txt = (c.payload?.texto as string | undefined) || c.nome || '';
          return semAcento(txt).includes(alvoNorm) || alvoNorm.includes(semAcento(txt));
        });
      if (!match) {
        resultados.push({ numero: num, texto: item.texto, cancelado: false, motivo: 'cron não encontrado (talvez já cancelado)' });
        continue;
      }
      const { error: eUpd } = await ctx.supa
        .from('assistente_crons')
        .update({ ativo: false, updated_at: new Date().toISOString() })
        .eq('id', match.id)
        .eq('user_id', ctx.userId);
      if (eUpd) {
        resultados.push({ numero: num, texto: item.texto, cancelado: false, motivo: eUpd.message });
      } else {
        resultados.push({ numero: num, texto: item.texto, cancelado: true });
      }
    }

    const cancelados = resultados.filter(r => r.cancelado);
    const falhas = resultados.filter(r => !r.cancelado);
    return {
      ok: cancelados.length > 0,
      cancelados: cancelados.length,
      falhas: falhas.length,
      batch_em: batchEm,
      fonte,
      resultados,
    };
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
    const cota = await checarCota(ctx, 'indexar_aula_g4_atual');
    if (!cota.ok) return cota;
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
    const cota = await checarCota(ctx, 'indexar_aula_drive');
    if (!cota.ok) return cota;
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
// Estatísticas / agregações rápidas
// ============================================================================

// Helper: monta filtros comuns em queries Supabase pra contacts/leads
function aplicarFiltros<T extends { ilike: (col: string, v: string) => T; eq: (col: string, v: unknown) => T }>(
  q: T,
  filtros: { perfil?: string; especialidade?: string; instituicao?: string; cidade?: string },
  campos: { perfil: string; especialidade: string; instituicao: string; cidade: string },
): T {
  if (filtros.perfil) q = q.eq(campos.perfil, filtros.perfil);
  if (filtros.especialidade) q = q.ilike(campos.especialidade, `%${filtros.especialidade}%`);
  if (filtros.instituicao) q = q.ilike(campos.instituicao, `%${filtros.instituicao}%`);
  if (filtros.cidade) q = q.ilike(campos.cidade, `%${filtros.cidade}%`);
  return q;
}

const contarContatos: ToolDefinition = {
  name: 'contar_contatos',
  description: 'Conta contatos do CRM com filtros (perfil profissional, especialidade, instituição, cidade). Retorna total + breakdown por perfil pra dar visão. Use quando Maikon perguntar "quantos X eu tenho?", "quantos cardiologistas em SC?", "tenho gestor de hospital?" etc. Base: contacts (11k+ contatos do WhatsApp/cadastro). Pra base de prospecção (47k leads), use contar_leads.',
  input_schema: {
    type: 'object',
    properties: {
      perfil: { type: 'string', description: 'Ex: medico, gestor_saude, cirurgiao_cardiaco, anestesista, paciente, administrativo_saude, fornecedor' },
      especialidade: { type: 'string', description: 'Busca substring (ex: "cardio" pega cardiologia, cirurgia cardíaca)' },
      instituicao: { type: 'string', description: 'Busca substring' },
      cidade: { type: 'string', description: 'Busca substring' },
    },
  },
  async handler(args, ctx) {
    const filtros = {
      perfil: args.perfil as string | undefined,
      especialidade: args.especialidade as string | undefined,
      instituicao: args.instituicao as string | undefined,
      cidade: args.cidade as string | undefined,
    };
    const campos = { perfil: 'perfil_profissional', especialidade: 'especialidade', instituicao: 'instituicao', cidade: 'cidade' };

    let q1 = ctx.supa.from('contacts').select('id', { count: 'exact', head: true });
    q1 = aplicarFiltros(q1 as never, filtros, campos);
    const { count: total, error: e1 } = await q1;
    if (e1) return { ok: false, error: e1.message };

    // Breakdown por perfil (se nenhum filtro de perfil)
    let breakdown: Record<string, number> = {};
    if (!filtros.perfil) {
      let q2 = ctx.supa.from('contacts').select('perfil_profissional');
      q2 = aplicarFiltros(q2 as never, filtros, campos);
      const { data } = await q2.limit(20000);
      for (const r of (data || []) as Array<{ perfil_profissional: string | null }>) {
        const k = r.perfil_profissional || '(sem perfil)';
        breakdown[k] = (breakdown[k] || 0) + 1;
      }
    }
    return { ok: true, total: total || 0, filtros_aplicados: filtros, breakdown_por_perfil: breakdown };
  },
};

const listarContatosPorFiltro: ToolDefinition = {
  name: 'listar_contatos_por_filtro',
  description: 'Lista contatos do CRM (até 50) com filtros (perfil, especialidade, instituição, cidade). Use depois de contar_contatos quando Maikon quiser ver os nomes ("me lista esses 41 gestores"). Retorna nome, telefone, perfil, especialidade, instituição, cidade.',
  input_schema: {
    type: 'object',
    properties: {
      perfil: { type: 'string' },
      especialidade: { type: 'string' },
      instituicao: { type: 'string' },
      cidade: { type: 'string' },
      limite: { type: 'integer', default: 30, minimum: 1, maximum: 50 },
    },
  },
  async handler(args, ctx) {
    const filtros = {
      perfil: args.perfil as string | undefined,
      especialidade: args.especialidade as string | undefined,
      instituicao: args.instituicao as string | undefined,
      cidade: args.cidade as string | undefined,
    };
    const campos = { perfil: 'perfil_profissional', especialidade: 'especialidade', instituicao: 'instituicao', cidade: 'cidade' };
    let q = ctx.supa
      .from('contacts')
      .select('id, name, phone, perfil_profissional, especialidade, instituicao, cidade')
      .order('updated_at', { ascending: false })
      .limit(Math.min((args.limite as number) || 30, 50));
    q = aplicarFiltros(q as never, filtros, campos);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      total_retornado: (data || []).length,
      contatos: (data || []).map((c: { id: string; name: string | null; phone: string; perfil_profissional: string | null; especialidade: string | null; instituicao: string | null; cidade: string | null }) => ({
        id: c.id,
        nome: c.name || '(sem nome)',
        telefone: c.phone,
        perfil: c.perfil_profissional,
        especialidade: c.especialidade,
        instituicao: c.instituicao,
        cidade: c.cidade,
      })),
    };
  },
};

const contarLeads: ToolDefinition = {
  name: 'contar_leads',
  description: 'Conta leads da base de prospecção (47k+ registros, separada de contacts). Use quando Maikon perguntar sobre tamanho de base pra disparo: "quantos médicos tenho na base?", "quantos leads do tipo X?". Filtros: tipo_lead, tag, origem.',
  input_schema: {
    type: 'object',
    properties: {
      tipo_lead: { type: 'string', description: 'Ex: medico, novo, paciente, secretaria, hospital, empresario, fornecedor' },
      tag: { type: 'string', description: 'Tag específica dentro do array tags (ex: "cardiologia", "SC")' },
      origem: { type: 'string', description: 'Substring na origem' },
      apenas_ativos: { type: 'boolean', default: true },
    },
  },
  async handler(args, ctx) {
    let q = ctx.supa.from('leads').select('id', { count: 'exact', head: true });
    if (args.apenas_ativos !== false) q = q.eq('ativo', true);
    if (args.tipo_lead) q = q.eq('tipo_lead', args.tipo_lead);
    if (args.tag) q = q.contains('tags', [args.tag]);
    if (args.origem) q = q.ilike('origem', `%${args.origem}%`);
    const { count: total, error } = await q;
    if (error) return { ok: false, error: error.message };

    // Breakdown por tipo (se sem filtro de tipo)
    let breakdown: Record<string, number> = {};
    if (!args.tipo_lead) {
      let q2 = ctx.supa.from('leads').select('tipo_lead');
      if (args.apenas_ativos !== false) q2 = q2.eq('ativo', true);
      if (args.origem) q2 = q2.ilike('origem', `%${args.origem}%`);
      const { data } = await q2.limit(50000);
      for (const r of (data || []) as Array<{ tipo_lead: string | null }>) {
        const k = r.tipo_lead || '(sem tipo)';
        breakdown[k] = (breakdown[k] || 0) + 1;
      }
    }
    return { ok: true, total: total || 0, breakdown_por_tipo: breakdown };
  },
};

const buscarLead: ToolDefinition = {
  name: 'buscar_lead',
  description: 'Busca lead na base de prospecção (47k+) por nome ou telefone. Diferente de buscar_contato (essa busca em contacts). Use quando Maikon perguntar "tenho lead do Dr. X na base de disparos?".',
  input_schema: {
    type: 'object',
    properties: {
      termo: { type: 'string', description: 'Nome (parcial) ou telefone (com/sem DDD)' },
    },
    required: ['termo'],
  },
  async handler(args, ctx) {
    const termo = (args.termo as string).trim();
    if (!termo) return { ok: false, error: 'termo vazio' };
    const digitos = normalizarFone(termo);
    let q = ctx.supa
      .from('leads')
      .select('id, nome, telefone, email, tipo_lead, tags, origem, anotacoes, ativo')
      .eq('ativo', true)
      .limit(10);
    if (digitos.length >= 5) {
      const sufixo = digitos.slice(-8);
      q = q.ilike('telefone', `%${sufixo}%`);
    } else {
      q = q.ilike('nome', `%${termo}%`);
    }
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    return { ok: true, total: (data || []).length, leads: data };
  },
};

const detalharContato: ToolDefinition = {
  name: 'detalhar_contato',
  description: 'Ficha 360 de UM contato: dados + última conversa + tarefas relacionadas + campanhas em que está. Use quando Maikon pedir contexto completo de alguém ("me dá tudo sobre Dr. Pedro", "ficha do Hospital Marieta"). Use buscar_contato antes pra obter o contato_id.',
  input_schema: {
    type: 'object',
    properties: {
      contato_id: { type: 'string', description: 'UUID do contato (obtido por buscar_contato)' },
    },
    required: ['contato_id'],
  },
  async handler(args, ctx) {
    const id = args.contato_id as string;

    const { data: contato, error: e1 } = await ctx.supa
      .from('contacts')
      .select('id, name, phone, jid, perfil_profissional, especialidade, instituicao, cidade, observacoes, created_at, updated_at')
      .eq('id', id)
      .maybeSingle();
    if (e1 || !contato) return { ok: false, error: 'contato não encontrado' };

    const c = contato as { id: string; name: string | null; phone: string; jid: string; perfil_profissional: string | null; especialidade: string | null; instituicao: string | null; cidade: string | null; observacoes: string | null; created_at: string; updated_at: string };

    // Última conversa
    const { data: convs } = await ctx.supa
      .from('conversas')
      .select('id, status, qualificacao, ultima_mensagem_em, instancia_id')
      .eq('contact_id', id)
      .order('ultima_mensagem_em', { ascending: false })
      .limit(3);

    // Tarefas vinculadas (busca por nome ou telefone na descrição/título — heurística)
    const { data: tarefas } = await ctx.supa
      .from('task_flow_tasks')
      .select('id, titulo, status, prazo, created_at')
      .or(`titulo.ilike.%${c.name || c.phone}%,descricao.ilike.%${c.name || c.phone}%`)
      .neq('status', 'concluida')
      .order('created_at', { ascending: false })
      .limit(5);

    return {
      ok: true,
      contato: {
        id: c.id,
        nome: c.name || '(sem nome)',
        telefone: c.phone,
        perfil: c.perfil_profissional,
        especialidade: c.especialidade,
        instituicao: c.instituicao,
        cidade: c.cidade,
        observacoes: c.observacoes,
        cadastrado_em: c.created_at,
        atualizado_em: c.updated_at,
      },
      conversas_recentes: (convs || []).map((cv: { id: string; status: string; qualificacao: string | null; ultima_mensagem_em: string | null }) => ({
        id: cv.id,
        status: cv.status,
        qualificacao: cv.qualificacao,
        ultima_mensagem: cv.ultima_mensagem_em,
      })),
      tarefas_abertas: (tarefas || []).map((t: { id: string; titulo: string; status: string; prazo: string | null }) => ({
        id: t.id,
        titulo: t.titulo,
        status: t.status,
        prazo: t.prazo,
      })),
    };
  },
};

const estatisticasGerais: ToolDefinition = {
  name: 'estatisticas_gerais',
  description: 'Snapshot rápido do CRM: total contatos/leads, conversas ativas, tarefas em aberto, campanhas ativas. Use quando Maikon perguntar visão geral: "como tá o CRM?", "me dá um número geral", "quantos contatos eu tenho ao todo?".',
  input_schema: { type: 'object', properties: {} },
  async handler(_args, ctx) {
    const [c1, c2, c3, c4, c5] = await Promise.all([
      ctx.supa.from('contacts').select('id', { count: 'exact', head: true }),
      ctx.supa.from('leads').select('id', { count: 'exact', head: true }).eq('ativo', true),
      ctx.supa.from('conversas').select('id', { count: 'exact', head: true }).neq('status', 'finalizada'),
      ctx.supa.from('task_flow_tasks').select('id', { count: 'exact', head: true }).neq('status', 'concluida'),
      ctx.supa.from('campanhas_disparo').select('id', { count: 'exact', head: true }).eq('status', 'ativa'),
    ]);
    return {
      ok: true,
      contatos_total: c1.count || 0,
      leads_ativos: c2.count || 0,
      conversas_em_aberto: c3.count || 0,
      tarefas_pendentes: c4.count || 0,
      campanhas_ativas: c5.count || 0,
    };
  },
};

const estatisticasDisparos: ToolDefinition = {
  name: 'estatisticas_disparos',
  description: 'KPIs gerais de campanhas/disparos: total ativas, total enviado/sucesso/falha hoje (todas campanhas somadas), top 5 campanhas mais ativas. Use quando Maikon perguntar "como tão os disparos no geral?", "quanto saiu hoje?".',
  input_schema: { type: 'object', properties: {} },
  async handler(_args, ctx) {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const { data: ativas } = await ctx.supa
      .from('campanhas_disparo')
      .select('id, nome, total_leads, enviados, sucesso, falhas, status')
      .eq('status', 'ativa')
      .order('enviados', { ascending: false })
      .limit(5);
    const { count: enviadosHoje } = await ctx.supa
      .from('campanha_envios')
      .select('id', { count: 'exact', head: true })
      .gte('enviado_em', hoje.toISOString())
      .eq('status', 'enviado');
    const { count: falhaHoje } = await ctx.supa
      .from('campanha_envios')
      .select('id', { count: 'exact', head: true })
      .gte('atualizado_em', hoje.toISOString())
      .eq('status', 'falha');
    return {
      ok: true,
      enviados_hoje: enviadosHoje || 0,
      falhas_hoje: falhaHoje || 0,
      campanhas_ativas: (ativas || []).length,
      top_ativas: (ativas || []).map((c: { id: string; nome: string; total_leads: number; enviados: number; sucesso: number; falhas: number }) => ({
        nome: c.nome,
        total: c.total_leads,
        enviados: c.enviados,
        sucesso: c.sucesso,
        falhas: c.falhas,
        progresso_pct: c.total_leads > 0 ? Math.round((c.enviados / c.total_leads) * 100) : 0,
      })),
    };
  },
};

const tarefasPorResponsavel: ToolDefinition = {
  name: 'tarefas_por_responsavel',
  description: 'Quantas tarefas em aberto cada responsável tem (Iza, Mariana, Maikon, etc). Separa por status (em aberto, atrasadas). Use quando Maikon perguntar "como tá a Iza?", "quanto a Mariana tem?", "quem tá mais carregado?".',
  input_schema: { type: 'object', properties: {} },
  async handler(_args, ctx) {
    const agora = new Date().toISOString();
    const { data: tarefas } = await ctx.supa
      .from('task_flow_tasks')
      .select('id, titulo, status, prazo, responsavel_id, task_flow_profiles!inner(nome)')
      .neq('status', 'concluida')
      .limit(2000);
    const porResp: Record<string, { total: number; atrasadas: number }> = {};
    for (const t of (tarefas || []) as Array<{ status: string; prazo: string | null; task_flow_profiles?: { nome?: string } | { nome?: string }[] }>) {
      const profile = Array.isArray(t.task_flow_profiles) ? t.task_flow_profiles[0] : t.task_flow_profiles;
      const nome = profile?.nome || '(sem responsável)';
      if (!porResp[nome]) porResp[nome] = { total: 0, atrasadas: 0 };
      porResp[nome].total++;
      if (t.prazo && t.prazo < agora) porResp[nome].atrasadas++;
    }
    return { ok: true, por_responsavel: porResp };
  },
};

// ============================================================================
// Kanban "Lembrar Dr. Maikon" (entra no briefing matinal 7h da Iza)
// ============================================================================

// Coluna fixa do kanban Task Flow que a edge taskflow-lembrar-maikon lê
// pra montar o briefing matinal das 7h. Tasks aqui com prazo do dia entram
// na lista que Iza envia pro Maikon. Vide docs/n8n-workflows/avisos-diarios-07h.json
// + supabase/functions/taskflow-lembrar-maikon/index.ts.
const COLUNA_LEMBRAR_MAIKON = 'a2816095-38f9-44f9-9af9-e17ca8a2f5ea';
// Profile da Isadora no task_flow (ela é quem executa o "lembrar"). Padrão
// das tasks já criadas — Madeira segue mesmo padrão pra consistência visual
// no kanban da Iza/Mariana.
const PROFILE_ISADORA = 'cc5eabb0-8ebc-482f-af78-116953dce891';

const criarTarefaKanban: ToolDefinition = {
  name: 'criar_tarefa_kanban',
  description: 'Cria tarefa/lembrete no kanban TaskFlow na coluna "Lembrar Dr. Maikon". Tasks com prazo do dia entram automaticamente no briefing matinal de 7h que Iza envia pro Maikon. USE SEMPRE que Maikon pedir lembrete pra dia futuro ("lembrar amanhã", "terça preciso fazer X", "daqui 15 dias"). Pra recorrente ou horário específico EXATO use criar_cron junto. Tarefa fica visível pra Iza/Mariana no kanban.',
  input_schema: {
    type: 'object',
    properties: {
      titulo: { type: 'string', description: 'Título curto da tarefa (até 100 chars). Ex: "Lembrar Arthur do terno", "Ligar pro Dr Lobo".' },
      prazo_iso: {
        type: 'string',
        description: 'Data/hora do prazo em ISO 8601 BRT. Ex: "2026-05-12T07:00:00-03:00" pra entrar no briefing de terça 12/05. Se Maikon não especificou hora, use 07:00 BRT do dia (cai no briefing). Se especificou hora ("amanhã às 14h"), use a hora dele.',
      },
      descricao: { type: 'string', description: 'Detalhes opcionais (contexto, número, link, etc).' },
      tipo: { type: 'string', enum: ['tarefa', 'lembrete'], default: 'lembrete' },
    },
    required: ['titulo', 'prazo_iso'],
  },
  async handler(args, ctx) {
    const titulo = (args.titulo as string).trim();
    if (!titulo) return { ok: false, error: 'titulo obrigatorio' };
    const prazoIso = args.prazo_iso as string;
    const prazo = new Date(prazoIso);
    if (isNaN(prazo.getTime())) {
      return { ok: false, error: `prazo_iso inválido: "${prazoIso}". Use ISO 8601 (ex: 2026-05-12T07:00:00-03:00).` };
    }
    const { data, error } = await ctx.supa
      .from('task_flow_tasks')
      .insert({
        titulo: titulo.slice(0, 200),
        descricao: (args.descricao as string) || null,
        column_id: COLUNA_LEMBRAR_MAIKON,
        responsavel_id: PROFILE_ISADORA,
        criado_por_id: ctx.userId, // auth user_id Maikon — preserva audit trail "via Madeira"
        prazo: prazo.toISOString(),
        tipo: (args.tipo as string) || 'lembrete',
        origem: 'madeira_agente',
      })
      .select('id, titulo, prazo')
      .single();
    if (error) return { ok: false, error: error.message };
    const r = data as { id: string; titulo: string; prazo: string };
    return {
      ok: true,
      task_id: r.id,
      titulo: r.titulo,
      prazo_iso: r.prazo,
      info: 'Vai aparecer no briefing matinal 7h da Iza no dia do prazo.',
    };
  },
};

// ============================================================================
// Grupos WhatsApp (CEDEX, MBS, etc)
// ============================================================================

const buscarGrupo: ToolDefinition = {
  name: 'buscar_grupo',
  description: 'Busca mensagens recentes de grupos WhatsApp do Maikon (MBS, qualquer outro grupo dos 464 que ele participa). Use quando ele perguntar "tem aula hoje no MBS?", "qual o assunto da aula", "o que rolou no grupo X". Procura primeiro o grupo na tabela whatsapp_groups por nome (subject), depois busca msgs recentes desse grupo. Default 1 dia atrás. Se nome ambíguo (ex: "MBS" tem 3 grupos), retorna mensagens de todos.',
  input_schema: {
    type: 'object',
    properties: {
      nome_grupo: {
        type: 'string',
        description: 'Pedaço do nome do grupo (ex: "MBS", "Cardio", "Cetrus"). Case-insensitive. Se não passar, busca em TODOS os grupos no período.',
      },
      dias_atras: { type: 'integer', minimum: 1, maximum: 30, default: 1 },
      filtro: {
        type: 'string',
        description: 'Substring opcional pra filtrar conteúdo (ex: "aula", "horário", "sábado").',
      },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    },
  },
  async handler(args, ctx) {
    const dias = (args.dias_atras as number) || 1;
    const limit = (args.limit as number) || 50;
    const nomeGrupo = (args.nome_grupo as string || '').trim();
    const filtro = (args.filtro as string || '').trim();
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

    // 1. Resolver nome → lista de JIDs via whatsapp_groups
    let jidsAlvo: string[] = [];
    let gruposEncontrados: Array<{ jid: string; subject: string }> = [];
    if (nomeGrupo) {
      const escaped = nomeGrupo.replace(/[%_]/g, '\\$&');
      const { data: grupos } = await ctx.supa
        .from('whatsapp_groups')
        .select('jid, subject')
        .ilike('subject', `%${escaped}%`)
        .limit(20);
      gruposEncontrados = (grupos || []) as Array<{ jid: string; subject: string }>;
      jidsAlvo = gruposEncontrados.map(g => g.jid);
      if (jidsAlvo.length === 0) {
        return {
          ok: false,
          motivo: `Nenhum grupo com "${nomeGrupo}" no nome. Tente outro termo ou peça pra ver lista.`,
        };
      }
    }

    // 2. Buscar mensagens
    let query = ctx.supa
      .from('messages')
      .select('text, sender_jid, raw_payload, created_at, message_type')
      .gte('created_at', desde)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (jidsAlvo.length > 0) {
      query = query.in('raw_payload->key->>remoteJid', jidsAlvo);
    } else {
      query = query.filter('raw_payload->key->>remoteJid', 'like', '%@g.us');
    }
    if (filtro) {
      const f = filtro.replace(/[%_]/g, '\\$&');
      query = query.ilike('text', `%${f}%`);
    }

    const { data, error } = await query;
    if (error) return { ok: false, error: error.message };

    const msgs = (data || []).map((r: Record<string, unknown>) => {
      const raw = r.raw_payload as { key?: { remoteJid?: string }; pushName?: string } | undefined;
      const jid = raw?.key?.remoteJid || '';
      const grupo = gruposEncontrados.find(g => g.jid === jid)?.subject || jid.replace('@g.us', '');
      return {
        em: r.created_at,
        grupo,
        de: raw?.pushName || (r.sender_jid as string)?.split('@')[0] || '?',
        tipo: r.message_type,
        texto: ((r.text as string) || '').slice(0, 280),
      };
    });

    return {
      total: msgs.length,
      dias_atras: dias,
      grupos_pesquisados: gruposEncontrados.map(g => ({ jid: g.jid, nome: g.subject })),
      mensagens: msgs,
    };
  },
};

// resolver_grupo: query rápida só na whatsapp_groups (sem JOIN com messages
// que dá timeout em base grande). Use quando precisar SÓ do JID pra enviar
// mensagem em grupo, sem listar conteúdo.
const resolverGrupo: ToolDefinition = {
  name: 'resolver_grupo',
  description: 'Resolve nome de grupo WhatsApp em JID (formato 120363xxx@g.us). Use ANTES de chamar enviar_mensagem_pelo_chip pra grupos. NÃO INVENTE JID — sempre use esta tool. Match case-insensitive substring no nome do grupo.',
  input_schema: {
    type: 'object',
    properties: {
      nome: { type: 'string', description: 'Pedaço do nome do grupo (ex: "GSS Jurídico", "MBS", "CBEXS").' },
    },
    required: ['nome'],
  },
  async handler(args, ctx) {
    const nome = (args.nome as string || '').trim();
    if (!nome) return { ok: false, error: 'nome obrigatório' };

    // Fuzzy match: tira acentos, split em palavras (>=3 chars), busca grupos
    // que contenham TODAS as palavras (qualquer ordem). Antes ILIKE substring
    // exata falhava em "GSS Juridico" pra grupo "Jurídico GSS Sócios" (ordem
    // diferente + acento).
    const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const termos = semAcento(nome).split(/[\s\-_/|]+/).filter(w => w.length >= 3);

    if (termos.length === 0) {
      // Fallback: busca substring direta como antes
      const escaped = nome.replace(/[%_]/g, '\\$&');
      const { data } = await ctx.supa.from('whatsapp_groups')
        .select('jid, subject, participants_count').ilike('subject', `%${escaped}%`).limit(20);
      const grupos = (data || []) as Array<{ jid: string; subject: string; participants_count: number | null }>;
      if (grupos.length === 0) return { ok: false, motivo: `Nenhum grupo com "${nome}".` };
      return { ok: true, total: grupos.length, grupos: grupos.map(g => ({ jid: g.jid, nome: g.subject, participantes: g.participants_count })) };
    }

    // Pré-filtro DB: retorna grupos que contenham PELO MENOS uma palavra
    // (reduz universo). Filtragem fina (todas as palavras, sem acento) em JS.
    let q = ctx.supa.from('whatsapp_groups').select('jid, subject, participants_count');
    const orParts = termos.map(t => `subject.ilike.%${t.replace(/[%_]/g, '\\$&')}%`).join(',');
    q = q.or(orParts);
    const { data, error } = await q.limit(200);
    if (error) return { ok: false, error: error.message };

    type Row = { jid: string; subject: string; participants_count: number | null };
    const todos = (data || []) as Row[];
    // Ranking: quantas palavras do termo aparecem no subject (sem acento).
    // Se TODAS aparecem, score = termos.length (match perfeito).
    const ranked = todos
      .map(g => {
        const subj = semAcento(g.subject || '');
        const matches = termos.filter(t => subj.includes(t)).length;
        return { ...g, _matches: matches };
      })
      .filter(g => g._matches > 0)
      .sort((a, b) => b._matches - a._matches || a.subject.length - b.subject.length);

    // Prefere matches perfeitos (todas palavras). Se nenhum perfeito, devolve top 10 parciais.
    const perfeitos = ranked.filter(g => g._matches === termos.length);
    const finais = perfeitos.length > 0 ? perfeitos : ranked.slice(0, 10);

    if (finais.length === 0) {
      return { ok: false, motivo: `Nenhum grupo com "${nome}" no nome.` };
    }
    return {
      ok: true,
      total: finais.length,
      match_perfeito: perfeitos.length > 0,
      grupos: finais.map(g => ({ jid: g.jid, nome: g.subject, participantes: g.participants_count })),
    };
  },
};

// ============================================================================
// Perfil estrutural do dono (Madeira "claude.md" do Maikon)
// ============================================================================

const atualizarPerfilDono: ToolDefinition = {
  name: 'atualizar_perfil_dono',
  description: 'Atualiza um campo do PERFIL ESTRUTURAL do Maikon (dado canônico, sempre cacheado no contexto). Use quando ele te contar fato estável: identidade, empresas, equipe, hospitais onde opera, convênios, parceiros-chave, rotina, regras pessoais, datas familiares. Diferente de salvar_memoria — perfil é o "claude.md" dele, salvar_memoria é fragmento volátil. Sempre busque o valor atual antes (passe o array completo atualizado, não apenas o item novo).',
  input_schema: {
    type: 'object',
    properties: {
      campo: {
        type: 'string',
        enum: [
          'identidade', 'empresas', 'equipe', 'hospitais_operacao',
          'convenios', 'parceiros_chave', 'rotina', 'regras_pessoais',
          'datas_familia', 'notas_extra',
        ],
        description: 'Qual slot do perfil atualizar.',
      },
      valor: {
        description: 'Conteúdo completo (objeto ou array). Substitui o valor anterior — passe sempre o estado FINAL desejado.',
      },
    },
    required: ['campo', 'valor'],
  },
  async handler(args, ctx) {
    const { error } = await ctx.supa.rpc('atualizar_perfil_dono', {
      p_user_id: ctx.userId,
      p_campo: args.campo,
      p_valor: args.valor,
    });
    if (error) throw new Error(error.message);
    return { ok: true, campo: args.campo };
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
  // Web search (Fase 8)
  pesquisarWeb,
  extrairUrl,
  // Kanban Task Flow (Fase 12)
  criarTarefaKanban,
  // Grupos WhatsApp (Fase 11)
  buscarGrupo,
  resolverGrupo,
  // Perfil estrutural (Fase 10)
  atualizarPerfilDono,
  // Memória / Crons
  salvarMemoria,
  buscarMemoria,
  criarCron,
  enviarMensagemPeloChip,
  listarCrons,
  pausarCron,
  cancelarCron,
  cancelarLembretesPorNumero,
  registrarCorrecao,
  // RAG G4
  buscarAulasG4,
  indexarAulaG4Atual,
  indexarAulaDrive,
  listarAulasG4,
  // Estatísticas / classificação (Fase 9)
  contarContatos,
  listarContatosPorFiltro,
  contarLeads,
  buscarLead,
  detalharContato,
  estatisticasGerais,
  estatisticasDisparos,
  tarefasPorResponsavel,
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
