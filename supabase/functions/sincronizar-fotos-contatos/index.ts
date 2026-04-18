import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Buscar configuração global (Evolution API)
    const { data: configData, error: configError } = await supabase
      .from('config_global')
      .select('evolution_base_url, evolution_api_key')
      .single();

    if (configError || !configData) {
      console.error('[SYNC-FOTOS] Erro ao buscar configuração:', configError);
      return new Response(
        JSON.stringify({ error: 'Configuração não encontrada' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const evolutionUrl = configData.evolution_base_url;
    const evolutionApiKey = configData.evolution_api_key;

    if (!evolutionUrl || !evolutionApiKey) {
      return new Response(
        JSON.stringify({ error: 'Evolution API não configurada' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Pegar parâmetros da requisição
    const body = await req.json().catch(() => ({}));
    const limit = body.limit || 50;

    // Buscar TODAS as instâncias do banco de dados
    const { data: instancias, error: instanciasError } = await supabase
      .from('instancias_whatsapp')
      .select('id, nome_instancia, instancia_id, status, connection_status')
      .neq('status', 'deletada');

    if (instanciasError) {
      console.error('[SYNC-FOTOS] Erro ao buscar instâncias:', instanciasError);
      return new Response(
        JSON.stringify({ error: 'Erro ao buscar instâncias' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Buscar instâncias conectadas na Evolution API
    let instanciasConectadas: string[] = [];
    try {
      const evolutionResponse = await fetch(`${evolutionUrl}/instance/fetchInstances`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'apikey': evolutionApiKey,
        },
      });

      if (evolutionResponse.ok) {
        const evolutionData = await evolutionResponse.json();
        // Filtrar apenas instâncias conectadas (open)
        instanciasConectadas = (evolutionData || [])
          .filter((inst: any) => inst.connectionStatus === 'open' || inst.state === 'open')
          .map((inst: any) => inst.name || inst.instanceName);
        
        console.log(`[SYNC-FOTOS] Instâncias conectadas na Evolution: ${instanciasConectadas.join(', ')}`);
      }
    } catch (err) {
      console.error('[SYNC-FOTOS] Erro ao buscar instâncias da Evolution:', err);
    }

    // Se não conseguiu buscar da Evolution, usar todas as instâncias do banco
    const instanciasParaUsar = instanciasConectadas.length > 0 
      ? (instancias || []).filter(i => instanciasConectadas.includes(i.nome_instancia))
      : (instancias || []).filter(i => i.status === 'ativa');

    console.log(`[SYNC-FOTOS] Usando ${instanciasParaUsar.length} instâncias para sincronização`);

    if (instanciasParaUsar.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Nenhuma instância conectada encontrada' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Buscar contatos sem foto de perfil (priorizar os mais recentes)
    const { data: contacts, error: contactsError } = await supabase
      .from('contacts')
      .select('id, phone, jid, name, profile_picture_url')
      .or('profile_picture_url.is.null,profile_picture_url.eq.')
      .not('jid', 'ilike', '%@g.us')
      .not('jid', 'ilike', '%@broadcast')
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (contactsError) {
      console.error('[SYNC-FOTOS] Erro ao buscar contatos:', contactsError);
      return new Response(
        JSON.stringify({ error: 'Erro ao buscar contatos' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[SYNC-FOTOS] Encontrados ${contacts?.length || 0} contatos sem foto`);

    let successCount = 0;
    let failCount = 0;
    const results: { phone: string; success: boolean; instance?: string; error?: string }[] = [];

    for (const contact of contacts || []) {
      let updated = false;

      // Tentar com cada instância conectada até conseguir
      for (const instancia of instanciasParaUsar) {
        if (updated) break;

        try {
          // Chamar Evolution API para buscar foto de perfil
          const response = await fetch(`${evolutionUrl}/chat/fetchProfilePictureUrl/${instancia.nome_instancia}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': evolutionApiKey,
            },
            body: JSON.stringify({
              number: contact.phone,
            }),
          });

          if (!response.ok) {
            continue; // Tentar próxima instância
          }

          const data = await response.json();
          const profilePictureUrl = data.profilePictureUrl || data.picture || data.url;

          if (profilePictureUrl) {
            // Atualizar contato com a URL da foto
            const { error: updateError } = await supabase
              .from('contacts')
              .update({ 
                profile_picture_url: profilePictureUrl,
                updated_at: new Date().toISOString()
              })
              .eq('id', contact.id);

            if (!updateError) {
              // Também atualizar na tabela conversas
              await supabase
                .from('conversas')
                .update({ 
                  foto_contato: profilePictureUrl,
                  updated_at: new Date().toISOString()
                })
                .eq('numero_contato', contact.phone);

              successCount++;
              updated = true;
              results.push({ phone: contact.phone, success: true, instance: instancia.nome_instancia });
              console.log(`[SYNC-FOTOS] Foto atualizada para ${contact.phone} (via ${instancia.nome_instancia})`);
            }
          }

          // Pequeno delay entre chamadas
          await new Promise(resolve => setTimeout(resolve, 100));

        } catch (err) {
          // Continuar com próxima instância
          continue;
        }
      }

      if (!updated) {
        // Marcar como tentativa feita (para não tentar novamente imediatamente)
        await supabase
          .from('contacts')
          .update({ 
            profile_picture_url: 'NO_PICTURE',
            updated_at: new Date().toISOString()
          })
          .eq('id', contact.id);
        
        failCount++;
        results.push({ phone: contact.phone, success: false, error: 'Nenhuma instância retornou foto' });
      }

      // Delay entre contatos
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    console.log(`[SYNC-FOTOS] Concluído: ${successCount} sucesso, ${failCount} falhas`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        processed: contacts?.length || 0,
        instanciasUsadas: instanciasParaUsar.map(i => i.nome_instancia),
        successCount,
        failCount,
        updated: successCount,
        results 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[SYNC-FOTOS] Erro geral:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
