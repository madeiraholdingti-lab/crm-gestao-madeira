// assistente-cron-worker — varre assistente_crons a cada minuto e dispara
// jobs ativos. Suporta 3 tipos:
//  - mensagem: envia texto fixo pro WhatsApp pessoal do user
//  - briefing: chama o assistente-maikon-pessoal com prompt e envia resultado
//  - versiculo: feature dedicada (versículo bíblico do dia + reflexão personalizada)
//
// Cron expression interpretada com fuso America/Sao_Paulo.
// Pra simplicidade, suporta os 5 padrões clássicos: minute hour day month weekday.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TZ = 'America/Sao_Paulo';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 1. Carrega crons ativos
    const { data: crons } = await supa
      .from('assistente_crons')
      .select('id, user_id, nome, tipo, cron_expression, payload, ultima_execucao_em, apenas_uma_vez, data_fim')
      .eq('ativo', true);

    const agora = new Date();
    const executados: Array<{ nome: string; resultado: string }> = [];

    type CronRow = {
      id: string; user_id: string; nome: string; tipo: string;
      cron_expression: string; payload: Record<string, unknown>;
      ultima_execucao_em: string | null;
      apenas_uma_vez: boolean;
      data_fim: string | null;
    };

    // 1ª passada: classifica cada cron. Expirado → desativa. Não dispara → skip.
    // Senão → vai pro bucket apropriado.
    // Crons tipo='mensagem' (lembrete pro próprio Maikon) são AGRUPADOS por
    // user_id quando 2+ caem no mesmo minuto — Maikon estava recebendo 5
    // notificações em rajada às 8h da manhã. Vira mensagem única com bullets.
    // Outros tipos (versiculo, briefing, mensagem_chip) ficam separados.
    const lembretesPorUser = new Map<string, CronRow[]>();
    const outros: CronRow[] = [];

    for (const cron of (crons || [])) {
      const c = cron as CronRow;

      // Cron expirado: desativa e pula. Anti spam-eterno.
      if (c.data_fim && new Date(c.data_fim).getTime() < agora.getTime()) {
        await supa.from('assistente_crons')
          .update({ ativo: false, updated_at: agora.toISOString(), ultima_falha: 'expirado (data_fim ultrapassada)' })
          .eq('id', c.id);
        executados.push({ nome: c.nome, resultado: 'expirado_desativado' });
        continue;
      }

      if (!cronShouldFire(c.cron_expression, agora, c.ultima_execucao_em)) continue;

      if (c.tipo === 'mensagem') {
        const lista = lembretesPorUser.get(c.user_id) || [];
        lista.push(c);
        lembretesPorUser.set(c.user_id, lista);
      } else {
        outros.push(c);
      }
    }

    // Marca cron como executado com sucesso (compartilhado entre singles e batched)
    const marcarOK = async (c: CronRow) => {
      await supa.from('assistente_crons').update({
        ultima_execucao_em: agora.toISOString(),
        ultima_falha: null,
        updated_at: agora.toISOString(),
        ...(c.apenas_uma_vez ? { ativo: false } : {}),
      }).eq('id', c.id);
      await supa.rpc('increment_cron_execucoes', { p_id: c.id }).then(() => {}, () => {});
    };
    const marcarErro = async (c: CronRow, msg: string) => {
      await supa.from('assistente_crons').update({
        ultima_falha: msg.slice(0, 500),
        updated_at: agora.toISOString(),
      }).eq('id', c.id);
    };

    // 2ª passada: dispara lembretes (agrupados se 2+ no mesmo minuto)
    const horaBR = agora.toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
    for (const [userId, lista] of lembretesPorUser) {
      try {
        let texto: string;
        if (lista.length === 1) {
          // Caso comum (1 lembrete): formato individual como antes
          texto = `🔔 Lembrete (${horaBR})\n\n${(lista[0].payload.texto as string) || ''}`;
        } else {
          // Múltiplos no mesmo minuto: agrupa NUMERADO pro Maikon poder
          // responder "cancela 1, 3" sem digitar o texto inteiro.
          // Madeira parseia essa estrutura via cancelar_lembretes_por_numero.
          const linhas = lista
            .map((c, i) => `${i + 1}) ${((c.payload.texto as string) || c.nome).trim()}`)
            .join('\n');
          texto = `🔔 Lembretes ${horaBR} (${lista.length}):\n\n${linhas}\n\n_Pra cancelar: responde "cancela 1, 3" ou similar._`;
        }
        await dispararMensagem(supa, userId, texto);
        for (const c of lista) {
          await marcarOK(c);
          executados.push({ nome: c.nome, resultado: lista.length > 1 ? `ok_agrupado(${lista.length})` : 'ok' });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        for (const c of lista) {
          await marcarErro(c, msg);
          executados.push({ nome: c.nome, resultado: `erro: ${msg.slice(0, 80)}` });
        }
      }
    }

    // 3ª passada: outros tipos (cada um separado — não agrupa)
    for (const c of outros) {
      try {
        if (c.tipo === 'versiculo') await dispararVersiculo(supa, c.user_id);
        else if (c.tipo === 'briefing') await dispararBriefing(supa, c.user_id, (c.payload.prompt as string) || '');
        else if (c.tipo === 'mensagem_chip') {
          await dispararMensagemPorChip(
            supa,
            (c.payload.instancia as string) || '',
            (c.payload.numero as string) || '',
            (c.payload.texto as string) || '',
          );
        }
        await marcarOK(c);
        executados.push({ nome: c.nome, resultado: 'ok' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await marcarErro(c, msg);
        executados.push({ nome: c.nome, resultado: `erro: ${msg.slice(0, 80)}` });
      }
    }

    return jsonRes(200, { ok: true, total_crons: (crons || []).length, executados });
  } catch (err) {
    return jsonRes(500, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// =============================================================================
// Tipo VERSÍCULO — feature top do Maikon
// =============================================================================

async function dispararVersiculo(
  supa: ReturnType<typeof createClient>,
  userId: string,
): Promise<void> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY ausente');

  // Busca contexto pessoal (memórias) pra reflexão personalizada
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
  if (!r.ok) throw new Error(`Anthropic ${r.status}`);
  const j = await r.json();
  const texto = (j.content?.[0]?.text || '').trim();
  if (!texto) throw new Error('Claude retornou vazio');

  await dispararMensagem(supa, userId, texto);
}

// =============================================================================
// Tipo MENSAGEM — envia texto fixo
// =============================================================================

async function dispararMensagem(
  supa: ReturnType<typeof createClient>,
  userId: string,
  texto: string,
): Promise<void> {
  if (!texto) throw new Error('texto vazio');
  const phone = Deno.env.get('ASSISTENTE_USER_PHONE');
  const inst = Deno.env.get('ASSISTENTE_INSTANCE_NAME');
  if (!phone || !inst) throw new Error('ASSISTENTE_USER_PHONE/INSTANCE_NAME ausente');

  const { data: cfg } = await supa
    .from('config_global')
    .select('evolution_base_url, evolution_api_key')
    .single();
  const evoUrl = (cfg as { evolution_base_url?: string } | null)?.evolution_base_url;
  const evoKey = (cfg as { evolution_api_key?: string } | null)?.evolution_api_key;
  if (!evoUrl || !evoKey) throw new Error('config_global Evolution incompleta');

  const r = await fetch(`${evoUrl}/message/sendText/${encodeURIComponent(inst)}`, {
    method: 'POST',
    headers: { apikey: evoKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ number: phone, text: texto }),
  });
  if (!r.ok) throw new Error(`Evolution sendText ${r.status}`);
}

// =============================================================================
// Tipo MENSAGEM_CHIP — envia texto agendado via chip específico (ex: Maikon GSS)
// =============================================================================

async function dispararMensagemPorChip(
  supa: ReturnType<typeof createClient>,
  instancia: string,
  numero: string,
  texto: string,
): Promise<void> {
  if (!instancia || !numero || !texto) throw new Error('instancia/numero/texto vazio');
  const { data: cfg } = await supa
    .from('config_global')
    .select('evolution_base_url, evolution_api_key')
    .single();
  const evoUrl = (cfg as { evolution_base_url?: string } | null)?.evolution_base_url;
  const evoKey = (cfg as { evolution_api_key?: string } | null)?.evolution_api_key;
  if (!evoUrl || !evoKey) throw new Error('config_global Evolution incompleta');
  const r = await fetch(`${evoUrl}/message/sendText/${encodeURIComponent(instancia)}`, {
    method: 'POST',
    headers: { apikey: evoKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ number: numero, text: texto }),
  });
  if (!r.ok) throw new Error(`Evolution sendText (${instancia}) ${r.status}`);
}

// =============================================================================
// Tipo BRIEFING — chama assistente com prompt e envia resposta
// =============================================================================

async function dispararBriefing(
  supa: ReturnType<typeof createClient>,
  userId: string,
  prompt: string,
): Promise<void> {
  if (!prompt) throw new Error('prompt vazio');
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/assistente-maikon-pessoal`;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: prompt, user_id: userId }),
  });
  if (!r.ok) throw new Error(`assistente ${r.status}`);
  const j = await r.json();
  if (j.resposta) await dispararMensagem(supa, userId, j.resposta);
}

// =============================================================================
// Cron parser simplificado (5 campos: min hora dia mes dow, fuso BRT)
// =============================================================================

function cronShouldFire(
  expr: string,
  agora: Date,
  ultimaExecucao: string | null,
): boolean {
  // Converte "agora" pro fuso BRT
  const brt = new Date(agora.toLocaleString('en-US', { timeZone: TZ }));
  const min = brt.getMinutes();
  const hora = brt.getHours();
  const dia = brt.getDate();
  const mes = brt.getMonth() + 1;
  const dow = brt.getDay(); // 0=domingo

  const partes = expr.trim().split(/\s+/);
  if (partes.length !== 5) return false;
  const [eMin, eHora, eDia, eMes, eDow] = partes;

  const matches = (campo: string, valor: number, max: number): boolean => {
    if (campo === '*') return true;
    if (campo.includes('/')) {
      const [base, step] = campo.split('/');
      const baseNum = base === '*' ? 0 : parseInt(base, 10);
      return (valor - baseNum) % parseInt(step, 10) === 0;
    }
    if (campo.includes(',')) {
      return campo.split(',').some(v => parseInt(v, 10) === valor);
    }
    if (campo.includes('-')) {
      const [a, b] = campo.split('-').map(n => parseInt(n, 10));
      return valor >= a && valor <= b;
    }
    return parseInt(campo, 10) === valor;
  };

  if (!matches(eMin, min, 59)) return false;
  if (!matches(eHora, hora, 23)) return false;
  if (!matches(eDia, dia, 31)) return false;
  if (!matches(eMes, mes, 12)) return false;
  if (!matches(eDow, dow, 6)) return false;

  // Anti-disparo duplo: já rodou nos últimos 50 minutos? skip
  if (ultimaExecucao) {
    const diffMs = agora.getTime() - new Date(ultimaExecucao).getTime();
    if (diffMs < 50 * 60 * 1000) return false;
  }

  return true;
}

function jsonRes(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
