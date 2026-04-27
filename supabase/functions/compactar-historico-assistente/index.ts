// compactar-historico-assistente — cron diário que sumariza histórico do
// agente pessoal pra evitar explosão de contexto.
//
// Algoritmo (3 níveis):
//  1. Últimas 24h: pega audit_log, manda pro Claude, pede resumo (~300 palavras)
//  2. Última semana: pega 7 sumários diários + sumario semanal antigo (se houver),
//     consolida num resumo semanal
//  3. Último mês: idem, mas de 4 sumários semanais
//  4. >30d: agrega no 'longo' (mantém só fatos+preferências, não eventos)
//
// Roda 1x/dia às 4h BRT (07h UTC). Estimativa: ~3000 tokens input, 500 output
// por user, ~$0.005/dia. Trivial.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MODEL = 'claude-haiku-4-5-20251001';  // mais barato pra sumarização

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return jsonRes(500, { error: 'ANTHROPIC_API_KEY ausente' });

    // Para cada user com audit_log nos últimos 30d
    const { data: users } = await supa
      .from('assistente_audit_log')
      .select('user_id')
      .gte('created_at', new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
      .limit(50);
    const distintos = [...new Set((users || []).map((u: { user_id: string }) => u.user_id))];

    const resumos: Array<{ user_id: string; janelas: string[] }> = [];

    for (const userId of distintos) {
      const janelasFeitas: string[] = [];

      // === Janela DIA: últimas 24h, ainda sem resumo ===
      const ontem = new Date(Date.now() - 24 * 3600 * 1000);
      const { data: ultDia } = await supa
        .from('assistente_conversa_resumo')
        .select('id, periodo_fim')
        .eq('user_id', userId)
        .eq('janela', 'dia')
        .order('periodo_fim', { ascending: false })
        .limit(1)
        .maybeSingle();
      const inicioDia = ultDia ? new Date((ultDia as { periodo_fim: string }).periodo_fim) : ontem;
      if (Date.now() - inicioDia.getTime() > 23 * 3600 * 1000) {
        const fimDia = new Date();
        const r = await sumarizarPeriodo(supa, apiKey, userId, inicioDia, fimDia, 'dia');
        if (r.ok) janelasFeitas.push('dia');
      }

      // === Janela SEMANA: 7 sumários diários consolidados ===
      const seteDiasAtras = new Date(Date.now() - 7 * 24 * 3600 * 1000);
      const { data: ultSem } = await supa
        .from('assistente_conversa_resumo')
        .select('id, periodo_fim')
        .eq('user_id', userId)
        .eq('janela', 'semana')
        .order('periodo_fim', { ascending: false })
        .limit(1)
        .maybeSingle();
      const inicioSem = ultSem ? new Date((ultSem as { periodo_fim: string }).periodo_fim) : seteDiasAtras;
      if (Date.now() - inicioSem.getTime() > 6 * 24 * 3600 * 1000) {
        const r = await sumarizarPeriodo(supa, apiKey, userId, inicioSem, new Date(), 'semana');
        if (r.ok) janelasFeitas.push('semana');
      }

      // === Janela MÊS: 4 semanas consolidadas ===
      const trintaDiasAtras = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      const { data: ultMes } = await supa
        .from('assistente_conversa_resumo')
        .select('id, periodo_fim')
        .eq('user_id', userId)
        .eq('janela', 'mes')
        .order('periodo_fim', { ascending: false })
        .limit(1)
        .maybeSingle();
      const inicioMes = ultMes ? new Date((ultMes as { periodo_fim: string }).periodo_fim) : trintaDiasAtras;
      if (Date.now() - inicioMes.getTime() > 28 * 24 * 3600 * 1000) {
        const r = await sumarizarPeriodo(supa, apiKey, userId, inicioMes, new Date(), 'mes');
        if (r.ok) janelasFeitas.push('mes');
      }

      resumos.push({ user_id: userId, janelas: janelasFeitas });
    }

    return jsonRes(200, { ok: true, processados: resumos });
  } catch (err) {
    return jsonRes(500, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

async function sumarizarPeriodo(
  supa: ReturnType<typeof createClient>,
  apiKey: string,
  userId: string,
  inicio: Date,
  fim: Date,
  janela: 'dia' | 'semana' | 'mes',
): Promise<{ ok: boolean; tokens?: number }> {
  // Coleta os dados do período
  let conteudo = '';
  if (janela === 'dia') {
    // Pega turnos crus do audit_log
    const { data } = await supa
      .from('assistente_audit_log')
      .select('input_text, resposta_final, tool_calls, created_at')
      .eq('user_id', userId)
      .gte('created_at', inicio.toISOString())
      .lt('created_at', fim.toISOString())
      .order('created_at');
    if (!data || data.length === 0) return { ok: false };
    conteudo = data
      .map((t: { input_text: string; resposta_final?: string; tool_calls?: unknown[] }) => {
        const tools = Array.isArray(t.tool_calls) && t.tool_calls.length
          ? ` [tools: ${t.tool_calls.map((tc: { name?: string } | unknown) => (tc as { name?: string })?.name || '?').join(',')}]`
          : '';
        return `Maikon: ${t.input_text}\nVocê${tools}: ${t.resposta_final || '(sem resposta)'}`;
      })
      .join('\n---\n');
  } else {
    // Pega sumários da janela menor (dia pra semana, semana pra mês)
    const subJanela = janela === 'semana' ? 'dia' : 'semana';
    const { data } = await supa
      .from('assistente_conversa_resumo')
      .select('periodo_fim, resumo')
      .eq('user_id', userId)
      .eq('janela', subJanela)
      .gte('periodo_fim', inicio.toISOString())
      .lt('periodo_fim', fim.toISOString())
      .order('periodo_fim');
    if (!data || data.length === 0) return { ok: false };
    conteudo = data
      .map((r: { periodo_fim: string; resumo: string }) => `[${r.periodo_fim.slice(0, 10)}]\n${r.resumo}`)
      .join('\n\n');
  }

  const instrucao = janela === 'dia'
    ? 'Resuma essa conversa do dia em 200-300 palavras. Foque em: (1) o que o Maikon pediu, (2) o que você fez, (3) decisões importantes, (4) qualquer correção/preferência expressa, (5) tarefas pendentes mencionadas. Tom factual.'
    : `Consolide esses ${janela === 'semana' ? 'resumos diários' : 'resumos semanais'} num resumo único de 300-400 palavras. Foque em: tendências, padrões, projetos em andamento, preferências reveladas. Use bullets curtos pra clareza.`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 800,
      system: 'Você é um assistente que sumariza conversas do agente pessoal do Dr. Maikon Madeira. Português BR, factual, direto, sem floreio.',
      messages: [{ role: 'user', content: `${instrucao}\n\nCONTEÚDO:\n${conteudo}` }],
    }),
  });
  if (!r.ok) return { ok: false };
  const j = await r.json();
  const resumo = (j.content?.[0]?.text || '').trim();
  if (!resumo) return { ok: false };

  await supa.from('assistente_conversa_resumo').upsert(
    {
      user_id: userId,
      janela,
      periodo_inicio: inicio.toISOString(),
      periodo_fim: fim.toISOString(),
      resumo,
      tokens_economizados: (j.usage?.input_tokens || 0) - (j.usage?.output_tokens || 0),
    },
    { onConflict: 'user_id,janela,periodo_inicio' },
  );
  return { ok: true, tokens: j.usage?.output_tokens };
}

function jsonRes(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
