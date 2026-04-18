import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { instanceNames } = await req.json();

    if (!instanceNames || !Array.isArray(instanceNames)) {
      return new Response(
        JSON.stringify({ error: "instanceNames array required" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: config, error: configError } = await supabase
      .from('config_global')
      .select('evolution_base_url, evolution_api_key')
      .single();

    if (configError || !config) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch config" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const evolutionApiKey = config.evolution_api_key;
    const evolutionBaseUrl = config.evolution_base_url;

    if (!evolutionApiKey || !evolutionBaseUrl) {
      return new Response(
        JSON.stringify({ error: "Evolution API not configured" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results: Record<string, { url: string | null; enabled: boolean }> = {};

    await Promise.all(
      instanceNames.map(async (name: string) => {
        try {
          const encoded = encodeURIComponent(name);
          const resp = await fetch(`${evolutionBaseUrl}/webhook/find/${encoded}`, {
            method: 'GET',
            headers: {
              'apikey': evolutionApiKey,
              'Content-Type': 'application/json',
            },
          });

          if (resp.ok) {
            const data = await resp.json();
            // Evolution API may return different formats
            const webhookUrl = data?.webhook?.url || data?.url || data?.[0]?.url || null;
            const enabled = data?.webhook?.enabled ?? data?.enabled ?? data?.[0]?.enabled ?? false;
            results[name] = { url: webhookUrl, enabled };
          } else {
            results[name] = { url: null, enabled: false };
          }
        } catch (e) {
          console.error(`Error fetching webhook for ${name}:`, e);
          results[name] = { url: null, enabled: false };
        }
      })
    );

    return new Response(
      JSON.stringify({ success: true, webhooks: results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
