"""Gera workflow n8n 'Consultório — IA Pacientes' adaptado pra Evolution + Supabase.

Baseado em '🏥 WhatsApp - Pacientes (Dr. Maikon).json' mas com:
- Webhook recebe payload Evolution (não Z-API)
- Debounce 60s via tabela consultorio_fila_msgs
- Owner pattern (última msg do phone)
- Whisper (áudio) + Vision (imagem) via OpenAI
- AI Agent com OpenAI + Buffer Window Memory (mantém prompt original de 12k chars)
- Envia resposta via Evolution API
- Salva histórico em consultorio_historico
- Se DISPARAR_ALERTA=true → alerta WA pros telefones configurados
- Se PRECISA_MAIKON=true → salva dúvida em consultorio_duvidas

Features deferidas pra V2 (triagem menu, checklist, reformulação, etc).
"""
import json, os, sys

sys.stdout.reconfigure(encoding='utf-8')

ROOT = 'C:/Users/rauls/crm-gestao-madeira'
with open(f'{ROOT}/scripts/consultorio_prompt.txt', encoding='utf-8') as f:
    SYSTEM_PROMPT = f.read()

# Config (valores que o workflow injeta como env vars ou literais)
# NÃO commita keys — só valores não-secretos
INSTANCE_NAME = 'Consultorio'
WEBHOOK_PATH = 'consultorio-pacientes'
# Handoff alert recipients
ALERTA_MAIKON = '554792153480'  # Dr. Maikon
ALERTA_ISADORA = '554799486377'
ALERTA_RAUL = '5554984351512'

wf = {
    'id': 'consultorioIaPacientesV1',
    'name': 'Consultório — IA Pacientes',
    'nodes': [],
    'connections': {},
    'settings': {'executionOrder': 'v1'},
}

def add_node(name, type_, type_version, position, parameters, **extra):
    node = {
        'parameters': parameters,
        'id': f'node-{name.lower().replace(" ", "-").replace("?", "").replace(":", "").replace("/", "-")}',
        'name': name,
        'type': type_,
        'typeVersion': type_version,
        'position': list(position),
    }
    node.update(extra)
    wf['nodes'].append(node)
    return node

def connect(src, dst, src_idx=0):
    wf['connections'].setdefault(src, {'main': [[] for _ in range(max(1, src_idx + 1))]})
    while len(wf['connections'][src]['main']) <= src_idx:
        wf['connections'][src]['main'].append([])
    wf['connections'][src]['main'][src_idx].append({'node': dst, 'type': 'main', 'index': 0})

# ============ Nodes ============

# 1. Webhook — recebe payload Evolution
add_node(
    'Webhook', 'n8n-nodes-base.webhook', 2, [0, 0],
    {
        'httpMethod': 'POST',
        'path': WEBHOOK_PATH,
        'responseMode': 'onReceived',
        'options': {},
    },
    webhookId='consultorio-pacientes-webhook'
)

