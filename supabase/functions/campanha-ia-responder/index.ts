// campanha-ia-responder
// Processa envios em status='em_conversa' que estão aguardando resposta IA.
//
// Gatilho:
//   - pg_cron a cada 2min chama essa fn em "modo varredura"
//   - OU chamada direta com { campanha_envio_id } pra processar específico
//
// Fluxo:
//   1. Busca envios em_conversa via vw_envios_aguardando_ia
//   2. Anti-debounce: só processa se primeira_msg_contato_em > 15s atrás
//      (agrupa msgs picadas do contato)
//   3. Busca histórico de mensagens (últimas 30) da conversa
//   4. Monta prompt com briefing_ia + histórico
//   5. Gemini 2.5 Flash responde (structured output)
//   6. Envia mensagens via Evolution API
//   7. Detecta handoff (palavras-chave ou flag da IA) → notifica responsável
//   8. Atualiza status do envio

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const DEBOUNCE_SECONDS = 15;
const MAX_MESSAGES_IN_CONTEXT = 30;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    messages: {
      type: 'array',
      items: { type: 'string' },
      description: 'Array de mensagens curtas pra enviar em sequência. Máximo 3.',
    },
    alerta_lead: {
      type: 'boolean',
      description: 'true se o lead demonstrou interesse forte/urgência OU pediu algo fora do briefing. Escala pra humano.',
    },
    motivo_alerta: {
      type: 'string',
      description: 'Se alerta_lead=true, resumo em 1 frase do por quê. Senão string vazia.',
    },
    conversa_encerrada: {
      type: 'boolean',
      description: 'true se lead disse claramente que não tem interesse ou pediu pra parar.',
    },
  },
  required: ['messages', 'alerta_lead', 'motivo_alerta', 'conversa_encerrada'],
};

interface BriefingIA {
  ia_ativa?: boolean;
  persona?: string;
  contexto?: string;
  objetivo?: string;
  beneficios?: string[];
  objecoes?: Array<{ pergunta: string; resposta: string }>;
  handoff_keywords?: string[];
  handoff_telefone?: string;
  handoff_numero_chip?: string;
  palavras_proibidas?: string[];
  max_turns?: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const envioIdSpecific: string | undefined = body.campanha_envio_id;

    // Descobrir envios a processar
    let envios: Record<string, unknown>[] = [];
    if (envioIdSpecific) {
      const { data } = await supabase
        .from('campanha_envios')
        .select('id, campanha_id, lead_id, telefone, respondeu_em, primeira_msg_contato_em, status, campanha:campanha_id(briefing_ia, status, mensagem)')
        .eq('id', envioIdSpecific)
        .limit(1);
      envios = data || [];
    } else {
      // Modo varredura: pega envios em_conversa com msg do contato há >DEBOUNCE_SECONDS
      const cutoff = new Date(Date.now() - DEBOUNCE_SECONDS * 1000).toISOString();
      const { data } = await supabase
        .from('campanha_envios')
        .select('id, campanha_id, lead_id, telefone, respondeu_em, primeira_msg_contato_em, status, campanha:campanha_id(briefing_ia, status, mensagem)')
        .eq('status', 'em_conversa')
        .not('primeira_msg_contato_em', 'is', null)
        .lt('primeira_msg_contato_em', cutoff)
        .limit(10);
      envios = data || [];
    }

    const results: Record<string, unknown>[] = [];
    for (const envio of envios) {
      const r = await processarEnvio(supabase, envio);
      results.push({ envio: envio.id, ...r });
    }

