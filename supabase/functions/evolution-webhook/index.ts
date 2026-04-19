import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Blocklist de nomes de instância que não devem ser usados como nome de contato
    const BLOCKLIST_NAMES = [
      'isadoravolek', 'isadora volek', 'isadora',
      'dr. maikon madeira', 'maikon madeira', 'maikon madeira gss', 'dr maikon',
      'helen', 'iza',
      'dr. paulo pucci azambuja emergência', 'dr. paulo pucci azambuja emergencia',
      'paulo pucci', 'rubi', 'disparos cardiologista', 'disparos3367',
      'maikon gss', 'pacientesrafaela',
    ];

    function isBlockedName(name: string | null): boolean {
      if (!name) return true;
      const normalized = name.toLowerCase().trim();
      return BLOCKLIST_NAMES.some(blocked => 
        normalized === blocked || normalized.includes(blocked) || blocked.includes(normalized)
      );
    }

    // Normalizar telefone brasileiro: gera variações com/sem o 9 extra
    function getPhoneVariations(phone: string): string[] {
      const variations = [phone];
      // Formato: 55 + DDD(2) + 9 + número(8) = 13 dígitos após 55
      // Se tem 13 dígitos e começa com 55, pode ter o 9 extra
      if (phone.startsWith('55') && phone.length === 13) {
        // Adicionar o 9: 55 + DD + 9 + XXXXXXXX
        const withNine = phone.slice(0, 4) + '9' + phone.slice(4);
        variations.push(withNine);
      }
      // Se tem 14 dígitos (55 + DD + 9 + 8 dígitos), remover o 9
      if (phone.startsWith('55') && phone.length === 14) {
        const withoutNine = phone.slice(0, 4) + phone.slice(5);
        variations.push(withoutNine);
      }
      return variations;
    }

    const webhookData = await req.json();
    console.log('Webhook recebido:', JSON.stringify(webhookData, null, 2));

    // Processar mensagens recebidas E enviadas
    if (webhookData.event === 'messages.upsert' || webhookData.event === 'message.received') {
      const message = webhookData.data;
      const instanceId = webhookData.instance;

      if (!message || !message.key || !message.key.remoteJid) {
        console.log('Mensagem sem dados válidos, ignorando');
        return new Response(JSON.stringify({ status: 'ignored' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const isFromMe = message.key.fromMe === true;
      const waMessageId = message.key?.id;

      // Early return para mensagens enviadas pelo próprio sistema (fromMe)
      // Mensagens fromMe são processadas pelo evolution-messages-webhook (tabela messages)
      // Aqui só precisamos processar se for um disparo em massa (para rastrear wa_message_id)
      if (isFromMe) {
        // Verificar rapidamente se é disparo em massa antes de processar
        if (waMessageId) {
          const supabaseUrl2 = Deno.env.get('SUPABASE_URL')!;
          const supabaseServiceKey2 = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const sbCheck = createClient(supabaseUrl2, supabaseServiceKey2);
          const { data: campanhaEnvio } = await sbCheck
            .from('campanha_envios')
            .select('id')
            .eq('wa_message_id', waMessageId)
            .maybeSingle();

          if (!campanhaEnvio) {
            console.log(`Mensagem fromMe (não é disparo), ignorando — processada pelo evolution-messages-webhook`);
            return new Response(JSON.stringify({ status: 'ignored', reason: 'fromMe_not_disparo' }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          console.log(`Mensagem fromMe identificada como DISPARO, processando...`);
        } else {
          console.log(`Mensagem fromMe sem wa_message_id, ignorando`);
          return new Response(JSON.stringify({ status: 'ignored', reason: 'fromMe_no_id' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      // Extrair número do contato do remoteJid
      const numeroContato = message.key.remoteJid.replace('@s.whatsapp.net', '').replace('@lid', '');
      const conteudoMensagem = message.message?.conversation ||
                               message.message?.extendedTextMessage?.text ||
                               message.message?.imageMessage?.caption ||
                               '[Mídia não suportada]';

      console.log(`Processando mensagem ${isFromMe ? 'ENVIADA (disparo)' : 'RECEBIDA'} de/para ${numeroContato}: ${conteudoMensagem.substring(0, 50)}...`);

      // Buscar a instância WhatsApp
      const { data: instanciaData, error: instanciaError } = await supabase
        .from('instancias_whatsapp')
        .select('id, nome_instancia')
        .eq('instancia_id', instanceId)
        .single();

      if (instanciaError) {
        console.error('Erro ao buscar instância:', instanciaError);
        return new Response(JSON.stringify({ error: 'Instância não encontrada' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Se chegou aqui com fromMe, é disparo (já verificado no early return acima)
      const isDisparo = isFromMe;

      // Buscar conversa existente usando variações do número (com/sem 9)
      const phoneVariations = getPhoneVariations(numeroContato);
      console.log(`Buscando conversa para variações de número:`, phoneVariations);
      
      let { data: conversaData, error: conversaError } = await supabase
        .from('conversas')
        .select('id, unread_count, tags, numero_contato')
        .in('numero_contato', phoneVariations)
        .eq('instancia_id', instanciaData.id)
        .maybeSingle();

      if (conversaError && conversaError.code !== 'PGRST116') {
        console.error('Erro ao buscar conversa:', conversaError);
      }

      let conversaId;
      let currentUnreadCount = 0;
      let currentTags: string[] = [];
      const CLOSURE_PATTERNS = /^(ok|okay|obrigad[oa]|obg|vlw|valeu|blz|beleza|perfeito|combinado|certo|entendi|show|top|massa|boa|bom dia|boa tarde|boa noite|tá|ta|sim|não|nao|haha|kk|rs|kkk|👍|👌|🙏|😊|😁|❤|🤝|👏)$/i;
      const isClosure = !isFromMe && conteudoMensagem && CLOSURE_PATTERNS.test(conteudoMensagem.trim());

      if (!conversaData) {
        // Criar nova conversa
        console.log('Criando nova conversa...');
        
        // Se for disparo, adicionar tag "Disparo"
        const tagsIniciais = isDisparo ? ['Disparo'] : [];
        
        const { data: novaConversa, error: createError } = await supabase
          .from('conversas')
          .insert({
            numero_contato: numeroContato,
            nome_contato: isFromMe ? null : (isBlockedName(message.pushName) ? null : message.pushName),
            instancia_id: instanciaData.id,
            current_instance_id: instanciaData.id,
            orig_instance_id: instanciaData.id,
            status: 'novo',
            ultima_mensagem: conteudoMensagem,
            ultima_interacao: new Date().toISOString(),
            unread_count: isFromMe ? 0 : 1,
            last_message_from_me: isFromMe ? true : (isClosure ? null : false),
            tags: tagsIniciais,
          })
          .select('id')
          .single();

        if (createError) {
          console.error('Erro ao criar conversa:', createError);
          throw createError;
        }

        conversaId = novaConversa.id;
        console.log(`Nova conversa criada: ${conversaId}${isDisparo ? ' com tag Disparo' : ''}`);
      } else {
        conversaId = conversaData.id;
        currentUnreadCount = conversaData.unread_count || 0;
        currentTags = conversaData.tags || [];
        
        // Se for disparo e ainda não tem a tag "Disparo", adicionar
        let updatedTags = currentTags;
        if (isDisparo && !currentTags.includes('Disparo')) {
          updatedTags = [...currentTags, 'Disparo'];
          console.log('Adicionando tag Disparo à conversa existente');
        }
        
        // Atualizar conversa
        await supabase
          .from('conversas')
          .update({
            ultima_mensagem: conteudoMensagem,
            ultima_interacao: new Date().toISOString(),
            unread_count: isFromMe ? currentUnreadCount : currentUnreadCount + 1,
            last_message_from_me: isFromMe ? true : (isClosure ? null : false),
            tags: updatedTags,
          })
          .eq('id', conversaId);
        
        console.log(`Conversa atualizada: ${conversaId}, unread_count: ${isFromMe ? currentUnreadCount : currentUnreadCount + 1}`);
      }

      // Verificar se mensagem já existe (evitar duplicatas)
      if (waMessageId) {
        const { data: existingMsg } = await supabase
          .from('mensagens')
          .select('id')
          .eq('wa_message_id', waMessageId)
          .maybeSingle();
        
        if (existingMsg) {
          console.log(`Mensagem ${waMessageId} já existe, ignorando duplicata`);
          return new Response(
            JSON.stringify({ 
              success: true, 
              conversaId: conversaId,
              message: 'Mensagem já existente (duplicata ignorada)' 
            }),
            { 
              status: 200, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
      }

      // Inserir mensagem
      const { error: mensagemError } = await supabase
        .from('mensagens')
        .insert({
          conversa_id: conversaId,
          conteudo: conteudoMensagem,
          remetente: isFromMe ? 'enviada' : 'recebida',
          tipo_mensagem: 'texto',
          lida: isFromMe, // Mensagens enviadas são automaticamente lidas
          status: isFromMe ? 'SENT' : 'DELIVERED',
          wa_message_id: waMessageId,
        });

      if (mensagemError) {
        console.error('Erro ao inserir mensagem:', mensagemError);
        throw mensagemError;
      }

      console.log(`Mensagem ${isFromMe ? 'ENVIADA' : 'RECEBIDA'} registrada com sucesso`);

      return new Response(
        JSON.stringify({ 
          success: true, 
          conversaId: conversaId,
          isDisparo: isDisparo,
          message: `Mensagem ${isFromMe ? 'enviada' : 'recebida'} e processada` 
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Processar atualizações de status de mensagens
    if (webhookData.event === 'messages.update') {
      console.log('Atualização de status de mensagem:', JSON.stringify(webhookData.data, null, 2));
      
      const updates = Array.isArray(webhookData.data) ? webhookData.data : [webhookData.data];
      
      for (const update of updates) {
        const waMessageId = update.key?.id;
        const status = update.update?.status; // READ, DELIVERY_ACK, SERVER_ACK
        
        if (!waMessageId || !status) {
          console.log('Atualização sem ID ou status, ignorando');
          continue;
        }

        console.log(`Atualizando mensagem ${waMessageId} para status ${status}`);

        // Atualizar status da mensagem
        const { error: updateError } = await supabase
          .from('mensagens')
          .update({ status: status })
          .eq('wa_message_id', waMessageId);

        if (updateError) {
          console.error('Erro ao atualizar status da mensagem:', updateError);
        }
      }

      return new Response(
        JSON.stringify({ status: 'processed' }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Status da conexão
    if (webhookData.event === 'connection.update') {
      console.log('Status de conexão atualizado:', webhookData.data);
      
      const instanceId = webhookData.instance;
      const state = webhookData.data?.state;

      if (state === 'open') {
        // Atualizar status da instância para conectado
        await supabase
          .from('instancias_whatsapp')
          .update({ ativo: true, status: 'ativa', updated_at: new Date().toISOString() })
          .eq('instancia_id', instanceId);
        
        console.log(`Instância ${instanceId} conectada`);
      } else if (state === 'close') {
        // Atualizar status da instância para desconectado
        await supabase
          .from('instancias_whatsapp')
          .update({ ativo: false, status: 'inativa', updated_at: new Date().toISOString() })
          .eq('instancia_id', instanceId);
        
        console.log(`Instância ${instanceId} desconectada`);
      }
    }

    return new Response(
      JSON.stringify({ status: 'processed' }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Erro no webhook:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
