// assistente-maikon-pessoal — agente conversacional pro WhatsApp pessoal do Maikon.
//
// Stack: Claude Sonnet 4.6 com Tool Use + prompt caching no system prompt.
// Tools em ./tools.ts (CRM read/write, agenda, memória).
//
// Fluxo:
//   1. Webhook Evolution chega (msg do Maikon no chip dedicado)
//   2. Whitelist: rejeita se não for número do Maikon
//   3. Whisper se for áudio (já temos)
//   4. Loop tool use: Claude → tool calls → executa → Claude de novo até stop
//   5. Resposta enviada via Evolution sendText (mesmo chip)
//   6. Audit log gravado
//
// Setup necessário (no Supabase secrets):
//   - ANTHROPIC_API_KEY
//   - ASSISTENTE_INSTANCE_NAME = nome da instância dedicada (ex: "Maikonect AI")
//   - ASSISTENTE_USER_ID = UUID do profile do Maikon
//   - ASSISTENTE_USER_PHONE = número whitelist (só dígitos, ex: "554792153480")
//
// O webhook deve ser configurado no Evolution apontando pra:
//   https://yycpctrcefxemgahhxgx.supabase.co/functions/v1/assistente-maikon-pessoal

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';
import { ALL_TOOLS, TOOL_SCHEMAS, TOOL_HANDLERS } from './tools.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MODEL = 'claude-sonnet-4-6';
const MAX_TOOL_ITERATIONS = 8;  // safety: evita loops infinitos
const MAX_TOKENS = 2048;