    return json({ ok: true, processados: results.length, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[campanha-ia-responder] ERRO:', msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function processarEnvio(supabase: any, envio: any): Promise<Record<string, unknown>> {
  const camp = envio.campanha as { briefing_ia?: BriefingIA; status?: string; mensagem?: string } | null;
  if (!camp) return { ok: false, error: 'Campanha não encontrada' };
  if (!['ativa', 'em_andamento'].includes(camp.status || '')) {
    return { ok: true, msg: `Campanha ${camp.status}` };
  }

  const briefing = camp.briefing_ia || {};
  if (!briefing.ia_ativa) {
    return { ok: true, msg: 'IA não ativa nessa campanha' };
  }

  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiKey) return { ok: false, error: 'GEMINI_API_KEY não configurada' };

  // Lock atômico — só processa se primeira_msg_contato_em não mudou
  const lockCheck = envio.primeira_msg_contato_em;

  // Buscar contato
  const { data: contact } = await supabase
    .from('contacts')
    .select('id, name, phone, jid, perfil_profissional')
    .eq('id', envio.lead_id)
    .maybeSingle();

  if (!contact) return { ok: false, error: 'Contato não encontrado' };

  // Buscar histórico (últimas 30 msgs)
  const { data: mensagens } = await supabase
    .from('messages')
    .select('text, from_me, wa_timestamp, created_at, message_type')
    .eq('contact_id', contact.id)
    .order('created_at', { ascending: false })
    .limit(MAX_MESSAGES_IN_CONTEXT);

  const historico = (mensagens || []).reverse();

  if (historico.length === 0) return { ok: false, error: 'Sem mensagens no histórico' };

  // Detecção simples de handoff por palavras-chave (pré-IA)
  const ultimaMsgContato = historico.filter((m: any) => !m.from_me).slice(-1)[0];
  const textoUltima = ((ultimaMsgContato?.text as string) || '').toLowerCase();
  const keywords = briefing.handoff_keywords || ['salario', 'salário', 'valor', 'remuneração', 'remuneracao', 'quanto paga', 'preço', 'preco'];
  const detectouKeyword = keywords.some(k => textoUltima.includes(k.toLowerCase()));

  // Montar prompt
  const systemPrompt = montarSystemPrompt(briefing, camp.mensagem || '');
  const userPrompt = montarUserPrompt(contact, historico, detectouKeyword);

  // Chamar Gemini
  const geminiResp = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.7,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });

  if (!geminiResp.ok) {
    const errText = await geminiResp.text();
    console.error('[ia-responder] Gemini erro:', geminiResp.status, errText.slice(0, 300));
    return { ok: false, error: `Gemini ${geminiResp.status}` };
  }

  const geminiData = await geminiResp.json();
  const textOutput = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textOutput) return { ok: false, error: 'Resposta Gemini vazia' };

  let parsed: { messages: string[]; alerta_lead: boolean; motivo_alerta: string; conversa_encerrada: boolean };
  try {
    parsed = JSON.parse(textOutput.replace(/^```json\s*/i, '').replace(/```$/, '').trim());
  } catch {
    return { ok: false, error: 'JSON inválido Gemini', raw: textOutput.slice(0, 200) };
  }

  // Re-verificar lock: se primeira_msg_contato_em mudou, o contato mandou nova msg
  // durante o tempo do Gemini — aborta pra não responder desatualizado.
  const { data: envioAgora } = await supabase
    .from('campanha_envios')
    .select('primeira_msg_contato_em')
    .eq('id', envio.id)
    .single();

  if (envioAgora?.primeira_msg_contato_em !== lockCheck) {
    console.log(`[ia-responder] Debounce invalidado — contato mandou msg nova, aborta`);
    return { ok: true, msg: 'Debounce invalidado' };
  }

  // Handoff?
  const deveFazerHandoff = detectouKeyword || parsed.alerta_lead;
  if (deveFazerHandoff && briefing.handoff_telefone) {
    await notificarHandoff(supabase, briefing, contact, camp, parsed.motivo_alerta, detectouKeyword, textoUltima);
  }

  // Enviar mensagens da IA
  if (parsed.messages && parsed.messages.length > 0) {
    await enviarMensagensIA(supabase, contact.phone || envio.telefone, parsed.messages, briefing.handoff_numero_chip);
  }

  // Atualizar status do envio
  const novoStatus = parsed.conversa_encerrada ? 'descartado'
    : deveFazerHandoff ? 'qualificado'
    : 'em_conversa';

  await supabase.from('campanha_envios').update({
    status: novoStatus,
    // zerar primeira_msg_contato_em pra não reprocessar
    primeira_msg_contato_em: null,
  }).eq('id', envio.id);

  return {
    ok: true,
    mensagens_enviadas: parsed.messages?.length || 0,
    handoff: deveFazerHandoff,
    motivo: parsed.motivo_alerta,
    novo_status: novoStatus,
  };
}

