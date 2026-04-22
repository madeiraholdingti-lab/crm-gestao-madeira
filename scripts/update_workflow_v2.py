#!/usr/bin/env python3
"""Rewrite workflow: prompt ETAPA-style + multi-msg send + handoff notification."""
import json, sys
sys.stdout.reconfigure(encoding='utf-8')

path = 'C:/Users/rauls/crm-gestao-madeira/docs/n8n-workflows/maikonect-ia-responder-v2.json'
with open(path, encoding='utf-8') as f:
    wf = json.load(f)

NEW_PROMPT_CODE = r'''// Monta prompt Gemini no estilo sigma-new: XML tags estruturais, tom humano,
// engajamento proativo, anti-loop, anti-promessa, handoff restritivo.
// Adaptado pro Maikonect (genérico — serve qualquer tipo de campanha).

const envio = $('Validar IA ativa').item.json;
const rawMsgs = Array.isArray($json) ? $json : (Array.isArray($input?.all?.()) ? $input.all().map(i => i.json).filter(x => x?.text !== undefined) : []);
const msgs = rawMsgs.slice().reverse();

const b = envio.briefing || {};
const persona = b.persona || 'Você é da equipe do Dr. Maikon Madeira — cirurgião cardíaco em Itajaí/SC. Fala direto, sem formalidade, como colega. Nunca mencione que é IA, bot ou automação.';
const contexto = b.contexto || '';
const objetivo = b.objetivo || 'Qualificar o interesse do contato e escalar pra humano quando fizer sentido.';

function listBlock(titulo, arr, formatter) {
  if (!Array.isArray(arr) || arr.length === 0) return '';
  return `\n<${titulo}>\n${arr.map(formatter).join('\n')}\n</${titulo}>`;
}

const beneficios = listBlock('beneficios', b.beneficios || [], (x) => `- ${x}`);
const objecoes = listBlock('objecoes', b.objecoes || [], (o) => `- "${o.pergunta || o.objecao || ''}": ${o.resposta || ''}`);

const proibidasDefault = ['moderno', 'moderna', 'tecnologia de ponta', 'de ponta', 'oportunidade única', 'projeto revolucionário', 'ambiente incrível'];
const proibidasLista = [...new Set([
  ...(Array.isArray(b.palavras_proibidas) ? b.palavras_proibidas : []),
  ...proibidasDefault
])];

const fluxoPassos = Array.isArray(b.fluxo_passos) && b.fluxo_passos.length > 0
  ? b.fluxo_passos
  : ['Entender o contexto do contato (quem é, situação)', 'Apresentar o serviço/proposta de forma breve', 'Qualificar interesse', 'Encaminhar pra humano quando houver fit'];

const kws = Array.isArray(b.handoff_keywords) && b.handoff_keywords.length > 0
  ? b.handoff_keywords
  : ['salario','salário','valor','remuneração','remuneracao','quanto paga','quanto custa','preço','preco'];

const handoffNome = b.handoff_nome || 'a equipe';
const handoffFrase = b.handoff_frase || 'vai te passar os detalhes.';

const checklistMinimo = Number.isInteger(b.checklist_handoff_minimo) ? b.checklist_handoff_minimo : 3;

const infoExtra = typeof b.info_extra === 'string' && b.info_extra.trim() ? `\n<info_extra>\n${b.info_extra.trim()}\n</info_extra>` : '';

const ultimaDoLead = msgs.filter(m => !m.from_me).slice(-1)[0];
const textoUltima = (ultimaDoLead?.text || '').toLowerCase();
const keywordMatch = kws.some(k => textoUltima.includes(k.toLowerCase()));

// ------- SYSTEM PROMPT ----------
const systemPrompt = `<prompt versao="maikonect-v1">
<contexto>
${persona}
${contexto ? '\n' + contexto : ''}
</contexto>

<objetivo>
${objetivo}
</objetivo>

<naturalidade>
REGRAS DE FALA HUMANA — contatos percebem robô na hora:
- Aberturas variam: "oi", "opa", "e aí", "bacana", "boa". NUNCA "Olá!" ou "Olá, doutor!".
- SEM emoji estruturado, SEM markdown (negrito, itálico), SEM listas/bullets, SEM numeração.
- Pontuação humana e descontraída: vírgulas opcionais omitidas, abreviações naturais ok (vc, tb, pq, blz).
- Comprimento variado: ora 1 frase curta, ora 2 frases. Evite uniformidade. Evite parágrafos longos.
- Não cumprimente a cada mensagem. Conversa fluida não faz isso.
- Sem "espero ter ajudado", "fico à disposição", "qualquer dúvida estou aqui" — clichês de bot.
- Se contato fala curto, responde curto. Se elaborou, pode elaborar mais.
- Pode reagir com "show", "bacana", "legal" — com moderação.
</naturalidade>

<engajamento_proativo>
Quando o contato demonstrar curiosidade ("me conta mais", "como funciona", "onde é"), responde com FATO + PERGUNTA de aprofundamento. Não responda seco. Mas sem floreio vendedor.

Exemplo ruim: "É aqui em Itajaí"
Exemplo bom: "É aqui em Itajaí/SC, na clínica do Dr. Maikon. Você já conhecia o trabalho dele?"

Use SEMPRE que relevante (conforme a conversa evolui): fatos concretos do briefing, nome do serviço/evento, cidade, data, etc. Entregue o que pode engajar.
</engajamento_proativo>${beneficios}${objecoes}

<fluxo>
REGRA ABSOLUTA: Leia TODO o histórico. NUNCA repita pergunta já respondida.
"Sim" = passo concluído. Avance. 1 pergunta por vez.

Passos do fluxo (guia, não script fechado):
${fluxoPassos.map((p, i) => `${i+1}. ${p}`).join('\n')}
</fluxo>

<antes_de_handoff>
🛑 REGRA DURA — NÃO mencione "passar contato", "vou te passar pra ${handoffNome}" ou qualquer handoff ANTES de ter explicado o suficiente na conversa.

CHECKLIST mínimo de itens trocados na conversa ANTES de qualquer menção a handoff:
  □ Contato entendeu o que você está oferecendo
  □ Você confirmou se ele tem interesse ou fit
  □ Pelo menos 1 pergunta/fato concreto do briefing foi trocado
  □ Contato não demonstrou recusa

Se MENOS DE ${checklistMinimo} desses itens foram trocados, NÃO ofereça handoff. Continue explicando, perguntando, engajando.

EXCEÇÃO: se o contato disser literalmente "me liga", "me passa pro responsável", "quero fechar", "quem cuida disso pra eu falar" → handoff imediato é OK.
</antes_de_handoff>

<handoff>
QUANDO fazer handoff:
- Contato aceitou explicitamente conversar com humano
- Contato perguntou sobre valor/remuneração/preço (NÃO responde valor você mesmo)
- Contato demonstrou interesse forte e pediu próximos passos

COMO fazer:
- "Posso passar pra ${handoffNome}? ${handoffFrase}"
- Após confirmar: "Show, te chamam em breve."

NUNCA:
- Mandar "vou passar pra X" duas vezes em menos de 5 msgs
- Empurrar handoff se contato está explorando sem pedir
- Insistir se ignorou o pedido
</handoff>

<anti_promessa>
PALAVRAS PROIBIDAS: ${proibidasLista.map(p => `"${p}"`).join(', ')}

Substitua por fatos verificáveis. Se for usar adjetivo vendedor, CORTE.
Fale SÓ dos fatos do briefing: estrutura real, cidade real, dados reais.
</anti_promessa>

<anti_loop>
Antes de responder, leia TODO o histórico. Se o contato já informou algo, NÃO pergunte de novo. Avance.
Um "Sim" como resposta a pergunta sua = passo concluído. Registre e avance.
Se o contato mandou 2+ msgs ou uma msg com resposta + pergunta: extraia TUDO antes de responder.
</anti_loop>

<contato_dirige>
O CONTATO dirige a conversa. Seu fluxo é um guia.
- Se ele quer saber mais: responda em profundidade antes de voltar ao fluxo.
- Se faz pergunta técnica que você tem resposta no briefing: RESPONDA direto, não jogue pro handoff.
- Empurrar handoff cedo OU repetidamente → contato percebe pressa → lead perdido.
- Pressa é bot. Calma é humano.
</contato_dirige>${infoExtra}

<saida>
Retorne APENAS JSON válido:
{"messages":["msg1","msg2"],"alerta_lead":false,"motivo_alerta":"","conversa_encerrada":false}

- "messages": ARRAY de 1 a 2 mensagens curtas. Cada uma vira msg separada no WhatsApp. Se só uma resposta basta, um array com 1 elemento.
- "alerta_lead"=true APENAS quando: contato aceitou handoff OU perguntou sobre valor/remuneração/preço.
- "motivo_alerta": string curta descrevendo o porquê do alerta (ou vazia).
- "conversa_encerrada"=true quando: contato recusou ou pediu pra parar.
</saida>
</prompt>`;

const transcricao = msgs.map(m => {
  const who = m.from_me ? 'EQUIPE' : 'CONTATO';
  const tag = m.message_type && m.message_type !== 'text' ? ` [${m.message_type}]` : '';
  return `${who}${tag}: ${m.text || '(sem texto)'}`;
}).join('\n');

const warn = keywordMatch ? '\n\n[ALERTA: detectamos palavra-chave de handoff (valor/preço/salário) na última msg. Considere alerta_lead=true.]' : '';

const userPrompt = `## MENSAGEM INICIAL ENVIADA PELA CAMPANHA
"${envio.mensagem_inicial || '(não registrada)'}"

## HISTÓRICO DA CONVERSA (mais antigo primeiro)
${transcricao || '(sem histórico — essa é a primeira resposta do contato)'}${warn}

RESPONDA APENAS À ÚLTIMA MENSAGEM DO CONTATO. NÃO REPITA PERGUNTAS JÁ RESPONDIDAS. RETORNE O JSON.`;

return [{
  json: {
    ...envio,
    _prompt_system: systemPrompt,
    _prompt_user: userPrompt,
    _keyword_match: keywordMatch,
    _last_lead_text: ultimaDoLead?.text || '',
    _gemini_body: {
      contents: [
        { role: 'user', parts: [{ text: systemPrompt + '\n\n---\n\n' + userPrompt }] }
      ],
      generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            messages: { type: 'ARRAY', items: { type: 'STRING' } },
            alerta_lead: { type: 'BOOLEAN' },
            motivo_alerta: { type: 'STRING' },
            conversa_encerrada: { type: 'BOOLEAN' }
          },
          required: ['messages','alerta_lead','motivo_alerta','conversa_encerrada']
        }
      }
    }
  }
}];
'''