const SYSTEM_PROMPT = `Você é o assistente pessoal do Dr. Maikon Madeira — cirurgião cardiovascular em Itajaí/SC, fundador da GSS (Gestão de Serviços de Saúde) e do Maikonect (CRM próprio).

PERFIL DO MAIKON:
- Empresário-médico, opera cardiologia + gestão de clínicas
- Tem 2 secretárias: Iza (Isadora) e Mariana
- Direto, gosta de resposta curta e prática
- Usa muito WhatsApp pra trabalhar — você é a forma dele acelerar tarefas

REGRAS DE COMUNICAÇÃO:
- Português BR, tom de assistente próximo (não formal demais, não bot).
- Respostas CURTAS por default. WhatsApp não é redação.
- Sem emoji estruturado, sem markdown, sem listas com bullets.
- Se a tarefa é simples, faz e responde direto.
- Antes de qualquer ação destrutiva (criar tarefa, criar campanha, mass send, deletar), CONFIRME com ele em uma frase: "vou criar tarefa X com prazo Y pra Iza, confirma?". Espera o "ok" ou similar antes de executar.
- Se ele faz pergunta que precisa de dados do CRM, chama as tools — não invente.
- Se ele expressar preferência ou fato sobre rotina ("sempre opero terça"), use salvar_memoria.
- Em dúvidas, pergunte. Nunca chute.

TOOLS DISPONÍVEIS:
Você tem acesso ao CRM dele. Pode listar conversas pendentes da equipe, ver tarefas atrasadas, criar tarefas, ver agenda do dia/semana, listar campanhas de prospecção, e guardar/recuperar memórias sobre o Maikon.

LIMITAÇÕES:
- Você NÃO pode enviar WhatsApp em nome dele ainda (fase posterior).
- Você NÃO pode editar/cancelar eventos da agenda ainda (só listar).
- Para tarefas que estão fora das tools, diga claramente: "isso eu ainda não consigo fazer".`;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const t0 = Date.now();

  try {
    const payload = await req.json().catch(() => ({}));

    // Suporta dois modos: webhook Evolution OU invocação direta {text}
    const event = payload.body?.event || payload.event;
    const data = payload.body?.data || payload.data;
    const directText = payload.text as string | undefined;
    const directUserId = payload.user_id as string | undefined;

    let inputText: string;
    let waMessageId: string | null = null;
    let inputType = 'text';

    if (directText) {
      // Modo direto (testes ou outras integrações)
      inputText = directText;
    } else {
      // Modo webhook Evolution: só processa messages.upsert from_me=false
      if (event !== 'messages.upsert' || !data?.key) {
        return jsonRes(200, { skipped: true, reason: 'event não suportado' });
      }
      if (data.key.fromMe) {
        return jsonRes(200, { skipped: true, reason: 'fromMe' });
      }

      // Whitelist
      const fromPhone = (data.key.remoteJid || '').split('@')[0].replace(/\D/g, '');
      const userPhone = Deno.env.get('ASSISTENTE_USER_PHONE') || '';
      if (!userPhone || !fromPhone.endsWith(userPhone.slice(-10))) {
        return jsonRes(200, { skipped: true, reason: 'fora da whitelist', from: fromPhone });
      }

      waMessageId = data.key.id || null;

      // Extrai texto (com Whisper inline pra áudio)
      if (data.message?.conversation) {
        inputText = data.message.conversation;
      } else if (data.message?.extendedTextMessage?.text) {
        inputText = data.message.extendedTextMessage.text;
      } else if (data.message?.audioMessage?.base64 || data.message?.pttMessage?.base64) {
        inputType = 'audio';
        const b64 = data.message.audioMessage?.base64 || data.message.pttMessage?.base64;
        const mime = data.message.audioMessage?.mimetype || data.message.pttMessage?.mimetype || 'audio/ogg';
        inputText = await transcribeWhisper(b64, mime);
      } else {
        return jsonRes(200, { skipped: true, reason: 'sem texto/áudio' });
      }
    }

    if (!inputText.trim()) {
      return jsonRes(200, { skipped: true, reason: 'texto vazio' });
    }

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const userId = directUserId || Deno.env.get('ASSISTENTE_USER_ID') || '';
    if (!userId) {
      return jsonRes(500, { error: 'ASSISTENTE_USER_ID não configurado' });
    }

    const userPhone = Deno.env.get('ASSISTENTE_USER_PHONE') || '';
    const ctx = { supa, userId, userPhone };

    // Loop de tool use
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return jsonRes(500, { error: 'ANTHROPIC_API_KEY não configurada' });
    }

    const messages: AnthropicMessage[] = [{ role: 'user', content: inputText }];
    const toolCallsLog: Array<Record<string, unknown>> = [];
    let respostaFinal = '';
    let tokensIn = 0;
    let tokensOut = 0;

    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: [
            // prompt caching: system prompt fixo é cacheado, economiza ~80% em re-uso
            { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
          ],
          tools: TOOL_SCHEMAS,
          messages,
        }),
      });

      if (!apiResp.ok) {
        const err = await apiResp.text();
        throw new Error(`Anthropic ${apiResp.status}: ${err.slice(0, 400)}`);
      }

      const claudeResp = await apiResp.json();
      tokensIn += claudeResp.usage?.input_tokens || 0;
      tokensOut += claudeResp.usage?.output_tokens || 0;

      // Adiciona resposta do assistant ao histórico
      messages.push({ role: 'assistant', content: claudeResp.content });

      const stopReason = claudeResp.stop_reason;

      // Extrai texto final (se tiver) e chamadas de tool
      const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
      let textoNaResp = '';
      for (const block of claudeResp.content) {
        if (block.type === 'text') textoNaResp += block.text;
        if (block.type === 'tool_use') toolUses.push(block);
      }

      if (stopReason === 'end_turn' || toolUses.length === 0) {
        respostaFinal = textoNaResp.trim();
        break;
      }

      // Executa cada tool e adiciona tool_result
      const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> = [];
      for (const tu of toolUses) {
        const handler = TOOL_HANDLERS[tu.name];
        let result: unknown;
        let isError = false;
        try {
          if (!handler) throw new Error(`tool desconhecida: ${tu.name}`);
          result = await handler(tu.input, ctx);
        } catch (e) {
          isError = true;
          result = { error: e instanceof Error ? e.message : String(e) };
        }
        toolCallsLog.push({ name: tu.name, input: tu.input, result, error: isError });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result).slice(0, 8000),
          is_error: isError,
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    // Envia resposta de volta pro WhatsApp se for via webhook (não em modo direto)
    if (waMessageId && respostaFinal) {
      await sendWhatsApp(supa, ctx.userPhone, respostaFinal);
    }

    // Audit log
    await supa.from('assistente_audit_log').insert({
      user_id: userId,
      wa_message_id: waMessageId,
      input_text: inputText,
      input_type: inputType,
      tool_calls: toolCallsLog,
      resposta_final: respostaFinal,
      modelo: MODEL,
      tokens_input: tokensIn,
      tokens_output: tokensOut,
      duracao_ms: Date.now() - t0,
    });

    return jsonRes(200, {
      ok: true,
      input: inputText,
      resposta: respostaFinal,
      tool_calls: toolCallsLog.length,
      duracao_ms: Date.now() - t0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[assistente-maikon-pessoal] erro:', msg);
    return jsonRes(500, { ok: false, error: msg, duracao_ms: Date.now() - t0 });
  }
});

async function transcribeWhisper(b64: string, mimeType: string): Promise<string> {
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) return '[áudio não transcrito — OpenAI não configurada]';
  try {
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
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
    if (!r.ok) return '[áudio: falha na transcrição]';
    const j = await r.json();
    return (j.text || '').trim() || '[áudio vazio]';
  } catch (e) {
    return `[áudio: erro ${e instanceof Error ? e.message : 'desconhecido'}]`;
  }
}

async function sendWhatsApp(
  supa: ReturnType<typeof createClient>,
  toPhone: string,
  text: string,
): Promise<void> {
  try {
    const { data: cfg } = await supa
      .from('config_global')
      .select('evolution_base_url, evolution_api_key')
      .single();
    const url = (cfg as { evolution_base_url?: string } | null)?.evolution_base_url || Deno.env.get('EVOLUTION_API_URL');
    const key = (cfg as { evolution_api_key?: string } | null)?.evolution_api_key || Deno.env.get('EVOLUTION_API_KEY');
    const inst = Deno.env.get('ASSISTENTE_INSTANCE_NAME');
    if (!url || !key || !inst) {
      console.warn('[assistente] config Evolution incompleta, sem envio');
      return;
    }
    await fetch(`${url}/message/sendText/${encodeURIComponent(inst)}`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: toPhone, text }),
    });
  } catch (e) {
    console.warn('[assistente] sendWhatsApp falhou:', e);
  }
}

function jsonRes(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
