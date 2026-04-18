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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { contact_id, contexto_extra } = await req.json();

    if (!contact_id) {
      return new Response(
        JSON.stringify({ error: "contact_id é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    // Buscar contato
    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("id, name, phone, tipo_contato, observacoes")
      .eq("id", contact_id)
      .single();

    if (contactError || !contact) {
      return new Response(
        JSON.stringify({ error: "Contato não encontrado" }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Buscar últimas 20 mensagens
    const { data: messages } = await supabase
      .from("messages")
      .select("text, from_me, created_at")
      .eq("contact_id", contact_id)
      .not("text", "is", null)
      .order("created_at", { ascending: false })
      .limit(20);

    const historicoMsgs = (messages || [])
      .reverse()
      .map(m => `${m.from_me ? 'Maikon' : (contact.name || 'Contato')}: ${m.text}`)
      .join('\n');

    // Buscar instância da conversa mais recente para contexto
    const { data: conversa } = await supabase
      .from("conversas")
      .select("instancia_id, instancias_whatsapp(nome_instancia)")
      .eq("contact_id", contact_id)
      .order("ultima_interacao", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nomeInstancia = (conversa as any)?.instancias_whatsapp?.nome_instancia || '';

    const prompt = `Você é um assistente do Dr. Maikon Madeira, cirurgião cardíaco em Itajaí/SC. Analise as informações abaixo e classifique o perfil profissional deste contato de WhatsApp.

Nome: ${contact.name || 'Desconhecido'}
Telefone: ${contact.phone}
${contact.observacoes ? `Observações: ${contact.observacoes}` : ''}
${nomeInstancia ? `Número WhatsApp que recebeu: ${nomeInstancia}` : ''}
${contexto_extra ? `\nContexto adicional do usuário: ${contexto_extra}` : ''}

Histórico recente de mensagens:
${historicoMsgs || '(sem mensagens)'}

Classifique este contato. Perfis possíveis: ${PERFIS_VALIDOS.join(', ')}

Responda APENAS com JSON válido:
{
  "perfil": "um dos valores da lista acima",
  "cargo": "cargo/função específica se identificável (ex: Coordenador UTI, Diretor Clínico), ou null",
  "especialidade": "especialidade médica se aplicável, ou null",
  "instituicao": "hospital/clínica/empresa mencionada, ou null",
  "cidade": "cidade se mencionada ou inferível pelo DDD, ou null",
  "relevancia": "alta (decisor, diretor, médico próximo) | media (contato profissional regular) | baixa (contato esporádico)",
  "confianca": "alta|media|baixa",
  "motivo": "explicação curta de 1 linha"
}`;

    // Chamar OpenAI GPT-4o-mini
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Você classifica contatos de WhatsApp de um cirurgião cardíaco. Responda apenas com JSON válido." },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("[CLASSIFICAR] Erro OpenAI:", response.status, errBody);
      return new Response(
        JSON.stringify({ error: "Erro ao chamar OpenAI", details: errBody }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const openaiData = await response.json();
    const rawText = openaiData?.choices?.[0]?.message?.content || "";

    // Extrair JSON da resposta
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[CLASSIFICAR] Resposta sem JSON:", rawText);
      return new Response(
        JSON.stringify({ error: "IA não retornou formato válido", raw: rawText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const resultado = JSON.parse(jsonMatch[0]);
    const perfilValido = PERFIS_VALIDOS.includes(resultado.perfil) ? resultado.perfil : 'outro';

    // Validar relevância
    const relevanciaValida = ['alta', 'media', 'baixa'].includes(resultado.relevancia) ? resultado.relevancia : 'media';

    // Gravar direto no contato
    const { error: updateError } = await supabase
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
      .eq("id", contact_id);

    if (updateError) {
      console.error("[CLASSIFICAR] Erro ao salvar:", updateError);
    }

    return new Response(
      JSON.stringify({
        contact_id,
        perfil: perfilValido,
        cargo: resultado.cargo || null,
        especialidade: resultado.especialidade || null,
        instituicao: resultado.instituicao || null,
        cidade: resultado.cidade || null,
        relevancia: relevanciaValida,
        confianca: resultado.confianca || "media",
        motivo: resultado.motivo || "",
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: unknown) {
    console.error("[CLASSIFICAR] Erro:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