function montarSystemPrompt(briefing: BriefingIA, mensagemInicial: string): string {
  const persona = briefing.persona || 'Você é um assistente da empresa Gestão Serviço Saúde (GSS) do Dr. Maikon Madeira.';
  const contexto = briefing.contexto || '';
  const objetivo = briefing.objetivo || 'Qualificar o interesse do lead e, se ele demonstrar interesse, escalar pra humano.';

  const beneficios = briefing.beneficios && briefing.beneficios.length > 0
    ? `\n\nBenefícios da proposta:\n${briefing.beneficios.map(b => `- ${b}`).join('\n')}`
    : '';

  const objecoes = briefing.objecoes && briefing.objecoes.length > 0
    ? `\n\nRespostas a objeções comuns:\n${briefing.objecoes.map(o => `- Pergunta: "${o.pergunta}"\n  Resposta: ${o.resposta}`).join('\n')}`
    : '';

  const proibidas = briefing.palavras_proibidas && briefing.palavras_proibidas.length > 0
    ? `\n\nNUNCA use estas palavras: ${briefing.palavras_proibidas.join(', ')}.`
    : '';

  return `${persona}

${contexto}

OBJETIVO DA CONVERSA: ${objetivo}

MENSAGEM INICIAL QUE FOI ENVIADA PRO LEAD:
"${mensagemInicial}"
${beneficios}${objecoes}${proibidas}

REGRAS IMPORTANTES:
- Responda de forma NATURAL e CURTA, como numa conversa real de WhatsApp entre colegas.
- Prefira 1-2 frases. Se precisar 2 msgs, pode separar (máximo 3).
- NÃO use emoji automático, NÃO use markdown/bold/italic, NÃO liste com bullets.
- Use pontuação conversacional. Abreviações são ok (vc, tb, pq, blz).
- Se for cumprimento de manhã/tarde/noite, varie (oi, opa, e aí, fala dr) — EVITE "Olá!".
- Se o lead pedir salário/valor/remuneração → NÃO responda o valor. Escale (alerta_lead=true).
- Se o lead disser claramente que não tem interesse → conversa_encerrada=true.
- Se detectar urgência/interesse forte → alerta_lead=true com motivo curto.

SEMPRE responda no formato JSON definido no schema.`;
}

function montarUserPrompt(contact: { name?: string; phone?: string }, historico: any[], keywordMatch: boolean): string {
  const nomeContato = contact.name || 'Contato';
  const transcricao = historico.map(m => {
    const who = m.from_me ? 'EQUIPE' : nomeContato.toUpperCase();
    const mediaTag = m.message_type && m.message_type !== 'text' ? ` [${m.message_type}]` : '';
    return `${who}${mediaTag}: ${m.text || '(sem texto)'}`;
  }).join('\n');

  const warnKeyword = keywordMatch
    ? '\n\n[ALERTA INTERNO: detectamos palavra-chave de handoff na última msg do lead. Considere alerta_lead=true e NÃO responda sobre valores.]'
    : '';

  return `Conversa entre a EQUIPE (nós) e o lead (${nomeContato}):

${transcricao}
${warnKeyword}

Responda APENAS à última mensagem do lead, seguindo o objetivo e regras do sistema. Devolva o JSON.`;
}

