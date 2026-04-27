// consultorio-triagem — webhook do chip Consultório.
// Substitui a lógica de triagem que tentamos no n8n (frágil) por edge Deno.
//
// Fluxo:
//   1. Recebe webhook Evolution (messages.upsert)
//   2. Skip cedo: fromMe, grupo, evento errado
//   3. Resolve @lid via key.remoteJidAlt
//   4. Whisper inline se for áudio (pra detectar opção via texto)
//   5. Consulta consultorio_triagem (Supabase) pra estado atual
//   6. Decide destino:
//        - menu     → envia menu via Evolution + UPSERT triagem (status=menu_enviado)
//        - agente   → forward webhook pro n8n consultorioIaPacientesV1 (IA pós-op)
//        - secretaria → UPDATE opção + alerta Iza/Mariana via Evolution + confirma paciente
//        - encerrado → silêncio
//
// Configuração (chip Evolution Consultório):
//   webhook URL: https://yycpctrcefxemgahhxgx.supabase.co/functions/v1/consultorio-triagem
//   events: MESSAGES_UPSERT, CONNECTION_UPDATE
//
// Secrets necessárias:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (já configurados)
//   EVOLUTION_API_KEY, EVOLUTION_API_URL
//   OPENAI_API_KEY (Whisper)
//   N8N_CONSULTORIO_FORWARD_URL (default: webhook do consultorioIaPacientesV1)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const INSTANCE_NAME = 'Consultorio';
const TEL_IZA = '554799486377';
const TEL_MARIANA = '554788342543';
const N8N_CONSULTORIO_URL =
  Deno.env.get('N8N_CONSULTORIO_FORWARD_URL') ||
  'https://sdsd-n8n.r65ocn.easypanel.host/webhook/consultorio-pacientes';

const MENU_TEXTO =
  'Olá! 👋\n' +
  'Você entrou em contato com o consultório do Dr. Maikon Madeira.\n\n' +
  'Para te direcionar mais rapidamente, selecione abaixo a opção que melhor descreve o que você precisa:\n\n' +
  '1️⃣ Orientações e dúvidas sobre pré-operatório\n' +
  '2️⃣ Orientações sobre pós-operatório\n' +
  '3️⃣ Agendamento de consulta\n' +
  '4️⃣ Exames e prescrições';

const RESET_MS = 3 * 24 * 60 * 60 * 1000;
const LABELS: Record<string, string> = {
  '1': 'Pré-operatório',
  '3': 'Agendamento de consulta',
  '4': 'Exames e prescrições',
};

