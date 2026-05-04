// madeira-test-versiculo — replica a geração do versículo SEM enviar pelo
// Evolution. Retorna o texto cru no JSON pra validação de encoding/conteúdo.
//
// Input: { user_id?: string }  (default: ASSISTENTE_USER_ID)
// Output: { ok, texto, length, sample_codepoints }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as { user_id?: string };
    const userId = body.user_id || Deno.env.get('ASSISTENTE_USER_ID');
    if (!userId) return json(400, { ok: false, error: 'user_id ausente' });

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json(500, { ok: false, error: 'ANTHROPIC_API_KEY ausente' });

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: ctxData } = await supa.rpc('contexto_assistente', {
      p_user_id: userId,
      p_turnos_recentes: 0,
    });
    const c = (Array.isArray(ctxData) ? ctxData[0] : null) as {
      memorias_top?: Array<{ chave: string; valor: string }>;
      resumo_semana?: string | null;
    } | null;

    const memorias = c?.memorias_top?.length
      ? c.memorias_top.map(m => `- ${m.chave}: ${m.valor}`).join('\n')
      : 'Sem contexto pessoal ainda.';
    const semana = c?.resumo_semana || 'Sem resumo da semana.';

    const prompt = `Você é o **Madeira** — extensão digital do Dr. Maikon Madeira (cirurgião cardiovascular, empresário, gestor da GSS, desenvolvendo Maikonect CRM, pai/marido). Hoje é ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}.

Escolha um versículo bíblico INSPIRADOR pra começar o dia dele.

CONTEXTO RECENTE DO MAIKON:
${semana}

PREFERÊNCIAS/FATOS DELE:
${memorias}

ENTREGA esperada (formato pronto pra colar no WhatsApp dele):
1. Saudação curta ("Bom dia, doutor 🌅" - 1 linha)
2. Versículo (referência + texto, NVI ou similar — máx 3 linhas)
3. Reflexão CURTA (3-5 linhas) conectando o versículo com a vida/desafios reais dele. Use o contexto recente pra personalizar — não seja genérico.
4. Encerramento de 1 linha (oração curta ou sem encerramento, o que ficar mais natural).

REGRAS:
- Tom: amigo cristão, não pastor formal. Sem clichê.
- Sem hashtag, sem emoji estruturado, no máximo 1 emoji discreto.
- Português BR.
- NÃO se identifica como "Madeira" no texto (a saudação é em primeira pessoa direta — sem assinatura).
- NÃO repita versículo do dia anterior se possível (varia entre Antigo/Novo Testamento, Salmos, Provérbios, Mateus, etc).
- Total: máximo 12 linhas.`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!r.ok) {
      return json(502, { ok: false, error: `Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}` });
    }
    const j = await r.json();
    const texto = (j.content?.[0]?.text || '').trim();

    // Diagnóstico de encoding: lista codepoints dos primeiros 80 chars
    const sample = [...texto.slice(0, 80)].map(ch => ({
      ch,
      cp: 'U+' + ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0'),
    }));

    return json(200, {
      ok: true,
      length: texto.length,
      texto,
      sample_codepoints: sample,
    });
  } catch (err) {
    return json(500, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