async function enviarMensagensIA(supabase: any, phone: string, messages: string[], chipIdHandoff?: string) {
  // Busca Evolution config
  const { data: evoConfig } = await supabase
    .from('config_global')
    .select('evolution_base_url, evolution_api_key')
    .limit(1).single();

  const evoUrl = evoConfig?.evolution_base_url?.replace(/\/+$/, '');
  const evoKey = evoConfig?.evolution_api_key;
  if (!evoUrl || !evoKey) return;

  // Busca chip ativo (preferência: handoff_numero_chip senão qualquer ativo)
  let instancia;
  if (chipIdHandoff) {
    const { data } = await supabase
      .from('instancias_whatsapp')
      .select('nome_instancia')
      .eq('id', chipIdHandoff).maybeSingle();
    instancia = data;
  }
  if (!instancia) {
    const { data } = await supabase
      .from('instancias_whatsapp')
      .select('nome_instancia')
      .in('status', ['conectada', 'ativa', 'open'])
      .limit(1).maybeSingle();
    instancia = data;
  }
  if (!instancia?.nome_instancia) return;

  const normalized = normalizeBrazilianPhone(phone);
  if (!normalized) return;

  for (let i = 0; i < messages.length; i++) {
    const txt = messages[i].trim();
    if (!txt) continue;

    // "Digitando" presence
    try {
      await fetch(`${evoUrl}/chat/sendPresence/${encodeURIComponent(instancia.nome_instancia)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: evoKey },
        body: JSON.stringify({ number: normalized, presence: 'composing', delay: Math.min(4000, Math.max(1500, txt.length * 50)) }),
      });
    } catch { /* ignore */ }

    await sleep(Math.min(4000, Math.max(1500, txt.length * 50)));

    try {
      await fetch(`${evoUrl}/message/sendText/${encodeURIComponent(instancia.nome_instancia)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: evoKey },
        body: JSON.stringify({ number: normalized, text: txt }),
      });
    } catch (err) {
      console.error('[ia-responder] falha enviar msg:', err);
    }

    if (i < messages.length - 1) await sleep(1500 + Math.random() * 1500);
  }
}

async function notificarHandoff(
  supabase: any,
  briefing: BriefingIA,
  contact: { name?: string; phone?: string },
  camp: { mensagem?: string },
  motivo: string,
  detectouKeyword: boolean,
  textoUltima: string,
) {
  if (!briefing.handoff_telefone) return;

  const { data: evoConfig } = await supabase
    .from('config_global')
    .select('evolution_base_url, evolution_api_key')
    .limit(1).single();

  const evoUrl = evoConfig?.evolution_base_url?.replace(/\/+$/, '');
  const evoKey = evoConfig?.evolution_api_key;
  if (!evoUrl || !evoKey) return;

  // Instância pra enviar o handoff
  const chipId = briefing.handoff_numero_chip;
  let instancia;
  if (chipId) {
    const { data } = await supabase.from('instancias_whatsapp')
      .select('nome_instancia').eq('id', chipId).maybeSingle();
    instancia = data;
  }
  if (!instancia) {
    const { data } = await supabase.from('instancias_whatsapp')
      .select('nome_instancia').in('status', ['conectada', 'ativa', 'open']).limit(1).maybeSingle();
    instancia = data;
  }
  if (!instancia?.nome_instancia) return;

  const destino = normalizeBrazilianPhone(briefing.handoff_telefone);
  if (!destino) return;

  const texto = `🔔 *Lead quente pra falar*
Nome: ${contact.name || '(sem nome)'}
Telefone: ${contact.phone || '?'}
Motivo: ${detectouKeyword ? 'Pediu informação sobre valor/remuneração' : motivo}
Última msg: "${textoUltima.slice(0, 120)}"`;

  try {
    await fetch(`${evoUrl}/message/sendText/${encodeURIComponent(instancia.nome_instancia)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: evoKey },
      body: JSON.stringify({ number: destino, text: texto }),
    });
  } catch (err) {
    console.error('[ia-responder] erro handoff:', err);
  }
}

function normalizeBrazilianPhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length > 11) digits = digits.slice(2);
  if (digits.length < 10 || digits.length > 11) return null;
  if (digits.length === 10) {
    const d = parseInt(digits[2], 10);
    if (d >= 6) digits = digits.slice(0, 2) + '9' + digits.slice(2);
  }
  return '55' + digits;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function json(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