# 2. Normalizar payload — Evolution → formato interno
NORMALIZAR_CODE = r'''// Extrai dados da msg do payload Evolution (messages.upsert)
const body = $json.body || $json || {};
const event = body.event || '';
const data = body.data || {};

// Só processa messages.upsert
if (event !== 'messages.upsert' && event !== 'MESSAGES_UPSERT') {
  return [{ json: { skip: true, reason: 'evento não é messages.upsert', event } }];
}

const key = data.key || {};
const rawRemoteJid = key.remoteJid || '';
const fromMe = !!key.fromMe;
const msgId = key.id || ('id_' + Date.now() + '_' + Math.random().toString(36).slice(2));

// Ignora grupos
if (!rawRemoteJid || rawRemoteJid.includes('@g.us')) {
  return [{ json: { skip: true, reason: 'grupo' } }];
}

// Suporte a @lid (Linked Device IDs do WhatsApp moderno):
// Se remoteJid é @lid, resolve via key.remoteJidAlt (que tem o phone real
// como @s.whatsapp.net). Sem isso, msgs novas ficam ignoradas porque o
// WhatsApp passou a usar @lid em maioria dos pacientes.
const isLid = rawRemoteJid.endsWith('@lid');
const remoteJidAlt = (key.remoteJidAlt || '').trim();
const remoteJid = (isLid && remoteJidAlt) ? remoteJidAlt : rawRemoteJid;

if (isLid && !remoteJidAlt) {
  return [{ json: { skip: true, reason: 'lid sem remoteJidAlt' } }];
}

const phone = remoteJid.replace('@s.whatsapp.net', '');

// Tipo de msg
const m = data.message || {};
let msgType = 'text';
let msgText = '';
let mediaUrl = '';
let mediaBase64 = '';
let mediaMime = '';

if (m.conversation) { msgType = 'text'; msgText = m.conversation; }
else if (m.extendedTextMessage?.text) { msgType = 'text'; msgText = m.extendedTextMessage.text; }
else if (m.imageMessage) { msgType = 'image'; mediaUrl = m.imageMessage.url || ''; mediaBase64 = m.imageMessage.base64 || ''; mediaMime = m.imageMessage.mimetype || 'image/jpeg'; msgText = m.imageMessage.caption || ''; }
else if (m.audioMessage) { msgType = 'audio'; mediaUrl = m.audioMessage.url || ''; mediaBase64 = m.audioMessage.base64 || ''; mediaMime = m.audioMessage.mimetype || 'audio/ogg'; }
else if (m.videoMessage) { msgType = 'video'; mediaUrl = m.videoMessage.url || ''; msgText = m.videoMessage.caption || ''; }
else if (m.documentMessage) { msgType = 'document'; mediaUrl = m.documentMessage.url || ''; msgText = m.documentMessage.fileName || ''; }
else { msgType = 'unknown'; }

// Ignora msgs do próprio chip (fromMe=true) — agente não responde a si mesmo
if (fromMe) {
  return [{ json: { skip: true, reason: 'fromMe=true', phone, msgId } }];
}

return [{
  json: {
    skip: false,
    phone,
    remoteJid,
    msgId,
    fromMe,
    msgType,
    msgText,
    mediaUrl,
    mediaBase64,
    mediaMime,
    pushName: data.pushName || '',
    instanceName: body.instance || 'Consultorio',
    timestamp: Date.now(),
  }
}];
'''
add_node(
    'Normalizar payload', 'n8n-nodes-base.code', 2, [220, 0],
    {'jsCode': NORMALIZAR_CODE}
)
connect('Webhook', 'Normalizar payload')

# 3. Skip se inválido
add_node(
    'Processar?', 'n8n-nodes-base.if', 2, [440, 0],
    {
        'conditions': {
            'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'strict', 'version': 2},
            'combinator': 'and',
            'conditions': [{
                'id': 'cond-skip',
                'leftValue': '={{ $json.skip }}',
                'rightValue': False,
                'operator': {'type': 'boolean', 'operation': 'equals'}
            }]
        },
        'options': {}
    }
)
connect('Normalizar payload', 'Processar?')

# 4. Enfileira msg em consultorio_fila_msgs
add_node(
    'Enfileira em fila', 'n8n-nodes-base.httpRequest', 4.2, [660, -80],
    {
        'method': 'POST',
        'url': '={{ $env.SUPABASE_URL }}/rest/v1/consultorio_fila_msgs',
        'sendBody': True,
        'specifyBody': 'json',
        'jsonBody': '={{ JSON.stringify({ phone: $json.phone, text: $json.msgText, message_type: $json.msgType, media_url: $json.mediaUrl }) }}',
        'sendHeaders': True,
        'headerParameters': {
            'parameters': [
                {'name': 'apikey', 'value': '={{ $env.SUPABASE_SERVICE_ROLE_KEY }}'},
                {'name': 'Authorization', 'value': '=Bearer {{ $env.SUPABASE_SERVICE_ROLE_KEY }}'},
                {'name': 'Content-Type', 'value': 'application/json'},
                {'name': 'Prefer', 'value': 'return=representation'},
            ]
        },
        'options': {}
    }
)
connect('Processar?', 'Enfileira em fila', 0)

