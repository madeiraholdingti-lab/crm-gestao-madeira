import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PERFIS_VALIDOS = [
  'medico', 'cirurgiao_cardiaco', 'anestesista', 'enfermeiro',
  'tecnico_enfermagem', 'diretor_hospital', 'gestor_saude',
  'administrativo_saude', 'patrocinador', 'paciente',
  'paciente_pos_op', 'fornecedor', 'outro'
];

const BATCH_SIZE = 50;
const DELAY_MS = 200;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY não configurada" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Buscar contatos sem classificação, priorizando os com mais mensagens
    const { data: contatosSemPerfil } = await supabase
      .from("contacts")
      .select("id, name, phone, observacoes")
      .is("perfil_profissional", null)
      .limit(BATCH_SIZE * 2);

    if (!contatosSemPerfil || contatosSemPerfil.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "Nenhum contato para classificar", classificados: 0, erros: 0, restantes: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Contar mensagens por contato para priorizar
    const contatosComMsgs: Array<{ id: string; name: string | null; phone: string; observacoes: string | null; totalMsgs: number }> = [];

    for (const contato of contatosSemPerfil) {
      const { count } = await supabase
        .from("messages")
        .select("id", { count: 'exact', head: true })
        .eq("contact_id", contato.id);

      contatosComMsgs.push({ ...contato, totalMsgs: count || 0 });
    }

    contatosComMsgs.sort((a, b) => b.totalMsgs - a.totalMsgs);
    const batch = contatosComMsgs.slice(0, BATCH_SIZE);

    // Contar total restante sem perfil
    const { count: totalSemPerfil } = await supabase
      .from("contacts")
      .select("id", { count: 'exact', head: true })
      .is("perfil_profissional", null);

    console.log(`[LOTE] Processando ${batch.length} contatos (${totalSemPerfil} sem classificação total)`);

    let classificados = 0;
    let erros = 0;

    for (const contato of batch) {
      try {
        // Buscar últimas 20 mensagens
        const { data: messages } = await supabase
          .from("messages")
          .select("text, from_me")
          .eq("contact_id", contato.id)
          .not("text", "is", null)
          .order("created_at", { ascending: false })
          .limit(20);

        const historicoMsgs = (messages || [])
          .reverse()
          .map(m => `${m.from_me ? 'Maikon' : (contato.name || 'Contato')}: ${m.text}`)
          .join('\n');

        const prompt = `Classifique este contato do WhatsApp de um cirurgião cardíaco (Dr. Maikon Madeira, Itajaí/SC).

Nome: ${contato.name || 'Desconhecido'}
${contato.observacoes ? `Obs: ${contato.observacoes}` : ''}

Mensagens recentes:
${historicoMsgs || '(sem mensagens)'}

Perfis: ${PERFIS_VALIDOS.join(', ')}

Responda APENAS com JSON:
{"perfil":"valor","cargo":"cargo específico ou null","especialidade":"ou null","instituicao":"ou null","cidade":"ou null","relevancia":"alta|media|baixa","confianca":"alta|media|baixa","motivo":"breve"}`;

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: "Classifique contatos de WhatsApp. Responda apenas com JSON válido." },
              { role: "user", content: prompt },
            ],
            temperature: 0.3,
            max_tokens: 150,
          }),
        });

        if (!response.ok) {
          console.error(`[LOTE] Erro OpenAI para ${contato.id}:`, response.status);
          erros++;
          await sleep(DELAY_MS);
          continue;
        }

        const openaiData = await response.json();
        const rawText = openaiData?.choices?.[0]?.message?.content || "";
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
          console.error(`[LOTE] Sem JSON para ${contato.id}`);
          erros++;
          await sleep(DELAY_MS);
          continue;
        }

        const resultado = JSON.parse(jsonMatch[0]);
        const perfilValido = PERFIS_VALIDOS.includes(resultado.perfil) ? resultado.perfil : 'outro';

        const relevanciaValida = ['alta', 'media', 'baixa'].includes(resultado.relevancia) ? resultado.relevancia : 'media';

        await supabase
          .from("contacts")
          .update({
            perfil_profissional: perfilValido,
            cargo: resultado.cargo || null,
            especialidade: resultado.especialidade || null,
            instituicao: resultado.instituicao || null,
            cidade: resultado.cidade || null,
            relevancia: relevanciaValida,
            perfil_sugerido_ia: perfilValido,
            perfil_confirmado: false,
            classificado_em: new Date().toISOString(),
          })
          .eq("id", contato.id);

        classificados++;
        console.log(`[LOTE] ${contato.name || contato.phone} → ${perfilValido} (${resultado.confianca})`);

      } catch (err) {
        console.error(`[LOTE] Erro em ${contato.id}:`, err);
        erros++;
      }

      await sleep(DELAY_MS);
    }

    const restantes = (totalSemPerfil || 0) - classificados;
    console.log(`[LOTE] Concluído: ${classificados} classificados, ${erros} erros, ${restantes} restantes`);

    return new Response(
      JSON.stringify({
        success: true,
        classificados,
        erros,
        restantes: Math.max(0, restantes),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: unknown) {
    console.error("[LOTE] Erro geral:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
