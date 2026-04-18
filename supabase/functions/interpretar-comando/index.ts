import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { texto, user_id, contexto } = await req.json();

    if (!texto || !user_id) {
      return new Response(
        JSON.stringify({ error: "texto e user_id são obrigatórios" }),
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

    // Buscar perfis do TaskFlow para resolver nomes
    const { data: profiles } = await supabase
      .from("task_flow_profiles")
      .select("id, nome, user_id")
      .eq("ativo", true);

    const profilesList = (profiles || [])
      .map(p => `- "${p.nome}" = profile_id: ${p.id}`)
      .join('\n');

    // Data atual em formato Brasil
    const agora = new Date();
    const dataAtual = agora.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    let contextoExtra = "";
    if (contexto?.conversa_id) {
      const { data: conv } = await supabase
        .from("conversas")
        .select("nome_contato, numero_contato")
        .eq("id", contexto.conversa_id)
        .single();
      if (conv) {
        contextoExtra = `\nContexto: está dentro da conversa com ${conv.nome_contato || conv.numero_contato}`;
      }
    }

    const userPrompt = `Usuários do sistema (TaskFlow):
${profilesList}
- "eu" ou "Maikon" = o próprio usuário (user_id: ${user_id})

Data atual: ${dataAtual}
${contextoExtra}

Comando: "${texto}"

REGRAS:
- Se menciona uma pessoa + ação + prazo → tipo "tarefa"
- Se é um lembrete pessoal (me avisa, me lembra) → tipo "lembrete"
- Se é sobre acompanhar uma conversa/contato → tipo "follow_up"
- Se não conseguir interpretar → tipo "nao_entendeu"
- Para prazos relativos: "amanhã" = dia seguinte, "sexta" = próxima sexta-feira
- Converter prazos para formato ISO 8601 (YYYY-MM-DDTHH:MM:SS)
- Se não há horário específico, usar 09:00 como padrão

Responda APENAS com JSON válido:
{
  "tipo": "tarefa|lembrete|follow_up|nao_entendeu",
  "dados": {
    "titulo": "título curto da ação",
    "descricao": "detalhes extras ou null",
    "responsavel_id": "profile_id do responsável ou null",
    "responsavel_nome": "nome do responsável ou null",
    "prazo": "ISO 8601 datetime ou null",
    "conversa_id": "${contexto?.conversa_id || 'null'}"
  },
  "confianca": "alta|media|baixa",
  "confirmacao_texto": "frase legível do que vai fazer (ex: Criar tarefa 'Enviar receita' para Iza até sexta 27/03)"
}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Você é um assistente do Dr. Maikon Madeira, cirurgião cardíaco. Interprete comandos em linguagem natural e retorne a ação estruturada como JSON." },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 400,
      }),
    });

    if (!response.ok) {
      console.error("[COMANDO] Erro OpenAI:", response.status);
      return new Response(
        JSON.stringify({
          tipo: "nao_entendeu",
          dados: {},
          confianca: "baixa",
          confirmacao_texto: "Não consegui interpretar. Tente: 'Tarefa para Iza: enviar exames até sexta'"
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const openaiData = await response.json();
    const rawText = openaiData?.choices?.[0]?.message?.content || "";

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return new Response(
        JSON.stringify({
          tipo: "nao_entendeu",
          dados: {},
          confianca: "baixa",
          confirmacao_texto: "Não consegui interpretar. Tente: 'Tarefa para Iza: enviar exames até sexta'"
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const resultado = JSON.parse(jsonMatch[0]);

    return new Response(
      JSON.stringify(resultado),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: unknown) {
    console.error("[COMANDO] Erro:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
