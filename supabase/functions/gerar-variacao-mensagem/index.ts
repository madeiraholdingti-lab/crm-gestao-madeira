import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { mensagemBase, tipoCampanha, quantidade = 5 } = await req.json();

    if (!mensagemBase) {
      return new Response(
        JSON.stringify({ error: "Mensagem base é obrigatória" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");

    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY não configurada" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const systemPrompt = `Você é um especialista em marketing e comunicação via WhatsApp.
Sua tarefa é criar ${quantidade} variações ÚNICAS de uma mensagem para envio em massa.

REGRAS IMPORTANTES:
1. Cada variação deve ter o MESMO SIGNIFICADO, mas com palavras e estrutura DIFERENTES
2. Use sinônimos, reordenação de frases, diferentes aberturas e fechamentos
3. Mantenha um tom ${tipoCampanha === 'promocional' ? 'comercial mas amigável' : tipoCampanha === 'relacionamento' ? 'pessoal e próximo' : tipoCampanha === 'reativacao' ? 'gentil e convidativo' : 'profissional mas acolhedor'}
4. Se houver {nome} na mensagem, MANTENHA exatamente assim para personalização
5. Evite repetir as mesmas palavras no início das mensagens
6. Varie entre usar emojis e não usar, ou usar diferentes emojis
7. As mensagens devem parecer naturais, como se fossem escritas por uma pessoa real
8. NÃO use formatação markdown, apenas texto puro

Retorne APENAS um JSON válido no formato:
{
  "variacoes": ["mensagem1", "mensagem2", "mensagem3", ...]
}`;

    console.log(`Gerando ${quantidade} variações para campanha tipo: ${tipoCampanha}`);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Mensagem original para criar variações:\n\n"${mensagemBase}"` },
        ],
        temperature: 0.9,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Erro da API OpenAI:", response.status, errorText);

      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns segundos." }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 401) {
        return new Response(
          JSON.stringify({ error: "OPENAI_API_KEY inválida. Verifique nas configurações." }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ error: "Erro ao gerar variações" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      console.error("Resposta vazia da API");
      return new Response(
        JSON.stringify({ error: "Resposta vazia da IA" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse JSON from response
    let variacoes: string[] = [];
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        variacoes = parsed.variacoes || [];
      }
    } catch (parseError) {
      console.error("Erro ao parsear resposta:", parseError);
      variacoes = content
        .split('\n')
        .filter((line: string) => line.trim().length > 10)
        .slice(0, quantidade);
    }

    console.log(`Geradas ${variacoes.length} variações com sucesso`);

    return new Response(
      JSON.stringify({ variacoes, mensagemOriginal: mensagemBase }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("Erro na função:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