# 5. Guarda queue_msg_id (pro owner check depois)
GUARDAR_QUEUE_ID_CODE = '''// Guarda id da msg enfileirada pra owner check depois
const enfileirado = Array.isArray($json) ? $json[0] : $json;
const normalizado = $('Normalizar payload').item.json;
return [{
  json: {
    ...normalizado,
    queue_msg_id: enfileirado.id,
    queued_at: enfileirado.created_at,
  }
}];
'''
add_node(
    'Guardar queue_msg_id', 'n8n-nodes-base.code', 2, [880, -80],
    {'jsCode': GUARDAR_QUEUE_ID_CODE}
)
connect('Enfileira em fila', 'Guardar queue_msg_id')

# 6. Wait 60s (debounce)
add_node(
    'Wait 60s (debounce)', 'n8n-nodes-base.wait', 1.1, [1100, -80],
    {'amount': 60, 'unit': 'seconds'}
)
connect('Guardar queue_msg_id', 'Wait 60s (debounce)')

# 7. Busca última msg do phone (pra saber se ainda sou o dono)
add_node(
    'Buscar última msg do phone', 'n8n-nodes-base.httpRequest', 4.2, [1320, -80],
    {
        'method': 'GET',
        'url': "={{ $env.SUPABASE_URL }}/rest/v1/consultorio_fila_msgs?phone=eq.{{ $json.phone }}&select=id,text,message_type,media_url,created_at&order=created_at.asc",
        'sendHeaders': True,
        'headerParameters': {
            'parameters': [
                {'name': 'apikey', 'value': '={{ $env.SUPABASE_SERVICE_ROLE_KEY }}'},
                {'name': 'Authorization', 'value': '=Bearer {{ $env.SUPABASE_SERVICE_ROLE_KEY }}'},
            ]
        },
        'options': {}
    }
)
connect('Wait 60s (debounce)', 'Buscar última msg do phone')

# 8. Owner check + consolida msgs
OWNER_CHECK_CODE = r'''// Sou o dono? Sim = a msg enfileirada é a última (ou não há mais recente).
// Agrego texto de todas msgs na fila pra passar pro agente.
const payload = $('Guardar queue_msg_id').item.json;
const rows = Array.isArray($json) ? $json : [];

if (!rows || rows.length === 0) {
  return [{ json: { ...payload, skip: true, reason: 'fila vazia após wait' } }];
}

// Última msg (já ordenada ASC, pega a última)
const last = rows[rows.length - 1];
if (last.id !== payload.queue_msg_id) {
  return [{ json: { ...payload, skip: true, reason: 'não sou o dono, outra msg chegou' } }];
}

// Agrega texto das msgs (pela ordem ASC)
const textos = rows
  .map(r => (r.text || '').trim())
  .filter(t => t && t !== '📷 Imagem' && t !== '🎤 Áudio')
  .join('\n');

// Tipo da última msg
const lastType = last.message_type || 'text';
const lastMedia = last.media_url || '';

return [{
  json: {
    ...payload,
    skip: false,
    aggregated_text: textos || '',
    last_msg_type: lastType,
    last_media_url: lastMedia,
    queue_rows_count: rows.length,
  }
}];
'''
add_node(
    'Owner check', 'n8n-nodes-base.code', 2, [1540, -80],
    {'jsCode': OWNER_CHECK_CODE}
)
connect('Buscar última msg do phone', 'Owner check')

# 9. Sou dono?
add_node(
    'Sou dono?', 'n8n-nodes-base.if', 2, [1760, -80],
    {
        'conditions': {
            'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'strict', 'version': 2},
            'combinator': 'and',
            'conditions': [{
                'id': 'cond-owner',
                'leftValue': '={{ $json.skip }}',
                'rightValue': False,
                'operator': {'type': 'boolean', 'operation': 'equals'}
            }]
        },
        'options': {}
    }
)
connect('Owner check', 'Sou dono?')

