// Edge function enviar-lembretes-wa
// Chamada pelo pg_cron a cada 5min.
// Busca tasks tipo='lembrete' cujo prazo se aproxima (até 15min adiante),
// envia WhatsApp pro responsável via Evolution API, e marca notificado_em
// pra não enviar de novo.
//
// Mensagem formatada com título + prazo + (se tiver conversa vinculada)
// link de referência.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NOTIFICACAO_ANTECEDENCIA_MIN = 15; // notifica até 15 min antes do prazo

interface LembretePendente {
  id: string;
  titulo: string;
  descricao: string | null;
  prazo: string;
  conversa_id: string | null;
  responsavel_id: string;
  // populados via JOIN abaixo
  telefone?: string;
  nome_responsavel?: string;
  instancia_envio?: string;
  nome_contato?: string | null;
  numero_contato?: string | null;
}

function formatarPrazo(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizarTelefone(raw: string): string {
  // Remove tudo que não é dígito
  const digits = raw.replace(/\D/g, '');
  // Se começa com 55 (BR), mantém; senão adiciona
  if (digits.startsWith('55')) return digits;
  // Se tem 10-11 dígitos (DDD + número), adiciona 55
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

async function enviarWhatsApp(
  evolutionUrl: string,
  apiKey: string,
  instanceName: string,
  telefone: string,
  mensagem: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await fetch(`${evolutionUrl}/message/sendText/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
      body: JSON.stringify({
        number: telefone,
        text: mensagem,
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      return { ok: false, error: `${resp.status}: ${t.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'erro desconhecido' };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const evolutionApiKey = Deno.env.get('EVOLUTION_API_KEY');

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 1) Buscar config_global pra Evolution URL
    const { data: config, error: configError } = await supabase
      .from('config_global')
      .select('evolution_base_url, evolution_api_key')
      .limit(1)
      .maybeSingle();

    if (configError || !config?.evolution_base_url) {
      console.error('[enviar-lembretes-wa] Evolution URL não configurada');
      return new Response(
        JSON.stringify({ error: 'Evolution API não configurada' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const evolutionUrl = config.evolution_base_url;
    const evolutionKey = evolutionApiKey || config.evolution_api_key;

    if (!evolutionKey) {
      return new Response(
        JSON.stringify({ error: 'EVOLUTION_API_KEY não configurada' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 2) Buscar lembretes que precisam ser notificados
    //    - tipo='lembrete', não deletados, não notificados
    //    - prazo dentro dos próximos N minutos OU já passou (máx 7 dias atrás
    //      pra evitar lembretes stale sendo enviados)
    const agora = new Date();
    const limiteAdiante = new Date(agora.getTime() + NOTIFICACAO_ANTECEDENCIA_MIN * 60_000);
    const limiteAtras = new Date(agora.getTime() - 7 * 24 * 3600_000);

    // Query com JOINs: task → task_flow_profiles → profiles + conversas (opcional)
    const { data: tasks, error: tasksError } = await supabase
      .from('task_flow_tasks')
      .select(`
        id, titulo, descricao, prazo, conversa_id, responsavel_id,
        task_flow_profiles!task_flow_tasks_responsavel_id_fkey (
          nome,
          user_id,
          profiles:profiles!task_flow_profiles_user_id_fkey (
            nome, telefone_contato, instancia_padrao_id,
            instancia:instancias_whatsapp!profiles_instancia_padrao_id_fkey (instancia_id, nome_instancia, ativo)
          )
        ),
        conversa:conversas!task_flow_tasks_conversa_id_fkey (
          nome_contato, numero_contato
        )
      `)
      .eq('tipo', 'lembrete')
      .is('deleted_at', null)
      .is('notificado_em', null)
      .lte('prazo', limiteAdiante.toISOString())
      .gte('prazo', limiteAtras.toISOString())
      .order('prazo')
      .limit(50);

    if (tasksError) {
      console.error('[enviar-lembretes-wa] Erro ao buscar tasks:', tasksError);
      return new Response(
        JSON.stringify({ error: tasksError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const lembretes = (tasks || []) as any[];
    console.log(`[enviar-lembretes-wa] ${lembretes.length} lembretes pra processar`);

    let enviados = 0;
    let falhas = 0;
    const resultados: any[] = [];

    for (const t of lembretes) {
      const profile = t.task_flow_profiles?.profiles;
      const telefoneRaw = profile?.telefone_contato;
      const nomeResp = profile?.nome || t.task_flow_profiles?.nome || 'Responsável';
      const instancia = profile?.instancia;

      if (!telefoneRaw) {
        console.warn(`[enviar-lembretes-wa] Task ${t.id}: responsável sem telefone_contato cadastrado (${nomeResp})`);
        await supabase
          .from('task_flow_tasks')
          .update({ notificado_em: new Date().toISOString() })
          .eq('id', t.id);
        resultados.push({ task_id: t.id, status: 'sem_telefone', responsavel: nomeResp });
        continue;
      }

      if (!instancia?.nome_instancia) {
        console.warn(`[enviar-lembretes-wa] Task ${t.id}: responsável sem instância padrão ativa`);
        resultados.push({ task_id: t.id, status: 'sem_instancia', responsavel: nomeResp });
        continue;
      }

      const telefone = normalizarTelefone(telefoneRaw);
      const prazoFormatado = formatarPrazo(t.prazo);

      // Montar mensagem
      let mensagem = `📌 *Lembrete*\n\n${t.titulo}\n\n⏰ Prazo: ${prazoFormatado}`;

      if (t.descricao) {
        mensagem += `\n\n📝 ${t.descricao}`;
      }

      if (t.conversa?.nome_contato || t.conversa?.numero_contato) {
        const contato = t.conversa.nome_contato || t.conversa.numero_contato;
        mensagem += `\n\n💬 Conversa: ${contato}`;
      }

      // Enviar
      const resEnvio = await enviarWhatsApp(
        evolutionUrl,
        evolutionKey,
        instancia.nome_instancia,
        telefone,
        mensagem,
      );

      if (resEnvio.ok) {
        // Marcar notificado pra não repetir
        await supabase
          .from('task_flow_tasks')
          .update({ notificado_em: new Date().toISOString() })
          .eq('id', t.id);
        enviados++;
        resultados.push({ task_id: t.id, status: 'enviado', responsavel: nomeResp });
        console.log(`[enviar-lembretes-wa] Enviado lembrete "${t.titulo}" pra ${nomeResp} via ${instancia.nome_instancia}`);
      } else {
        falhas++;
        resultados.push({ task_id: t.id, status: 'falha_envio', error: resEnvio.error });
        console.error(`[enviar-lembretes-wa] Falha ao enviar lembrete ${t.id}:`, resEnvio.error);
      }

      // Delay pequeno entre envios pra não saturar Evolution
      await new Promise((r) => setTimeout(r, 200));
    }

    return new Response(
      JSON.stringify({
        success: true,
        lembretes_processados: lembretes.length,
        enviados,
        falhas,
        resultados,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[enviar-lembretes-wa] Erro geral:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
