import "https://deno.land/x/xhr@0.1.0/mod.ts";
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
    const { telefoneResponsavel, nomeResponsavel, numeroContato, nomeContato, anotacao, instanceId } = await req.json();

    if (!telefoneResponsavel || !nomeResponsavel || !numeroContato || !instanceId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Enviando notificação de delegação para: ${telefoneResponsavel}`);

    const evolutionApiKey = Deno.env.get('EVOLUTION_API_KEY');
    
    if (!evolutionApiKey) {
      console.error("EVOLUTION_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Evolution API key not configured" }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const evolutionBaseUrl = "https://honourless-reusable-mercedez.ngrok-free.dev";
    const sendUrl = `${evolutionBaseUrl}/message/sendText/${encodeURIComponent(instanceId)}`;

    // Montar mensagem de notificação
    const mensagem = `🚨 NOVA OPORTUNIDADE DE ATENDIMENTO 🚨\n\nResponsabilidade: ${nomeResponsavel}\nContato: wa.me/${numeroContato}\nNome: ${nomeContato || 'Sem nome'}\n${anotacao ? `\nInstrução: ${anotacao}` : ''}`;

    const payload = {
      number: telefoneResponsavel,
      text: mensagem
    };

    console.log('Enviando notificação:', payload);

    const response = await fetch(sendUrl, {
      method: 'POST',
      headers: {
        'apikey': evolutionApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error(`Evolution API error: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error('Error details:', errorText);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `API returned ${response.status}`,
          details: errorText
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const data = await response.json();
    console.log(`Notificação enviada com sucesso:`, data);

    return new Response(
      JSON.stringify({ 
        success: true,
        data: data
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Erro ao enviar notificação:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