# 10. Whisper (se áudio) — usa mediaBase64 se presente, senão download via URL
WHISPER_CODE = r'''// Transcreve áudio via OpenAI Whisper. Roda só se msg é áudio.
const payload = $json;
if (payload.last_msg_type !== 'audio') {
  return [{ json: { ...payload, transcricao: '' } }];
}

const openaiKey = $env.OPENAI_API_KEY;
if (!openaiKey) {
  return [{ json: { ...payload, transcricao: '[Whisper: OPENAI_API_KEY ausente]' } }];
}

// Se tem base64, usa. Senão tenta download da URL.
let audioBytes;
if (payload.mediaBase64) {
  audioBytes = Uint8Array.from(atob(payload.mediaBase64), c => c.charCodeAt(0));
} else if (payload.last_media_url || payload.mediaUrl) {
  const r = await fetch(payload.last_media_url || payload.mediaUrl);
  if (!r.ok) return [{ json: { ...payload, transcricao: '[Whisper: falha download]' } }];
  audioBytes = new Uint8Array(await r.arrayBuffer());
} else {
  return [{ json: { ...payload, transcricao: '[Whisper: sem áudio]' } }];
}

const blob = new Blob([audioBytes], { type: payload.mediaMime || 'audio/ogg' });
const form = new FormData();
form.append('file', blob, 'audio.ogg');
form.append('model', 'whisper-1');
form.append('language', 'pt');

const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + openaiKey },
  body: form,
});
if (!r.ok) {
  const t = await r.text().catch(() => '');
  return [{ json: { ...payload, transcricao: '[Whisper erro: ' + r.status + ']' } }];
}
const j = await r.json();
return [{ json: { ...payload, transcricao: j.text || '' } }];
'''
add_node(
    'Whisper', 'n8n-nodes-base.code', 2, [1980, -150],
    {'jsCode': WHISPER_CODE}
)
connect('Sou dono?', 'Whisper', 0)

# 11. Vision (se imagem)
VISION_CODE = r'''// Descreve imagem via Gemini Vision. Roda depois do Whisper (pass-through se não é imagem).
const payload = $json;
if (payload.last_msg_type !== 'image') {
  return [{ json: { ...payload, analise_imagem: '' } }];
}

const geminiKey = $env.GEMINI_API_KEY;
if (!geminiKey) {
  return [{ json: { ...payload, analise_imagem: '[Vision: GEMINI_API_KEY ausente]' } }];
}

const mime = payload.mediaMime || 'image/jpeg';
let b64 = payload.mediaBase64 || '';
if (!b64 && (payload.last_media_url || payload.mediaUrl)) {
  const r = await fetch(payload.last_media_url || payload.mediaUrl);
  if (!r.ok) return [{ json: { ...payload, analise_imagem: '[Vision: falha download]' } }];
  const bytes = new Uint8Array(await r.arrayBuffer());
  b64 = btoa(String.fromCharCode(...bytes));
}
if (!b64) return [{ json: { ...payload, analise_imagem: '[Vision: sem imagem]' } }];

const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
  body: JSON.stringify({
    contents: [{
      role: 'user',
      parts: [
        { text: 'Descreva essa imagem em português, de forma objetiva, em 1-2 frases. Se for documento médico, ferida, medicamento, receita ou exame, extraia dados visíveis (números, nomes, valores).' },
        { inline_data: { mime_type: mime, data: b64 } }
      ]
    }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 300 }
  })
});
if (!r.ok) return [{ json: { ...payload, analise_imagem: '[Vision erro: ' + r.status + ']' } }];
const j = await r.json();
const desc = j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
return [{ json: { ...payload, analise_imagem: desc } }];
'''
add_node(
    'Vision', 'n8n-nodes-base.code', 2, [2200, -150],
    {'jsCode': VISION_CODE}
)
connect('Whisper', 'Vision')

# 12. Buscar histórico do phone (últimas 20 msgs)
add_node(
    'Buscar histórico', 'n8n-nodes-base.httpRequest', 4.2, [2420, -150],
    {
        'method': 'GET',
        'url': "={{ $env.SUPABASE_URL }}/rest/v1/consultorio_historico?phone=eq.{{ $json.phone }}&select=role,text,created_at&order=created_at.desc&limit=20",
        'sendHeaders': True,
        'headerParameters': {
            'parameters': [
                {'name': 'apikey', 'value': '={{ $env.SUPABASE_SERVICE_ROLE_KEY }}'},
                {'name': 'Authorization', 'value': '=Bearer {{ $env.SUPABASE_SERVICE_ROLE_KEY }}'},
            ]
        },
        'options': {}
    },
    alwaysOutputData=True
)
connect('Vision', 'Buscar histórico')

