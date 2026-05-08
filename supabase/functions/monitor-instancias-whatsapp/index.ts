// monitor-instancias-whatsapp — checa estado real das instâncias de
// atendimento na Evolution API e:
//   1. Sincroniza connection_status no banco
//   2. Se instância caiu (transição para "close"), avisa por WhatsApp
//      o RECEBEDOR configurado pra aquela instância
//
// Atualmente apenas Mariana recebe alertas (chip Consultório).
// Pra adicionar outros: definir map RECEBEDORES_POR_INSTANCIA abaixo.
//
// Roda via pg_cron a cada 5min.
// Anti-spam: skip se já houve alerta da mesma instância+tipo nas últimas 6h.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Telefone (com DDI 55) de quem recebe alerta de cada instância.
// Default: Mariana (chip Consultório).
const RECEBEDORES_POR_INSTANCIA: Record<string, string> = {
  Consultorio: '554788342543', // Mariana
};
const RECEBEDOR_DEFAULT = '554788342543'; // Mariana

const ANTI_SPAM_HORAS = 6;

// Estados que consideramos "caiu" — qualquer um aciona alerta.
const ESTADOS_CAIDOS = new Set(['close', 'closed', 'disconnected', 'connecting']);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: cfg } = await supa
      .from('config_global')
      .select('evolution_base_url, evolution_api_key')
      .single();
    const evoUrl = (cfg as { evolution_base_url?: string } | null)?.evolution_base_url
      || Deno.env.get('EVOLUTION_API_URL');
    const evoKey = (cfg as { evolution_api_key?: string } | null)?.evolution_api_key
      || Deno.env.get('EVOLUTION_API_KEY');
    if (!evoUrl || !evoKey) {
      return jsonRes(500, { ok: false, error: 'config Evolution incompleta' });
    }

    // Carrega TODAS instâncias ativas (atendimento, geral, disparo).
    // Antes só pegava finalidade=atendimento, mas Agent-Madeira tem finalidade=geral
    // e ficava com connection_status defasado eternamente.
    // Alertas continuam sendo enviados só pra finalidades relevantes (ver lógica abaixo).
    const { data: insts } = await supa
      .from('instancias_whatsapp')
      .select('id, nome_instancia, finalidade, connection_status, status')
      .eq('ativo', true);

    const resultados: Array<Record<string, unknown>> = [];

    for (const inst of (insts || [])) {
      const i = inst as { id: string; nome_instancia: string; finalidade: string; connection_status: string | null; status: string | null };

      try {
        const r = await fetch(
          `${evoUrl}/instance/connectionState/${encodeURIComponent(i.nome_instancia)}`,
          { headers: { apikey: evoKey } },
        );
        if (!r.ok) {
          resultados.push({ instancia: i.nome_instancia, erro_evolution: r.status });
          continue;
        }
        const j = await r.json();
        // Resposta Evolution: { instance: { instanceName, state } }
        const stateReal: string = (j.instance?.state || j.state || 'unknown').toLowerCase();

        // Mapeia estado Evolution -> connection_status do banco
        const novoStatus = stateReal === 'open' ? 'connected'
          : ESTADOS_CAIDOS.has(stateReal) ? 'disconnected'
          : stateReal;

        // Mapeia também status lógico ('ativa' quando connected, 'inativa' caso contrário)
        const novoStatusLogico = novoStatus === 'connected' ? 'ativa' : 'inativa';
        const mudou = i.connection_status !== novoStatus || i.status !== novoStatusLogico;
        if (mudou) {
          await supa
            .from('instancias_whatsapp')
            .update({
              connection_status: novoStatus,
              status: novoStatusLogico,
              updated_at: new Date().toISOString(),
            })
            .eq('id', i.id);
        }

        // Decide se alerta:
        //  - Estado real é "caiu"
        //  - Antes não estava caído (transição) OU não houve alerta nas últimas 6h
        //  - Só envia alerta pra instâncias de atendimento (não pra geral/disparo)
        if (ESTADOS_CAIDOS.has(stateReal) && i.finalidade === 'atendimento') {
          const anteriorCaido = ESTADOS_CAIDOS.has((i.connection_status || '').toLowerCase()) ||
            i.connection_status === 'disconnected';

          // Verifica anti-spam
          const seisHorasAtras = new Date(Date.now() - ANTI_SPAM_HORAS * 60 * 60 * 1000).toISOString();
          const { count } = await supa
            .from('instancia_alertas')
            .select('id', { count: 'exact', head: true })
            .eq('instancia_id', i.id)
            .eq('tipo', 'queda')
            .gte('enviado_em', seisHorasAtras);

          // Alerta se: era transição (antes estava OK) OU passou da janela anti-spam
          if (!anteriorCaido || (count || 0) === 0) {
            const dest = RECEBEDORES_POR_INSTANCIA[i.nome_instancia] || RECEBEDOR_DEFAULT;
            const horaBR = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
            const dataBR = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
            const msg = `🚨 Chip "${i.nome_instancia}" caiu (estado: ${stateReal})\n` +
              `Detectado ${dataBR} às ${horaBR}.\n\n` +
              `Reconecta no CRM em /zaps escaneando o QR. Se persistir, avisa o Raul.`;

            // Envia via Evolution pelo chip do Madeira (sem dependência circular — Madeira sempre online)
            const inst = Deno.env.get('ASSISTENTE_INSTANCE_NAME');
            if (inst) {
              const send = await fetch(
                `${evoUrl}/message/sendText/${encodeURIComponent(inst)}`,
                {
                  method: 'POST',
                  headers: { apikey: evoKey, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ number: dest, text: msg }),
                },
              );
              if (send.ok) {
                await supa.from('instancia_alertas').insert({
                  instancia_id: i.id,
                  tipo: 'queda',
                  recebedor_telefone: dest,
                  mensagem: msg,
                  evolution_state: stateReal,
                });
                resultados.push({ instancia: i.nome_instancia, alertado: dest, estado: stateReal });
              } else {
                resultados.push({ instancia: i.nome_instancia, erro_envio: send.status });
              }
            } else {
              resultados.push({ instancia: i.nome_instancia, erro: 'ASSISTENTE_INSTANCE_NAME não configurado' });
            }
          } else {
            resultados.push({ instancia: i.nome_instancia, sem_alerta: 'já alertado nas últimas 6h' });
          }
        } else {
          resultados.push({ instancia: i.nome_instancia, ok: stateReal });
        }
      } catch (e) {
        resultados.push({ instancia: i.nome_instancia, erro: e instanceof Error ? e.message : String(e) });
      }
    }

    return jsonRes(200, { ok: true, total: (insts || []).length, resultados });
  } catch (err) {
    return jsonRes(500, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

function jsonRes(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
