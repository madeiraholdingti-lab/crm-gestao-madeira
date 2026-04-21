// analisar-conversa-ia
// Dor #6 do Maikon: "IA qualifica conversas — sentimento, urgência, perfil do contato"
//
// Fluxo:
//   1. Recebe conversa_id
//   2. Busca últimas 30 mensagens dessa conversa (messages EN + mensagens PT merge)
//   3. Chama Gemini 2.5 Flash com structured output (JSON schema forçado)
//   4. Persiste em whatsapp_conversa_analise
//   5. Retorna a análise

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const MAX_MENSAGENS = 30;

const SYSTEM_PROMPT = `Você é um assistente que analisa conversas de WhatsApp para o CRM do Dr. Maikon Madeira — cirurgião cardíaco em Itajaí/SC.

Contexto do negócio:
- Dr. Maikon presta serviços de cirurgia cardíaca via a empresa Gestão Serviço Saúde (GSS)
- Contatos podem ser: pacientes, outros médicos, diretores de hospital, gestores, anestesistas, cirurgiões cardíacos, enfermeiros, administrativo, fornecedores ou vendedores (spam)
- Isadora e Mariana (secretárias) atendem via WhatsApp
- Conversas importantes: agendamento de cirurgia, captação de hospital pra contrato, pós-operatório
- Conversas irrelevantes: vendedores de móveis, spam, corrente de WhatsApp

Sua análise deve ser:
- Precisa (só inferir o que as mensagens de fato mostram)
- Útil para ação (ajudar a decidir o que fazer a seguir)
- Curta e direta (resumo em 1-2 frases, pontos-chave concisos)
- Em português brasileiro`;

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    sentimento: {
      type: 'string',
      enum: ['positivo', 'neutro', 'negativo', 'urgente', 'frustrado', 'curioso'],
      description: 'Sentimento predominante do CONTATO (não o tom da secretária)',
    },
    confianca: {
      type: 'number',
      description: 'Confiança na análise de sentimento, de 0.0 a 1.0',
    },
    resumo: {
      type: 'string',
      description: 'Resumo da conversa em 1-2 frases. O que está sendo tratado, status atual.',
    },
    pontos_chave: {
      type: 'array',
      items: { type: 'string' },
      description: '2-5 bullets curtos com as informações mais relevantes levantadas.',
    },
    proxima_acao_sugerida: {
      type: 'string',
      description: 'O que a equipe deveria fazer a seguir. 1 frase curta e acionável.',
    },
    perfil_sugerido: {
      type: 'string',
      enum: [
        'paciente', 'medico_cirurgiao_cardiaco', 'medico_outra_especialidade',
        'anestesista', 'enfermeiro', 'gestor_hospital', 'diretor_hospital',
        'administrativo', 'fornecedor', 'vendedor_spam', 'indefinido',
      ],
      description: 'Classificação do contato baseada no que dá pra inferir das mensagens',
    },
    perfil_sugerido_confianca: {
      type: 'number',
      description: 'Confiança na classificação do perfil, 0.0 a 1.0',
    },
    urgencia_nivel: {
      type: 'integer',
      description: 'Urgência da ação: 1=pode ficar, 2=responder hoje, 3=responder em horas, 4=responder agora, 5=emergência clínica',
    },
  },
  required: [
    'sentimento', 'confianca', 'resumo', 'pontos_chave',
    'proxima_acao_sugerida', 'perfil_sugerido', 'perfil_sugerido_confianca',
    'urgencia_nivel',
  ],
};

interface RequestBody {
  conversa_id: string;
  user_id?: string;
}