# 13. Montar prompt Gemini completo
SYSTEM_PROMPT_JS = SYSTEM_PROMPT.replace('\\', '\\\\').replace('`', '\\`').replace('$', '\\$')
MONTAR_PROMPT_CODE = '''// Monta prompt completo pro Gemini com system (prompt original do Dr. Maikon) + histórico + msg atual.
const payload = $("Vision").item.json;
const histRaw = Array.isArray($json) ? $json : (Array.isArray($input?.all?.()) ? $input.all().map(i => i.json).filter(x => x?.text !== undefined) : []);
const hist = histRaw.slice().reverse();

const systemPrompt = `''' + SYSTEM_PROMPT_JS + '''`;

// Monta conversa consolidada
let finalMsg = payload.aggregated_text || payload.msgText || '';
if (payload.transcricao) {
  finalMsg = '[Áudio transcrito]: ' + payload.transcricao + (finalMsg ? '\\n' + finalMsg : '');
}
if (payload.analise_imagem) {
  finalMsg += '\\n[Análise de imagem]: ' + payload.analise_imagem;
}

const histText = hist.map(h => {
  const who = h.role === 'paciente' ? 'PACIENTE' : (h.role === 'ia' ? 'VOCÊ (resposta anterior)' : 'SISTEMA');
  return who + ': ' + h.text;
}).join('\\n');

const userPrompt = '## HISTÓRICO RECENTE DA CONVERSA (mais antigo primeiro)\\n' +
  (histText || '(sem histórico)') +
  '\\n\\n## MENSAGEM ATUAL DO PACIENTE\\n' +
  finalMsg +
  '\\n\\n## SEU JOB\\n' +
  'Responda APENAS à mensagem atual. Retorne JSON:\\n' +
  '{"messages": ["msg1", "msg2"], "DISPARAR_ALERTA": false, "alerta_resumo": "", "PRECISA_MAIKON": false, "duvida_maikon": ""}\\n\\n' +
  'REGRAS:\\n' +
  '- "messages" é array de 1-3 msgs curtas (cada uma vira msg separada com delay humano entre elas)\\n' +
  '- Siga os protocolos clínicos do system prompt À RISCA\\n' +
  '- NUNCA responda em JSON livre sem os campos acima';

return [{ json: {
  ...payload,
  _finalMsg: finalMsg,
  _histCount: hist.length,
  _gemini_body: {
    contents: [{ role: 'user', parts: [{ text: systemPrompt + '\\n\\n---\\n\\n' + userPrompt }] }],
    generationConfig: {
      temperature: 0.6,
      topP: 0.9,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          messages: { type: 'ARRAY', items: { type: 'STRING' } },
          DISPARAR_ALERTA: { type: 'BOOLEAN' },
          alerta_resumo: { type: 'STRING' },
          PRECISA_MAIKON: { type: 'BOOLEAN' },
          duvida_maikon: { type: 'STRING' }
        },
        required: ['messages','DISPARAR_ALERTA','alerta_resumo','PRECISA_MAIKON','duvida_maikon']
      }
    }
  }
} }];
'''
add_node(
    'Montar prompt', 'n8n-nodes-base.code', 2, [2640, -150],
    {'jsCode': MONTAR_PROMPT_CODE}
)
connect('Buscar histórico', 'Montar prompt')

# 14. Chamar Gemini
add_node(
    'Chamar Gemini', 'n8n-nodes-base.httpRequest', 4.2, [2860, -150],
    {
        'method': 'POST',
        'url': 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        'sendBody': True,
        'specifyBody': 'json',
        'jsonBody': '={{ JSON.stringify($json._gemini_body) }}',
        'sendHeaders': True,
        'headerParameters': {
            'parameters': [
                {'name': 'Content-Type', 'value': 'application/json'},
                {'name': 'x-goog-api-key', 'value': '={{ $env.GEMINI_API_KEY }}'},
            ]
        },
        'options': {'timeout': 60000}
    }
)
connect('Montar prompt', 'Chamar Gemini')

