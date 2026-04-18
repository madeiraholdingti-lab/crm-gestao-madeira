import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const payload = await req.json();
    
    console.log('=== N8N Instance Events Webhook ===');
    console.log('Payload recebido:', JSON.stringify(payload, null, 2));

    // Extrair informações do payload da Evolution API
    const event = payload.event || payload.type || 'unknown';
    const instanceName = payload.instance || payload.instanceName || payload.data?.instance || '';
    const instanceUuid = payload.instanceId || payload.instance_uuid || payload.data?.instanceId || '';
    
    console.log(`Evento: ${event}, Instância: ${instanceName}, UUID: ${instanceUuid}`);

    // 1. Registrar o evento na tabela instance_events
    const { data: eventData, error: eventError } = await supabase
      .from('instance_events')
      .insert({
        instance_name: instanceName,
        instance_uuid: instanceUuid,
        event: event,
        payload: payload
      })
      .select()
      .single();

    if (eventError) {
      console.error('Erro ao inserir evento:', eventError);
    } else {
      console.log('Evento registrado com ID:', eventData?.id);
    }

    // 2. Processar eventos específicos para atualizar a instância
    let updateData: Record<string, any> = {};
    let shouldUpdate = false;

    // Evento de QRCode
    if (event === 'qrcode.updated' || event === 'QRCODE_UPDATED') {
      const qrcode = payload.qrcode || payload.data?.qrcode || payload.data?.base64 || '';
      if (qrcode) {
        updateData.qrcode_base64 = qrcode;
        updateData.qrcode_updated_at = new Date().toISOString();
        updateData.connection_status = 'awaiting_scan';
        shouldUpdate = true;
        console.log('QRCode atualizado para instância:', instanceName);
      }
    }

    // Evento de status/conexão
    if (event === 'status.instance' || event === 'STATUS_INSTANCE' || 
        event === 'connection.update' || event === 'CONNECTION_UPDATE') {
      
      // Extrair status do payload (vários formatos possíveis da Evolution API)
      const status = payload.status || 
                     payload.data?.status || 
                     payload.data?.state ||
                     payload.state ||
                     payload.data?.connection?.state ||
                     '';
      
      const connectionStatus = payload.data?.connection?.state || 
                               payload.data?.state ||
                               payload.connection?.state ||
                               status;

      if (connectionStatus) {
        // Mapear status da Evolution para status interno
        let mappedStatus = 'disconnected';
        const lowerStatus = connectionStatus.toLowerCase();
        
        if (lowerStatus === 'open' || lowerStatus === 'connected' || lowerStatus === 'online') {
          mappedStatus = 'connected';
          // Limpar QRCode quando conectado
          updateData.qrcode_base64 = null;
        } else if (lowerStatus === 'connecting' || lowerStatus === 'pairing') {
          mappedStatus = 'connecting';
        } else if (lowerStatus === 'close' || lowerStatus === 'disconnected' || lowerStatus === 'offline') {
          mappedStatus = 'disconnected';
        } else if (lowerStatus === 'qr' || lowerStatus === 'qrcode') {
          mappedStatus = 'awaiting_scan';
        }

        updateData.connection_status = mappedStatus;
        updateData.status = mappedStatus === 'connected' ? 'ativa' : 'inativa';
        shouldUpdate = true;
        console.log(`Status atualizado para instância ${instanceName}: ${mappedStatus}`);
      }

      // Capturar número do chip se vier no evento de conexão
      const phoneNumber = payload.data?.instance?.owner || 
                          payload.data?.wuid?.split('@')[0] ||
                          payload.data?.me?.id?.split(':')[0] ||
                          '';
      
      if (phoneNumber) {
        updateData.numero_chip = phoneNumber;
        console.log(`Número do chip atualizado: ${phoneNumber}`);
      }
    }

    // 3. Atualizar a instância se houver dados para atualizar
    if (shouldUpdate && instanceName) {
      // Primeiro tentar por instancia_id (Evolution API ID)
      let { data: instancia, error: findError } = await supabase
        .from('instancias_whatsapp')
        .select('id')
        .eq('instancia_id', instanceName)
        .single();

      // Se não encontrar, tentar por nome_instancia
      if (!instancia) {
        const result = await supabase
          .from('instancias_whatsapp')
          .select('id')
          .eq('nome_instancia', instanceName)
          .single();
        
        instancia = result.data;
        findError = result.error;
      }

      if (instancia) {
        const { error: updateError } = await supabase
          .from('instancias_whatsapp')
          .update({
            ...updateData,
            updated_at: new Date().toISOString()
          })
          .eq('id', instancia.id);

        if (updateError) {
          console.error('Erro ao atualizar instância:', updateError);
        } else {
          console.log('Instância atualizada com sucesso:', instancia.id);
        }
      } else {
        console.log('Instância não encontrada no banco:', instanceName);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Evento processado com sucesso',
        event: event,
        instance_name: instanceName,
        event_id: eventData?.id
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('Erro no n8n-instance-events:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});