NEW_SEND_CODE = r'''// Envia TODAS as msgs da IA com presence+delay humanizado.
// Depois, se deve_fazer_handoff, manda alerta pro handoff_telefone configurado.
// Usa helpers.httpRequest do n8n (mais confiável que fetch em Code node).

const envio = $json;
if (envio.abortado) return [{ json: envio }];

// Lê do env do container n8n (injetado via docker service env)
const evoBase = $env.EVOLUTION_API_URL;
const evoKey = $env.EVOLUTION_API_KEY;
const instancia = envio.instancia_nome;
const phone = envio.phone_normalized;
const msgs = (envio.todas_msgs && envio.todas_msgs.length > 0) ? envio.todas_msgs : [envio.primeira_msg || 'Ok'];

// Captura helpers no scope de cima pra não perder contexto em nested funcs
const httpRequest = this.helpers.httpRequest.bind(this.helpers);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function evoCall(path, body) {
  try {
    const resp = await httpRequest({
      method: 'POST',
      url: `${evoBase}${path}`,
      headers: { 'Content-Type': 'application/json', 'apikey': evoKey },
      body,
      json: true,
      returnFullResponse: true,
      timeout: 15000,
    });
    return { ok: resp.statusCode >= 200 && resp.statusCode < 300, status: resp.statusCode, body: resp.body };
  } catch (e) {
    const msg = String(e && e.message || e).slice(0, 300);
    const status = e && e.statusCode;
    return { ok: false, err: msg, status };
  }
}

async function sendPresence(num, text) {
  const delay = Math.max(1500, Math.min(4500, text.length * 60));
  await evoCall(`/chat/sendPresence/${encodeURIComponent(instancia)}`, {
    number: num, presence: 'composing', delay
  });
  await sleep(delay);
}

async function sendText(num, text) {
  const r = await evoCall(`/message/sendText/${encodeURIComponent(instancia)}`, {
    number: num, text
  });
  return r;
}

const resultados = [];

for (let i = 0; i < msgs.length; i++) {
  const text = msgs[i];
  if (!text || typeof text !== 'string') continue;
  await sendPresence(phone, text);
  const r = await sendText(phone, text);
  resultados.push({ to: 'lead', text, ok: r.ok, status: r.status, err: r.err });
  if (i < msgs.length - 1) await sleep(900 + Math.random() * 1500);
}

let handoff_enviado = false;
let handoff_info = null;
if (envio.deve_fazer_handoff) {
  const briefing = envio.briefing || {};
  let handoffRaw = briefing.handoff_telefone || '';
  let d = (handoffRaw || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length > 11) d = d.slice(2);
  let handoffPhone = null;
  if (d.length === 10 || d.length === 11) {
    if (d.length === 10) {
      const c = parseInt(d[2], 10);
      if (c >= 6) d = d.slice(0, 2) + '9' + d.slice(2);
    }
    handoffPhone = '55' + d;
  }

  if (handoffPhone && handoffPhone !== phone) {
    const nomeCampanha = envio.campanha_nome || 'campanha';
    const motivo = envio.motivo_alerta || 'lead precisa de atenção';
    const txtAlerta = `🚨 *Lead pediu atenção — ${nomeCampanha}*\n\nTelefone: ${envio.telefone}\nMotivo: ${motivo}\n\nÚltima msg do lead: "${(envio._last_lead_text || '').slice(0, 200)}"\n\nAbra a conversa no CRM pra assumir.`;
    handoff_info = { phone: handoffPhone, text: txtAlerta };
    const rH = await sendText(handoffPhone, txtAlerta);
    resultados.push({ to: 'handoff', ok: rH.ok, phone: handoffPhone, status: rH.status, err: rH.err });
    handoff_enviado = rH.ok;
  } else {
    resultados.push({ to: 'handoff', skipped: true, reason: 'sem handoff_telefone válido no briefing' });
  }
}

return [{
  json: {
    ...envio,
    envio_resultados: resultados,
    total_enviadas: resultados.filter(r => r.to === 'lead' && r.ok).length,
    handoff_enviado,
    handoff_info,
  }
}];
'''