# 15. Parse resposta
PARSE_CODE = r'''// Parse response Gemini
const payload = $('Montar prompt').item.json;
const raw = $json;
const text = raw?.candidates?.[0]?.content?.parts?.[0]?.text || '';

let parsed;
try {
  const clean = text.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  parsed = JSON.parse(clean);
} catch (e) {
  return [{ json: { ...payload, erro: 'JSON inválido Gemini', raw: text.slice(0, 300) } }];
}

return [{
  json: {
    ...payload,
    ia_messages: Array.isArray(parsed.messages) && parsed.messages.length ? parsed.messages : ['Desculpe, não consegui processar. Vou verificar com o Dr. Maikon.'],
    DISPARAR_ALERTA: !!parsed.DISPARAR_ALERTA,
    alerta_resumo: parsed.alerta_resumo || '',
    PRECISA_MAIKON: !!parsed.PRECISA_MAIKON,
    duvida_maikon: parsed.duvida_maikon || '',
  }
}];
'''
add_node(
    'Parse resposta', 'n8n-nodes-base.code', 2, [3080, -150],
    {'jsCode': PARSE_CODE}
)
connect('Chamar Gemini', 'Parse resposta')

# 16. Enviar msgs IA + alertas + salvar histórico
ENVIAR_CODE = (
    '// Envia msgs IA com typing+delay, dispara alertas se preciso, salva histórico.\n'
    'const p = $json;\n'
    'const evoBase = $env.EVOLUTION_API_URL;\n'
    'const evoKey = $env.EVOLUTION_API_KEY;\n'
    f"const instance = p.instanceName || '{INSTANCE_NAME}';\n"
    'const httpRequest = this.helpers.httpRequest.bind(this.helpers);\n'
    '\n'
    'function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }\n'
    '\n'
    'async function evo(path, body) {\n'
    '  try {\n'
    '    const resp = await httpRequest({\n'
    "      method: 'POST', url: evoBase + path,\n"
    "      headers: { 'Content-Type': 'application/json', apikey: evoKey },\n"
    '      body, json: true, returnFullResponse: true, timeout: 15000,\n'
    '    });\n'
    '    return { ok: resp.statusCode >= 200 && resp.statusCode < 300, status: resp.statusCode, body: resp.body };\n'
    "  } catch (e) { return { ok: false, err: String(e && e.message || e).slice(0, 200) }; }\n"
    '}\n'
    '\n'
    'const phone = p.phone;\n'
    'const msgs = p.ia_messages || [];\n'
    'const resultados = [];\n'
    '\n'
    'for (let i = 0; i < msgs.length; i++) {\n'
    '  const txt = msgs[i];\n'
    '  if (!txt) continue;\n'
    '  const delay = Math.max(1500, Math.min(4500, txt.length * 60));\n'
    "  await evo('/chat/sendPresence/' + encodeURIComponent(instance), { number: phone, presence: 'composing', delay });\n"
    '  await sleep(delay);\n'
    "  const r = await evo('/message/sendText/' + encodeURIComponent(instance), { number: phone, text: txt });\n"
    "  resultados.push({ to: 'paciente', text: txt, ok: r.ok, status: r.status });\n"
    '  if (i < msgs.length - 1) await sleep(900 + Math.random() * 1500);\n'
    '}\n'
    '\n'
    '// Alerta urgente (DISPARAR_ALERTA) → Dr Maikon + Isadora + Raul\n'
    'let alerta_enviado = false;\n'
    'if (p.DISPARAR_ALERTA) {\n'
    "  const alertaTxt = '🚨 *ALERTA PACIENTE PÓS-OP*\\n\\n' +\n"
    "    'Telefone: ' + p.phone + '\\n' +\n"
    "    'Nome: ' + (p.pushName || '(não informado)') + '\\n\\n' +\n"
    "    'Resumo: ' + (p.alerta_resumo || 'sem resumo') + '\\n\\n' +\n"
    "    'Última msg do paciente: \"' + ((p.aggregated_text || '').slice(0, 200)) + '\"';\n"
    f"  for (const destino of ['{ALERTA_MAIKON}', '{ALERTA_ISADORA}', '{ALERTA_RAUL}']) {{\n"
    '    if (destino === phone) continue;\n'
    "    const rA = await evo('/message/sendText/' + encodeURIComponent(instance), { number: destino, text: alertaTxt });\n"
    "    resultados.push({ to: 'alerta', destino, ok: rA.ok });\n"
    '    if (rA.ok) alerta_enviado = true;\n'
    '    await sleep(600);\n'
    '  }\n'
    '}\n'
    '\n'
    '// Dúvida pro Maikon (PRECISA_MAIKON)\n'
    'let duvida_salva = false;\n'
    'if (p.PRECISA_MAIKON && p.duvida_maikon) {\n'
    '  try {\n'
    '    const supaUrl = $env.SUPABASE_URL;\n'
    '    const supaKey = $env.SUPABASE_SERVICE_ROLE_KEY;\n'
    "    const refChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';\n"
    "    let ref = '';\n"
    '    for (let i = 0; i < 4; i++) ref += refChars[Math.floor(Math.random() * refChars.length)];\n'
    '\n'
    '    await httpRequest({\n'
    "      method: 'POST', url: supaUrl + '/rest/v1/consultorio_duvidas',\n"
    "      headers: { apikey: supaKey, Authorization: 'Bearer ' + supaKey, 'Content-Type': 'application/json', Prefer: 'return=minimal' },\n"
    "      body: { phone, nome_paciente: p.pushName || null, pergunta: p.duvida_maikon, ref_id: ref, status: 'pendente' },\n"
    '      json: true,\n'
    '    });\n'
    '    duvida_salva = true;\n'
    "    resultados.push({ to: 'duvida_salva', ref });\n"
    '\n'
    "    const duvidaTxt = '❓ *Dúvida de paciente pós-op*\\n\\n' +\n"
    "      'Paciente: ' + (p.pushName || p.phone) + '\\n' +\n"
    "      'Ref: ' + ref + '\\n\\n' +\n"
    "      p.duvida_maikon + '\\n\\n' +\n"
    "      'Responda aqui mesmo com \"Ref ' + ref + ': <sua resposta>\" que eu repasso ao paciente.';\n"
    f"    await evo('/message/sendText/' + encodeURIComponent(instance), {{ number: '{ALERTA_MAIKON}', text: duvidaTxt }});\n"
    "  } catch (e) { resultados.push({ to: 'duvida_erro', err: String(e).slice(0, 200) }); }\n"
    '}\n'
    '\n'
    '// Salva histórico + limpa fila\n'
    'try {\n'
    '  const supaUrl = $env.SUPABASE_URL;\n'
    '  const supaKey = $env.SUPABASE_SERVICE_ROLE_KEY;\n'
    '  const histRows = [];\n'
    "  if (p._finalMsg) histRows.push({ phone, nome_paciente: p.pushName || null, role: 'paciente', text: p._finalMsg });\n"
    "  for (const m of msgs) histRows.push({ phone, nome_paciente: p.pushName || null, role: 'ia', text: m });\n"
    '  if (histRows.length) {\n'
    '    await httpRequest({\n'
    "      method: 'POST', url: supaUrl + '/rest/v1/consultorio_historico',\n"
    "      headers: { apikey: supaKey, Authorization: 'Bearer ' + supaKey, 'Content-Type': 'application/json', Prefer: 'return=minimal' },\n"
    '      body: histRows, json: true,\n'
    '    });\n'
    '  }\n'
    '  await httpRequest({\n'
    "    method: 'DELETE', url: supaUrl + '/rest/v1/consultorio_fila_msgs?phone=eq.' + encodeURIComponent(phone),\n"
    "    headers: { apikey: supaKey, Authorization: 'Bearer ' + supaKey, Prefer: 'return=minimal' },\n"
    '  });\n'
    "} catch (e) { resultados.push({ to: 'hist_erro', err: String(e).slice(0, 200) }); }\n"
    '\n'
    "return [{ json: { ...p, resultados, alerta_enviado, duvida_salva, total_enviadas: resultados.filter(r => r.to === 'paciente' && r.ok).length } }];\n"
)
add_node(
    'Enviar + alertas + histórico', 'n8n-nodes-base.code', 2, [3300, -150],
    {'jsCode': ENVIAR_CODE}
)
connect('Parse resposta', 'Enviar + alertas + histórico')

# Salvar JSON
out_path = f'{ROOT}/docs/n8n-workflows/consultorio-ia-pacientes.json'
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(wf, f, ensure_ascii=False, indent=2)
print(f'Workflow salvo em {out_path}')
print(f'Total nodes: {len(wf["nodes"])}')
