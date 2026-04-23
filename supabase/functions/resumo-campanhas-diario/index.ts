// resumo-campanhas-diario — endpoint GET/POST que retorna snapshot do dia
// pra alimentar o resumo diário das 18h no WhatsApp do Maikon.
//
// Saída: breakdown por campanha ativa + chips pausados + handoffs pendentes.
// Consumido pelo workflow n8n "ResumoDiario18h".

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CampanhaRow {
  id: string;
  nome: string;
  tipo: string | null;
  status: string | null;
  envios_por_dia: number | null;
}

interface EnvioRow {
  id: string;
  campanha_id: string;
  status: string;
  enviado_em: string | null;
  respondeu_em: string | null;
  erro: string | null;
}

interface ChipRow {
  id: string;
  nome_instancia: string | null;
  numero_chip: string | null;
  status: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const now = new Date();
    const hoje = new Date(now); hoje.setHours(0, 0, 0, 0);
    const hojeIso = hoje.toISOString();
    const ontem24hIso = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

    // 1. Campanhas ativas
    const { data: campanhas, error: campErr } = await supa
      .from('campanhas_disparo')
      .select('id, nome, tipo, status, envios_por_dia')
      .eq('status', 'ativa')
      .order('created_at', { ascending: false });

    if (campErr) throw campErr;
    const campMap = new Map<string, CampanhaRow>();
    (campanhas || []).forEach((c: CampanhaRow) => campMap.set(c.id, c));

    // 2. Envios — só de campanhas ativas, com atividade hoje
    const { data: enviosHoje } = await supa
      .from('campanha_envios')
      .select('id, campanha_id, status, enviado_em, respondeu_em, erro')
      .in('campanha_id', Array.from(campMap.keys()))
      .or(`enviado_em.gte.${hojeIso},respondeu_em.gte.${hojeIso},created_at.gte.${hojeIso}`);

    // 3. Breakdown por campanha
    const breakdown = Array.from(campMap.values()).map((c) => {
      const envs = (enviosHoje || []).filter((e: EnvioRow) => e.campanha_id === c.id);
      const enviadosHoje = envs.filter((e: EnvioRow) => e.enviado_em && e.enviado_em >= hojeIso).length;
      const respondidosHoje = envs.filter((e: EnvioRow) => e.respondeu_em && e.respondeu_em >= hojeIso).length;
      const qualificadosHoje = envs.filter((e: EnvioRow) =>
        e.status === 'qualificado' && e.respondeu_em && e.respondeu_em >= hojeIso
      ).length;
      const descartadosHoje = envs.filter((e: EnvioRow) =>
        e.status === 'descartado' && (e.respondeu_em || e.enviado_em || '') >= hojeIso
      ).length;
      const emConversaAgora = envs.filter((e: EnvioRow) => e.status === 'em_conversa').length;
      const falhas = envs.filter((e: EnvioRow) => e.erro && (e.enviado_em || '') >= hojeIso).length;
      return {
        campanha_id: c.id,
        nome: c.nome,
        tipo: c.tipo,
        enviados_hoje: enviadosHoje,
        respondidos_hoje: respondidosHoje,
        qualificados_hoje: qualificadosHoje,
        descartados_hoje: descartadosHoje,
        em_conversa_agora: emConversaAgora,
        falhas_hoje: falhas,
        taxa_resposta_pct: enviadosHoje > 0 ? Math.round((respondidosHoje / enviadosHoje) * 100) : 0,
      };
    }).filter(b => b.enviados_hoje + b.respondidos_hoje + b.em_conversa_agora > 0);

    // 4. Chips em status 'suspeito' (auto-pausados)
    const { data: chipsPausados } = await supa
      .from('instancias_whatsapp')
      .select('id, nome_instancia, numero_chip, status')
      .eq('status', 'suspeito');

    // 5. Leads quentes aguardando handoff manual — status qualificado nas últimas 24h
    const { data: handoffsPendentes } = await supa
      .from('campanha_envios')
      .select('id, campanha_id, telefone, respondeu_em')
      .eq('status', 'qualificado')
      .gte('respondeu_em', ontem24hIso)
      .order('respondeu_em', { ascending: false })
      .limit(20);

    // Hydra com nome da campanha
    const handoffsComNome = (handoffsPendentes || []).map((h: { campanha_id: string; telefone: string; respondeu_em: string }) => ({
      telefone: h.telefone,
      respondeu_em: h.respondeu_em,
      campanha_nome: campMap.get(h.campanha_id)?.nome || 'Campanha removida',
    }));

    // 6. Totais globais
    const totais = {
      campanhas_ativas: (campanhas || []).length,
      enviados_hoje: breakdown.reduce((s, b) => s + b.enviados_hoje, 0),
      respondidos_hoje: breakdown.reduce((s, b) => s + b.respondidos_hoje, 0),
      qualificados_hoje: breakdown.reduce((s, b) => s + b.qualificados_hoje, 0),
      descartados_hoje: breakdown.reduce((s, b) => s + b.descartados_hoje, 0),
      em_conversa_agora: breakdown.reduce((s, b) => s + b.em_conversa_agora, 0),
      handoffs_pendentes: handoffsComNome.length,
      chips_pausados: (chipsPausados || []).length,
    };

    return new Response(JSON.stringify({
      gerado_em: now.toISOString(),
      totais,
      por_campanha: breakdown,
      chips_pausados: (chipsPausados as ChipRow[] || []).map((c) => ({
        nome: c.nome_instancia,
        numero: c.numero_chip,
      })),
      handoffs_pendentes: handoffsComNome,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[resumo-campanhas-diario] erro:', msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