function extractJson(text: string): unknown {
  // Gemini às vezes envolve em ```json ... ```; limpa antes de parsear
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiKey) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY não configurada' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') ?? '';

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { conversa_id, user_id: bodyUserId }: RequestBody = await req.json();

    // Tenta identificar user via JWT; se não rolar, usa o user_id do body.
    // Permite chamada tanto do UI (JWT) quanto do backend (service role + user_id).
    let userId: string | null = null;
    const { data: authData } = await userClient.auth.getUser();
    if (authData?.user) userId = authData.user.id;
    else if (bodyUserId) userId = bodyUserId;
    if (!conversa_id) {
      return new Response(
        JSON.stringify({ error: 'conversa_id obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    void userId;

    // 1. Info da conversa + contato
    const { data: conversa, error: convError } = await adminClient
      .from('conversas')
      .select('id, nome_contato, numero_contato, contact_id, status, status_qualificacao')
      .eq('id', conversa_id)
      .maybeSingle();

    if (convError || !conversa) {
      return new Response(
        JSON.stringify({ error: 'Conversa não encontrada' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 2. Últimas 30 mensagens (tabela EN messages) — ordenadas por timestamp asc
    const { data: mensagens } = await adminClient
      .from('messages')
      .select('text, from_me, wa_timestamp, created_at, message_type, status')
      .eq('contact_id', conversa.contact_id)
      .order('created_at', { ascending: false })
      .limit(MAX_MENSAGENS);

    const mensagensOrdenadas = (mensagens || []).slice().reverse();

    if (mensagensOrdenadas.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Conversa sem mensagens pra analisar' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 3. Montar prompt com as mensagens
    const nomeContato = conversa.nome_contato || conversa.numero_contato || 'Contato';
    const transcricao = mensagensOrdenadas.map((m: {
      text: string | null; from_me: boolean; message_type: string | null;
    }) => {
      const remetente = m.from_me ? 'Secretária/Maikon' : nomeContato;
      const tipo = m.message_type && m.message_type !== 'text' ? ` [${m.message_type}]` : '';
      return `${remetente}${tipo}: ${m.text || '(sem texto)'}`;
    }).join('\n');

    const userPrompt = `Analise esta conversa de WhatsApp.

Contato: ${nomeContato}
Status atual no CRM: ${conversa.status}
Mensagens (${mensagensOrdenadas.length} últimas, cronológico):

${transcricao}

Devolva um JSON seguindo exatamente o schema fornecido. Não inclua explicações fora do JSON.`;

    // 4. Chamar Gemini com structured output
    const geminiResp = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: 'application/json',
          responseSchema: ANALYSIS_SCHEMA,
        },
      }),
    });

    if (!geminiResp.ok) {
      const errText = await geminiResp.text();
      console.error('[analisar-conversa-ia] Gemini erro:', geminiResp.status, errText.slice(0, 500));
      return new Response(
        JSON.stringify({ error: `Gemini falhou (${geminiResp.status})`, detail: errText.slice(0, 300) }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const geminiData = await geminiResp.json();
    const textOutput = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textOutput) {
      console.error('[analisar-conversa-ia] Resposta Gemini sem texto:', JSON.stringify(geminiData).slice(0, 500));
      return new Response(
        JSON.stringify({ error: 'Resposta da IA vazia' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = extractJson(textOutput) as Record<string, unknown>;
    } catch (err) {
      console.error('[analisar-conversa-ia] JSON inválido:', textOutput.slice(0, 500));
      return new Response(
        JSON.stringify({ error: 'IA devolveu JSON inválido' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const tokensUsados = geminiData?.usageMetadata?.totalTokenCount ?? null;

    // 5. Persistir análise
    const { data: saved, error: saveError } = await adminClient
      .from('whatsapp_conversa_analise')
      .insert({
        conversa_id,
        contact_id: conversa.contact_id,
        analyzed_by_user_id: userId,
        sentimento: parsed.sentimento,
        confianca: parsed.confianca,
        resumo: parsed.resumo,
        pontos_chave: parsed.pontos_chave || [],
        proxima_acao_sugerida: parsed.proxima_acao_sugerida,
        perfil_sugerido: parsed.perfil_sugerido,
        perfil_sugerido_confianca: parsed.perfil_sugerido_confianca,
        urgencia_nivel: parsed.urgencia_nivel,
        model_version: GEMINI_MODEL,
        tokens_usados: tokensUsados,
        mensagens_analisadas: mensagensOrdenadas.length,
      })
      .select()
      .single();

    if (saveError) {
      console.error('[analisar-conversa-ia] Erro ao salvar:', saveError);
      return new Response(
        JSON.stringify({ error: 'Erro ao salvar análise', detail: saveError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, analise: saved }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[analisar-conversa-ia] Erro:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Erro interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
