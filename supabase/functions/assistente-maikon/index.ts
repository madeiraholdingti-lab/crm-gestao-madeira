// assistente-maikon (Stage 6)
//
// Bot IA que o Maikon/admins conversam via WhatsApp pra consultar e operar o CRM.
// Trigger: msg começando com prefixo bot (/m, !bot, /maikonect) vinda de um phone
// na whitelist bot_admin_phones. Input vem do evolution-messages-webhook.
//
// Tools disponíveis (Gemini 2.0 function calling):
//   - status_geral() → resumo executivo
//   - listar_campanhas(apenas_ativas?) → campanhas com progresso
//   - pausar_campanha(nome) → muda status pra 'pausada'
//   - retomar_campanha(nome) → muda status pra 'ativa'
//   - agenda_hoje() → eventos de hoje
//   - conversas_pendentes(responsavel?) → conversas sem resposta há >2h
//   - criar_tarefa(titulo, responsavel_nome?, prazo_dias?) → cria em task_flow_tasks
//
// Input: { msg, sender_phone, instancia_id, instancia_nome }
// Output: resposta é enviada direto via Evolution API (fire-and-forget)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const { msg, sender_phone, instancia_id, instancia_nome } = await req.json();
    if (!msg || !sender_phone) {
      return json({ ok: false, error: 'msg + sender_phone obrigatórios' });
    }

    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiKey) return json({ ok: false, error: 'GEMINI_API_KEY não configurada' });

    // Descobrir quem é o sender pra personalizar
    const { data: profile } = await supabase
      .from('contacts')
      .select('id, name')
      .eq('phone', sender_phone)
      .maybeSingle();

    const senderName = profile?.name || 'Maikon';

    // Snapshot de contexto (o bot sabe o estado atual)
    const contexto = await montarContexto(supabase);

    const systemPrompt = montarSystemPrompt(senderName, contexto);

    // Tools definition pro Gemini
    const tools = [{
      functionDeclarations: [
        { name: 'status_geral', description: 'Retorna resumo executivo: campanhas ativas, conversas pendentes, tarefas urgentes, agenda de hoje.', parameters: { type: 'object', properties: {} } },
        { name: 'listar_campanhas', description: 'Lista campanhas de disparo com progresso.', parameters: { type: 'object', properties: { apenas_ativas: { type: 'boolean', description: 'true=só status ativa/em_andamento. Default true.' } } } },
        { name: 'pausar_campanha', description: 'Pausa uma campanha (match por nome substring).', parameters: { type: 'object', properties: { nome: { type: 'string' } }, required: ['nome'] } },
        { name: 'retomar_campanha', description: 'Retoma uma campanha pausada.', parameters: { type: 'object', properties: { nome: { type: 'string' } }, required: ['nome'] } },
        { name: 'agenda_hoje', description: 'Eventos agendados pra hoje.', parameters: { type: 'object', properties: {} } },
        { name: 'agenda_semana', description: 'Eventos dos próximos 7 dias agrupados por dia.', parameters: { type: 'object', properties: {} } },
        { name: 'conversas_pendentes', description: 'Conversas WA sem resposta há >2h, agrupadas por responsável.', parameters: { type: 'object', properties: { responsavel_nome: { type: 'string', description: 'Filtrar por secretária específica (ex: Isadora, Mariana).' } } } },
        { name: 'criar_tarefa', description: 'Cria uma tarefa no Task-Flow.', parameters: { type: 'object', properties: { titulo: { type: 'string' }, responsavel_nome: { type: 'string' }, prazo_dias: { type: 'integer', description: 'Dias a partir de hoje. 0=hoje, 1=amanhã.' } }, required: ['titulo'] } },
      ],
    }];

    // Round 1: Gemini decide se chama tool ou responde direto
    const round1 = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: msg }] }],
        tools,
        generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
      }),
    });

    if (!round1.ok) {
      const err = await round1.text();
      console.error('[assistente] Gemini r1 erro:', round1.status, err);
      await responder(supabase, sender_phone, instancia_nome, `Ih, deu problema na IA aqui (${round1.status}). Tenta de novo em uns minutos.`);
      return json({ ok: false, error: 'Gemini error' });
    }

    const data1 = await round1.json();
    const candidate1 = data1?.candidates?.[0];
    const parts1 = candidate1?.content?.parts || [];

    const toolCalls = parts1.filter((p: { functionCall?: unknown }) => p.functionCall);
    let respostaFinal = '';

    if (toolCalls.length > 0) {
      // Executa tools e retorna resultado pro Gemini
      const toolResults: { name: string; response: unknown }[] = [];
      for (const tc of toolCalls) {
        const fn = tc.functionCall;
        const result = await executarTool(supabase, fn.name, fn.args || {});
        toolResults.push({ name: fn.name, response: result });
      }

      // Round 2: Gemini gera resposta final com os resultados
      const round2 = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [
            { role: 'user', parts: [{ text: msg }] },
            { role: 'model', parts: toolCalls.map((tc: any) => ({ functionCall: tc.functionCall })) },
            { role: 'function', parts: toolResults.map(r => ({ functionResponse: { name: r.name, response: r.response } })) },
          ],
          tools,
          generationConfig: { temperature: 0.4, maxOutputTokens: 600 },
        }),
      });

      const data2 = await round2.json();
      respostaFinal = data2?.candidates?.[0]?.content?.parts?.[0]?.text || 'Processei, mas não consegui formular resposta.';
    } else {
      // Gemini respondeu direto sem tool
      respostaFinal = parts1[0]?.text || 'Oi, pode repetir?';
    }

    await responder(supabase, sender_phone, instancia_nome, respostaFinal);
    void instancia_id; // disponível pro futuro se precisar forçar chip específico

    return json({ ok: true, resposta: respostaFinal, tools_usadas: toolCalls.map((t: any) => t.functionCall.name) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[assistente-maikon] ERRO:', msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function montarContexto(supabase: any): Promise<string> {
  // Snapshot estado atual pro LLM entender contexto
  const [campanhasAtivas, conversasPendentes, profiles] = await Promise.all([
    supabase.from('campanhas_disparo').select('nome').in('status', ['ativa', 'em_andamento']),
    supabase.from('conversas').select('id', { count: 'exact', head: true })
      .in('status', ['novo', 'Aguardando Contato', 'Em Atendimento']).is('ignorada_em', null),
    supabase.from('profiles').select('nome').eq('ativo', true),
  ]);

  const nomes = (profiles.data || []).map((p: { nome: string }) => p.nome).join(', ');
  return `Estado atual do CRM:
- ${campanhasAtivas.data?.length ?? 0} campanha(s) ativa(s)
- ~${conversasPendentes.count ?? 0} conversa(s) abertas no WA
- Equipe: ${nomes}`;
}

function montarSystemPrompt(senderName: string, contexto: string): string {
  return `Você é o assistente Maikonect do Dr. Maikon Madeira (cirurgião cardíaco em Itajaí/SC).

Você conversa via WhatsApp com ${senderName}. Use linguagem CURTA, direta, coloquial brasileira. Máx 3-4 frases.
NÃO use emoji, NÃO use markdown (bold/italic/listas).

${contexto}

Você tem ferramentas pra consultar e operar o CRM. Use-as quando o ${senderName} pedir info ou ação. Se a pergunta for simples ("oi", "tudo bem?"), responde conversacional sem tool.

Regras:
- Quando usar tools, chame UMA única por vez
- Traduza resultado técnico em linguagem humana e curta
- Números grandes abreviados (1,2k em vez de 1234)
- Horários em formato HH:MM (ex: 14:30)
- Se tool der erro ou não achar, diga isso direto sem enrolar
- Pra criar tarefa, se ${senderName} não disser o responsável, pergunte 1x só
- Quando pausar/retomar campanha, confirme depois com o nome exato que foi alterada`;
}

async function executarTool(supabase: any, name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case 'status_geral': {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const amanha = new Date(hoje);
        amanha.setDate(amanha.getDate() + 1);

        const [camps, conv, tarefas, evt, duaHs] = await Promise.all([
          supabase.from('campanhas_disparo').select('nome, sucesso, falhas, envios_por_dia').in('status', ['ativa', 'em_andamento']),
          supabase.from('conversas').select('id', { count: 'exact', head: true }).in('status', ['novo', 'Aguardando Contato']).is('ignorada_em', null),
          supabase.from('task_flow_tasks').select('id', { count: 'exact', head: true }).lt('prazo', new Date().toISOString()).is('deleted_at', null),
          supabase.from('eventos_agenda').select('titulo, data_hora_inicio').gte('data_hora_inicio', hoje.toISOString()).lt('data_hora_inicio', amanha.toISOString()).order('data_hora_inicio'),
          supabase.from('conversas').select('id', { count: 'exact', head: true }).lt('ultima_interacao', new Date(Date.now() - 2 * 3600 * 1000).toISOString()).eq('last_message_from_me', false).is('ignorada_em', null),
        ]);

        return {
          campanhas_ativas: camps.data?.length ?? 0,
          campanhas_detalhe: camps.data,
          conversas_abertas: conv.count ?? 0,
          conversas_sem_resposta_2h: duaHs.count ?? 0,
          tarefas_atrasadas: tarefas.count ?? 0,
          agenda_hoje: evt.data,
        };
      }

      case 'listar_campanhas': {
        const apenasAtivas = args.apenas_ativas !== false;
        let q = supabase.from('campanhas_disparo')
          .select('id, nome, tipo, status, sucesso, falhas, envios_por_dia')
          .order('updated_at', { ascending: false });
        if (apenasAtivas) q = q.in('status', ['ativa', 'em_andamento']);
        const { data } = await q.limit(20);
        return { campanhas: data || [] };
      }

      case 'pausar_campanha':
      case 'retomar_campanha': {
        const nome = (args.nome as string || '').trim();
        const { data: matches } = await supabase.from('campanhas_disparo')
          .select('id, nome, status').ilike('nome', `%${nome}%`).limit(5);
        if (!matches || matches.length === 0) return { erro: `Nenhuma campanha com "${nome}"` };
        if (matches.length > 1) return { erro: 'Ambíguo, várias campanhas batem', candidatas: matches.map((m: any) => m.nome) };
        const c = matches[0];
        const novoStatus = name === 'pausar_campanha' ? 'pausada' : 'ativa';
        await supabase.from('campanhas_disparo').update({ status: novoStatus }).eq('id', c.id);
        return { ok: true, campanha: c.nome, novo_status: novoStatus };
      }

      case 'agenda_hoje': {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const amanha = new Date(hoje);
        amanha.setDate(amanha.getDate() + 1);
        const { data } = await supabase.from('eventos_agenda')
          .select('titulo, data_hora_inicio, data_hora_fim, tipo_evento')
          .gte('data_hora_inicio', hoje.toISOString())
          .lt('data_hora_inicio', amanha.toISOString())
          .order('data_hora_inicio');
        return { eventos: data || [] };
      }

      case 'agenda_semana': {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const em7 = new Date(hoje);
        em7.setDate(em7.getDate() + 7);
        const { data } = await supabase.from('eventos_agenda')
          .select('titulo, data_hora_inicio, tipo_evento')
          .gte('data_hora_inicio', hoje.toISOString())
          .lt('data_hora_inicio', em7.toISOString())
          .order('data_hora_inicio').limit(50);
        return { eventos: data || [] };
      }

      case 'conversas_pendentes': {
        const respNome = (args.responsavel_nome as string | undefined);
        const duasHoras = new Date(Date.now() - 2 * 3600 * 1000).toISOString();

        let q = supabase.from('conversas')
          .select('nome_contato, numero_contato, ultima_interacao, responsavel_atual, profiles:responsavel_atual(nome)')
          .eq('last_message_from_me', false)
          .lt('ultima_interacao', duasHoras)
          .is('ignorada_em', null)
          .order('ultima_interacao', { ascending: true })
          .limit(10);

        if (respNome) {
          const { data: prof } = await supabase.from('profiles').select('id').ilike('nome', `%${respNome}%`).maybeSingle();
          if (prof?.id) q = q.eq('responsavel_atual', prof.id);
        }
        const { data } = await q;
        return { conversas: data || [] };
      }

      case 'criar_tarefa': {
        const titulo = args.titulo as string;
        const respNome = args.responsavel_nome as string | undefined;
        const prazoDias = (args.prazo_dias as number | undefined) ?? null;

        let respUserId: string | null = null;
        if (respNome) {
          const { data: prof } = await supabase.from('profiles').select('id').ilike('nome', `%${respNome}%`).maybeSingle();
          respUserId = prof?.id ?? null;
        }

        const prazo = prazoDias != null ? new Date(Date.now() + prazoDias * 86400 * 1000).toISOString() : null;

        // Buscar task_flow_profile do responsável (se houver)
        let respProfileId: string | null = null;
        if (respUserId) {
          const { data: tfp } = await supabase.from('task_flow_profiles').select('id').eq('user_id', respUserId).maybeSingle();
          respProfileId = tfp?.id ?? null;
        }

        // Coluna default (primeira)
        const { data: col } = await supabase.from('task_flow_columns').select('id').order('ordem').limit(1).maybeSingle();

        if (!col?.id) return { erro: 'Nenhuma coluna encontrada pra criar tarefa' };

        const { data: nova } = await supabase.from('task_flow_tasks').insert({
          titulo,
          column_id: col.id,
          responsavel_id: respProfileId,
          prazo,
          tipo: 'tarefa',
        }).select('id').single();

        return { ok: true, tarefa_id: nova?.id, responsavel_nome: respNome ?? 'Sem atribuição', prazo };
      }

      default:
        return { erro: `Tool ${name} desconhecida` };
    }
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error(`[tool:${name}] erro:`, m);
    return { erro: m };
  }
}

async function responder(supabase: any, phone: string, instanciaNome: string, texto: string) {
  const { data: evoConfig } = await supabase.from('config_global')
    .select('evolution_base_url, evolution_api_key').limit(1).single();
  const evoUrl = evoConfig?.evolution_base_url?.replace(/\/+$/, '');
  const evoKey = evoConfig?.evolution_api_key;
  if (!evoUrl || !evoKey) return;

  // Normaliza número
  let digits = phone.replace(/\D/g, '');
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2);
  if (digits.length === 10) digits = digits.slice(0, 2) + '9' + digits.slice(2);
  const dest = '55' + digits;

  try {
    await fetch(`${evoUrl}/message/sendText/${encodeURIComponent(instanciaNome)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: evoKey },
      body: JSON.stringify({ number: dest, text: texto }),
    });
  } catch (err) {
    console.error('[assistente] falha ao responder:', err);
  }
}

function json(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
