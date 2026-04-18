import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Lista de nomes de instância que devem ser ignorados como nomes de contato
const BLOCKLIST_NAMES = [
  'isadoravolek',
  'isadora volek',
  'isadora',
  'dr. maikon madeira',
  'maikon madeira',
  'maikon madeira gss',
  'dr maikon',
  'helen',
  'iza',
  'dr. paulo pucci azambuja emergência',
  'dr. paulo pucci azambuja emergencia',
  'paulo pucci',
  'rubi',
  'disparos cardiologista',
  'disparos3367',
  'maikon gss',
  'pacientesrafaela',
];

function isBlockedName(name: string | null): boolean {
  if (!name) return false;
  const normalized = name.toLowerCase().trim();
  return BLOCKLIST_NAMES.some(blocked => 
    normalized === blocked || 
    normalized.includes(blocked) ||
    blocked.includes(normalized)
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const { contact_id, phone } = body;

    if (!contact_id && !phone) {
      return new Response(
        JSON.stringify({ error: 'contact_id ou phone é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Buscar configuração global
    const { data: configData, error: configError } = await supabase
      .from('config_global')
      .select('evolution_base_url, evolution_api_key')
      .single();

    if (configError || !configData) {
      console.error('[SYNC-INDIVIDUAL] Erro ao buscar configuração:', configError);
      return new Response(
        JSON.stringify({ error: 'Configuração não encontrada' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const evolutionUrl = configData.evolution_base_url;
    const evolutionApiKey = configData.evolution_api_key;

    // Buscar contato
    let contactQuery = supabase.from('contacts').select('*');
    if (contact_id) {
      contactQuery = contactQuery.eq('id', contact_id);
    } else {
      contactQuery = contactQuery.eq('phone', phone);
    }
    
    const { data: contact, error: contactError } = await contactQuery.maybeSingle();

    if (contactError || !contact) {
      return new Response(
        JSON.stringify({ error: 'Contato não encontrado' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Buscar instâncias conectadas
    const { data: instancias } = await supabase
      .from('instancias_whatsapp')
      .select('id, nome_instancia')
      .eq('status', 'ativa')
      .eq('connection_status', 'open');

    let instanciasConectadas: any[] = [];
    
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
        const connectedNames = (evolutionData || [])
          .filter((inst: any) => inst.connectionStatus === 'open' || inst.state === 'open')
          .map((inst: any) => inst.name || inst.instanceName);
        
        instanciasConectadas = (instancias || []).filter(i => 
          connectedNames.includes(i.nome_instancia)
        );
      }
    } catch (err) {
      console.error('[SYNC-INDIVIDUAL] Erro ao buscar instâncias:', err);
      instanciasConectadas = instancias || [];
    }

    if (instanciasConectadas.length === 0) {
      return new Response(
        JSON.stringify({ success: false, message: 'Nenhuma instância conectada' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let updatedPhoto = false;
    let updatedName = false;
    let newPhoto: string | null = null;
    let newName: string | null = null;

    // Tentar buscar foto e nome de cada instância
    for (const instancia of instanciasConectadas) {
      // Buscar foto
      if (!updatedPhoto && (!contact.profile_picture_url || contact.profile_picture_url === 'NO_PICTURE')) {
        try {
          const photoResponse = await fetch(`${evolutionUrl}/chat/fetchProfilePictureUrl/${instancia.nome_instancia}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': evolutionApiKey,
            },
            body: JSON.stringify({ number: contact.phone }),
          });

          if (photoResponse.ok) {
            const photoData = await photoResponse.json();
            const pictureUrl = photoData.profilePictureUrl || photoData.picture || photoData.url;
            if (pictureUrl && pictureUrl !== 'NO_PICTURE') {
              newPhoto = pictureUrl;
              updatedPhoto = true;
            }
          }
        } catch (err) {
          console.error('[SYNC-INDIVIDUAL] Erro ao buscar foto:', err);
        }
      }

      // Buscar nome se o atual for nulo, vazio, ou bloqueado
      const currentName = contact.name;
      const needsNameUpdate = !currentName || 
        currentName.trim() === '' || 
        currentName === contact.phone ||
        isBlockedName(currentName);

      if (!updatedName && needsNameUpdate) {
        try {
          // Tentar múltiplos formatos de JID
          const jidFormats = [
            contact.jid,
            `${contact.phone}@s.whatsapp.net`,
            contact.phone,
          ].filter(Boolean);

          for (const jid of jidFormats) {
            const contactsResponse = await fetch(`${evolutionUrl}/chat/findContacts/${instancia.nome_instancia}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'apikey': evolutionApiKey,
              },
              body: JSON.stringify({ where: { id: jid } }),
            });

            if (contactsResponse.ok) {
              const contactsData = await contactsResponse.json();
              const foundContact = Array.isArray(contactsData) ? contactsData[0] : contactsData;
              const pushName = foundContact?.pushName || foundContact?.name || foundContact?.notify;
              
              if (pushName && !isBlockedName(pushName)) {
                newName = pushName;
                updatedName = true;
                break;
              }
            }
          }
        } catch (err) {
          console.error('[SYNC-INDIVIDUAL] Erro ao buscar nome:', err);
        }
      }

      // Se já temos tudo, sair do loop
      if ((updatedPhoto || contact.profile_picture_url) && (updatedName || !needsNameUpdate)) {
        break;
      }

      // Pequeno delay
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Atualizar contato no banco
    const updates: any = { updated_at: new Date().toISOString() };
    if (newPhoto) updates.profile_picture_url = newPhoto;
    if (newName) updates.name = newName;

    if (Object.keys(updates).length > 1) {
      const { error: updateError } = await supabase
        .from('contacts')
        .update(updates)
        .eq('id', contact.id);

      if (updateError) {
        console.error('[SYNC-INDIVIDUAL] Erro ao atualizar contato:', updateError);
      } else {
        // Atualizar também na tabela conversas
        const conversaUpdates: any = { updated_at: new Date().toISOString() };
        if (newPhoto) conversaUpdates.foto_contato = newPhoto;
        if (newName) conversaUpdates.nome_contato = newName;

        await supabase
          .from('conversas')
          .update(conversaUpdates)
          .eq('numero_contato', contact.phone);
      }
    }

    console.log(`[SYNC-INDIVIDUAL] Contato ${contact.phone}: foto=${!!newPhoto}, nome=${newName || 'não atualizado'}`);

    return new Response(
      JSON.stringify({ 
        success: true,
        contact_id: contact.id,
        updated_photo: updatedPhoto,
        updated_name: updatedName,
        new_photo: newPhoto,
        new_name: newName,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[SYNC-INDIVIDUAL] Erro geral:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