interface EvoData {
  key?: { id?: string; fromMe?: boolean; remoteJid?: string; remoteJidAlt?: string };
  pushName?: string;
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    audioMessage?: { base64?: string; mimetype?: string };
    pttMessage?: { base64?: string; mimetype?: string };
  };
  messageTimestamp?: number;
  instanceId?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const payload = await req.json().catch(() => ({}));
    const event = payload.body?.event || payload.event;
    const data: EvoData | undefined = payload.body?.data || payload.data;

    // Skip cedo: eventos que não nos interessam
    if (event !== 'messages.upsert' && event !== 'MESSAGES_UPSERT') {
      return jsonRes(200, { skipped: 'evento_nao_suportado', event });
    }
    if (!data?.key) return jsonRes(200, { skipped: 'sem_key' });
    if (data.key.fromMe) return jsonRes(200, { skipped: 'fromMe' });

    const rawJid = (data.key.remoteJid || '').trim();
    if (!rawJid || rawJid.includes('@g.us')) {
      return jsonRes(200, { skipped: 'grupo_ou_vazio' });
    }

    // Resolve @lid via remoteJidAlt
    const isLid = rawJid.endsWith('@lid');
    const altJid = (data.key.remoteJidAlt || '').trim();
    const resolvedJid = isLid && altJid ? altJid : rawJid;
    if (isLid && !altJid) {
      return jsonRes(200, { skipped: 'lid_sem_alt' });
    }

    const phone = resolvedJid.split('@')[0].replace(/\D/g, '');
    if (!phone) return jsonRes(200, { skipped: 'phone_vazio' });

    // Extrai texto + tipo
    let msgText = '';
    let msgType: 'text' | 'audio' | 'unknown' = 'unknown';
    if (data.message?.conversation) {
      msgText = data.message.conversation;
      msgType = 'text';
    } else if (data.message?.extendedTextMessage?.text) {
      msgText = data.message.extendedTextMessage.text;
      msgType = 'text';
    } else if (data.message?.audioMessage?.base64 || data.message?.pttMessage?.base64) {
      msgType = 'audio';
      const b64 = data.message.audioMessage?.base64 || data.message.pttMessage?.base64 || '';
      const mime = data.message.audioMessage?.mimetype || data.message.pttMessage?.mimetype || 'audio/ogg';
      msgText = await transcribeWhisper(b64, mime);
    }
    msgText = (msgText || '').trim();

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const evoUrl = Deno.env.get('EVOLUTION_API_URL') || 'https://sdsd-evolution-api.r65ocn.easypanel.host';
    const evoKey = Deno.env.get('EVOLUTION_API_KEY')!;
    const pushName = (data.pushName || '').trim();

    // === Decide destino ===
    const { data: triagemRow } = await supa
      .from('consultorio_triagem')
      .select('id, phone, status, opcao_escolhida, menu_enviado_em, updated_at, created_at, nome_paciente')
      .eq('phone', phone)
      .in('status', ['menu_enviado', 'ativo'])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const triagem = triagemRow as null | {
      id: string; phone: string; status: string; opcao_escolhida: string | null;
      menu_enviado_em: string | null; updated_at: string; created_at: string;
      nome_paciente: string | null;
    };

    const acao = decidirAcao(triagem, msgText, msgType);

    console.log(`[triagem] phone=${phone} acao=${acao.tipo} motivo=${acao.motivo || ''}`);

    if (acao.tipo === 'menu') {
      await sendEvolutionText(evoUrl, evoKey, INSTANCE_NAME, phone, MENU_TEXTO);
      await supa.from('consultorio_triagem').upsert(
        {
          phone,
          nome_paciente: pushName || triagem?.nome_paciente || null,
          status: 'menu_enviado',
          opcao_escolhida: null,
          menu_enviado_em: new Date().toISOString(),
        },
        { onConflict: 'phone' },
      );
      return jsonRes(200, { acao: 'menu', motivo: acao.motivo, phone });
    }

    if (acao.tipo === 'secretaria') {
      const opcao = acao.opcao!;
      const label = LABELS[opcao] || 'Não identificado';
      const nome = pushName || triagem?.nome_paciente || 'Paciente';

      // Atualiza triagem (PATCH)
      if (triagem) {
        await supa
          .from('consultorio_triagem')
          .update({
            opcao_escolhida: opcao,
            status: 'ativo',
            updated_at: new Date().toISOString(),
          })
          .eq('id', triagem.id);
      }

      const alerta =
        `📋 *Novo contato no consultório*\n\n` +
        `👤 Paciente: ${nome}\n` +
        `📞 Telefone: ${phone}\n` +
        `📌 Assunto: ${label}\n\n` +
        `💬 Mensagem: ${msgText}\n\n` +
        `Por favor, entre em contato com o paciente.`;

      // Alerta Iza + Mariana em paralelo
      await Promise.allSettled([
        sendEvolutionText(evoUrl, evoKey, INSTANCE_NAME, TEL_IZA, alerta),
        sendEvolutionText(evoUrl, evoKey, INSTANCE_NAME, TEL_MARIANA, alerta),
      ]);

      // Confirma pro paciente
      await sendEvolutionText(
        evoUrl,
        evoKey,
        INSTANCE_NAME,
        phone,
        'Perfeito! Nossa equipe vai entrar em contato com você em breve. 🙏',
      );

      return jsonRes(200, { acao: 'secretaria', opcao, label, phone });
    }

    if (acao.tipo === 'agente') {
      // Repassa pro n8n consultorioIaPacientesV1 sem alterar payload
      // (workflow já tem fix @lid + IA Gemini configurada)
      try {
        await fetch(N8N_CONSULTORIO_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload.body || payload),
        });
      } catch (e) {
        console.error('[triagem] forward n8n falhou:', e);
      }
      return jsonRes(200, { acao: 'agente', forward: 'n8n', phone });
    }

    // encerrado: silêncio
    return jsonRes(200, { acao: 'encerrado', motivo: acao.motivo, phone });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[consultorio-triagem] erro:', msg);
    return jsonRes(500, { error: msg });
  }
});

