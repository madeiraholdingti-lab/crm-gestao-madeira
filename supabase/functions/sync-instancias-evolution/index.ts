// sync-instancias-evolution — sincroniza status real das instâncias Evolution API
// com a tabela `instancias_whatsapp` do Supabase.
//
// Problema que resolve: o Supabase pode dizer que uma instância está 'ativa' mas
// o Evolution reportar 'close' (chip caiu sem o sistema saber). Isso causa:
//   - processar-campanha-v2 escolher um chip morto e todos envios falharem
//   - workflow IA responder pegar instância offline pra responder
//
// Roda via pg_cron a cada 5min. Compara e atualiza `status`:
//   Evolution 'open' → banco 'ativa'
//   Evolution 'close'/'connecting'/etc → banco 'inativa'
//   Evolution não lista → banco 'deletada' (provavelmente foi removida lá)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EvoInstance {
  name?: string;
  instanceName?: string;
  instance?: { instanceName?: string };
  connectionStatus?: string;
  state?: string;
}

interface LocalInst {
  id: string;
  nome_instancia: string;
  status: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 1. Carrega config da Evolution do banco
    const { data: config } = await supa
      .from('config_global')
      .select('evolution_base_url, evolution_api_key')
      .single();

    const evoUrl = config?.evolution_base_url || Deno.env.get('EVOLUTION_API_URL');
    const evoKey = config?.evolution_api_key || Deno.env.get('EVOLUTION_API_KEY');
    if (!evoUrl || !evoKey) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Evolution config não encontrada' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 2. Lista instâncias reais do Evolution
    const r = await fetch(`${evoUrl}/instance/fetchInstances`, {
      headers: { apikey: evoKey },
    });
    if (!r.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: `Evolution retornou ${r.status}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const evoListRaw = await r.json();
    const evoList: EvoInstance[] = Array.isArray(evoListRaw)
      ? evoListRaw
      : (evoListRaw?.data || evoListRaw?.instances || []);

    const evoMap = new Map<string, string>(); // nome → status
    for (const i of evoList) {
      const nm = i.name || i.instanceName || i.instance?.instanceName;
      const st = i.connectionStatus || i.state || 'unknown';
      if (nm) evoMap.set(nm, st);
    }

    // 3. Carrega instâncias locais (não-deletadas)
    const { data: locais } = await supa
      .from('instancias_whatsapp')
      .select('id, nome_instancia, status')
      .neq('status', 'deletada');

    let atualizadas = 0;
    const changes: Array<Record<string, unknown>> = [];

    for (const local of (locais || []) as LocalInst[]) {
      const evoStatus = evoMap.get(local.nome_instancia);
      let desiredStatus: 'ativa' | 'inativa' | 'deletada' | null = null;

      if (!evoStatus) {
        // Instância não existe mais no Evolution — marca como deletada
        desiredStatus = 'deletada';
      } else if (evoStatus !== 'open' && local.status === 'ativa') {
        // Só detecta QUEDA: Evolution não está open mas banco diz ativa → vira inativa
        desiredStatus = 'inativa';
      }
      // NÃO fazemos inativa→ativa automaticamente!
      // Motivo: socket zombie no Evolution pode reportar 'open' sem sessão real.
      // O retorno pra 'ativa' só acontece via polling da UI de conectar (QR escaneado).
      // Isso preserva o fix do desconectar (desconectar-evolution marca inativa
      // e sync não reverte).

      if (desiredStatus && local.status !== desiredStatus) {
        await supa
          .from('instancias_whatsapp')
          .update({ status: desiredStatus, updated_at: new Date().toISOString() })
          .eq('id', local.id);
        atualizadas++;
        changes.push({
          nome: local.nome_instancia,
          de: local.status,
          para: desiredStatus,
          evolution_state: evoStatus || '(não existe)',
        });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        total_locais: (locais || []).length,
        total_evolution: evoList.length,
        atualizadas,
        changes,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[sync-instancias-evolution] erro:', msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