NEW_PARSE_CODE = r'''// Parse resposta Gemini (JSON estruturado via responseSchema)
const envio = $('Montar prompt Gemini').item.json;
const raw = $json;
const text = raw?.candidates?.[0]?.content?.parts?.[0]?.text || '';

let parsed;
try {
  const clean = text.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  parsed = JSON.parse(clean);
} catch (e) {
  return [{ json: { ...envio, erro: 'JSON inválido Gemini', raw: text.slice(0, 300) } }];
}

return [{
  json: {
    ...envio,
    ia_messages: Array.isArray(parsed.messages) && parsed.messages.length > 0 ? parsed.messages : ['Ok!'],
    alerta_lead: !!parsed.alerta_lead,
    motivo_alerta: parsed.motivo_alerta || '',
    conversa_encerrada: !!parsed.conversa_encerrada,
    deve_fazer_handoff: !!(envio._keyword_match || parsed.alerta_lead),
  }
}];
'''

for n in wf['nodes']:
    if n['name'] == 'Montar prompt Gemini':
        n['parameters']['jsCode'] = NEW_PROMPT_CODE
        print('[OK] Montar prompt Gemini')
    elif n['name'] == 'Parse resposta':
        n['parameters']['jsCode'] = NEW_PARSE_CODE
        print('[OK] Parse resposta')
    elif n['name'] == 'Chamar Gemini':
        n['parameters']['jsonBody'] = '={{ JSON.stringify($json._gemini_body) }}'
        n['parameters']['sendBody'] = True
        n['parameters']['specifyBody'] = 'json'
        print('[OK] Chamar Gemini body')