interface Acao {
  tipo: 'menu' | 'secretaria' | 'agente' | 'encerrado';
  motivo?: string;
  opcao?: string;
}

function decidirAcao(
  triagem: null | { status: string; opcao_escolhida: string | null; menu_enviado_em: string | null; updated_at: string; created_at: string },
  msgText: string,
  msgType: string,
): Acao {
  // Reset manual
  if (/^0$|^menu$|^voltar$|^in[ií]cio$/i.test(msgText)) {
    return { tipo: 'menu', motivo: 'reset_manual' };
  }

  // Reset por expiração (>3 dias)
  if (triagem) {
    const ts = triagem.menu_enviado_em || triagem.updated_at || triagem.created_at;
    if (ts && Date.now() - new Date(ts).getTime() > RESET_MS) {
      return { tipo: 'menu', motivo: 'expirado' };
    }
  }

  // Paciente novo
  if (!triagem) {
    return { tipo: 'menu', motivo: 'paciente_novo' };
  }

  // Já triada (status=ativo)
  if (triagem.status === 'ativo' && triagem.opcao_escolhida) {
    const op = String(triagem.opcao_escolhida);
    if (op === '2') return { tipo: 'agente', opcao: '2' };
    return { tipo: 'encerrado', motivo: 'ja_triada_humano' };
  }

  // Status menu_enviado: detectar opção
  if (msgType === 'audio') {
    return { tipo: 'encerrado', motivo: 'audio_sem_opcao_detectavel' };
  }

  let opcao = '';
  if (/\b1\b|^1$|1️⃣|pr[ée][\s.-]?operat|antes\s+da\s+cirurg/i.test(msgText)) opcao = '1';
  else if (/\b2\b|^2$|2️⃣|p[óo]s[\s.-]?operat|depois\s+da\s+cirurg/i.test(msgText)) opcao = '2';
  else if (/\b3\b|^3$|3️⃣|agend|consult|marcar/i.test(msgText)) opcao = '3';
  else if (/\b4\b|^4$|4️⃣|exam|prescri|receita|resultado/i.test(msgText)) opcao = '4';

  if (!opcao) {
    return { tipo: 'encerrado', motivo: 'opcao_nao_detectada' };
  }

  if (opcao === '2') return { tipo: 'agente', opcao: '2' };
  return { tipo: 'secretaria', opcao };
}

async function sendEvolutionText(
  evoUrl: string,
  evoKey: string,
  instance: string,
  number: string,
  text: string,
): Promise<void> {
  const r = await fetch(`${evoUrl}/message/sendText/${encodeURIComponent(instance)}`, {
    method: 'POST',
    headers: { apikey: evoKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ number, text }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    console.warn(`[evo] sendText ${number} falhou ${r.status}:`, txt.slice(0, 200));
  }
}

async function transcribeWhisper(b64: string, mimeType: string): Promise<string> {
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey || !b64) return '';
  try {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const blob = new Blob([bin], { type: mimeType });
    const form = new FormData();
    form.append('file', blob, 'audio.ogg');
    form.append('model', 'whisper-1');
    form.append('language', 'pt');
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
    });
    if (!r.ok) return '';
    const j = await r.json();
    return (j.text || '').trim();
  } catch {
    return '';
  }
}

function jsonRes(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