NODES_TO_REMOVE = {'Digitando...', 'Aguardar presence', 'Enviar msg IA', 'Enviar msgs + handoff'}
wf['nodes'] = [n for n in wf['nodes'] if n['name'] not in NODES_TO_REMOVE]

NEW_NODE = {
    'parameters': { 'jsCode': NEW_SEND_CODE },
    'id': 'node-send-multi',
    'name': 'Enviar msgs + handoff',
    'type': 'n8n-nodes-base.code',
    'typeVersion': 2,
    'position': [2940, 0]
}
wf['nodes'].append(NEW_NODE)

conns = wf['connections']
for k in list(conns.keys()):
    if k in NODES_TO_REMOVE:
        del conns[k]

conns['Definir instância'] = {
    'main': [[{'node': 'Enviar msgs + handoff', 'type': 'main', 'index': 0}]]
}
conns['Enviar msgs + handoff'] = {
    'main': [[{'node': 'Atualizar status envio', 'type': 'main', 'index': 0}]]
}

for n in wf['nodes']:
    if n['name'] == 'Atualizar status envio':
        n['parameters']['jsonBody'] = "={{ JSON.stringify({ status: $json.conversa_encerrada ? 'descartado' : $json.deve_fazer_handoff ? 'qualificado' : 'em_conversa', primeira_msg_contato_em: null }) }}"
        n['parameters']['url'] = '=https://yycpctrcefxemgahhxgx.supabase.co/rest/v1/campanha_envios?id=eq.{{ $json.envio_id }}'
        print('[OK] Atualizar status envio')
    elif n['name'] == 'Responder webhook':
        n['parameters']['responseBody'] = "={{ JSON.stringify({ ok: true, processado: $json.envio_id, status_final: $json.conversa_encerrada ? 'descartado' : $json.deve_fazer_handoff ? 'qualificado' : 'em_conversa', msgs_enviadas: $json.total_enviadas || 0, handoff: !!$json.handoff_enviado }) }}"
        print('[OK] Responder webhook')

with open(path, 'w', encoding='utf-8') as f:
    json.dump(wf, f, ensure_ascii=False, indent=2)

print()
print('Final node count:', len(wf['nodes']))
print('Done.')
