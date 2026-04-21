import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const payload = await req.json();
    console.log('Payload recebido da Evolution API:', JSON.stringify(payload, null, 2));

    // Extrair metadados HTTP
    const headers = payload.headers || {};
    const params = payload.params || {};
    const query = payload.query || {};
    const httpMeta = {
      webhookUrl: payload.webhookUrl || null,
      executionMode: payload.executionMode || null,
    };
    
    // Extrair IP do cliente (prioridade: x-forwarded-for, depois x-real-ip)
    const clientIp = headers['x-forwarded-for'] || headers['x-real-ip'] || null;
    const userAgent = headers['user-agent'] || null;

    const event = payload.body?.event || payload.event;
    console.log('Evento recebido:', event);

    // EVENTOS SUPORTADOS
    const supportedEvents = [
      'messages.upsert',      // Nova mensagem
      'messages.update',      // Atualização de status (DELIVERY_ACK, READ, etc.)
      'send.message',         // Mensagem enviada
      'connection.update',    // Atualização de conexão
      'qrcode.updated',       // QR Code atualizado
      'contacts.set',         // Sincronização de contatos
      'contacts.update',      // Atualização de contato
      'contacts.upsert',      // Upsert de contato
    ];

    // Eventos ignorados (não críticos)
    const ignoredEvents = [
      'groups.update',
      'groups.upsert',
      'presence.update',
      'chats.update',
      'chats.upsert',
      'chats.delete',
      'labels.edit',
      'labels.association',
    ];

    if (ignoredEvents.includes(event)) {
      console.log('Evento não crítico, ignorando:', event);
      return new Response(
        JSON.stringify({ success: true, code: 'IGNORED_EVENT', message: 'Evento não crítico ignorado', event }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // HANDLE: contacts.set, contacts.update, contacts.upsert - Atualização de contatos da agenda
    // IMPORTANTE: Só atualizar nomes quando vierem de contatos reais, não de mensagens enviadas
    if (event === 'contacts.set' || event === 'contacts.update' || event === 'contacts.upsert') {
      const data = payload.body?.data || payload.data;
      
      if (!data) {
        console.log(`${event} sem data`);
        return new Response(
          JSON.stringify({ success: true, message: `${event} sem data` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
      }

      // Pode ser um array de contatos
      const contacts = Array.isArray(data) ? data : [data];
      let updatedCount = 0;

      console.log(`Processando ${contacts.length} contatos do evento ${event}`);

      // Blocklist de nomes que NUNCA devem ser aplicados a contatos via
      // contacts.* events. Combina: nomes das instâncias + nomes dos
      // profiles da equipe (tanto o profile.nome quanto variações óbvias).
      // Em 13/04 houve contaminação: contacts.set sincronizou a agenda da
      // Isadora e aplicou "Isadora Cristina Volek" em múltiplos contatos.
      const { data: instancias } = await supabase
        .from('instancias_whatsapp')
        .select('nome_instancia, numero_chip');
      const { data: profilesTeam } = await supabase
        .from('profiles')
        .select('nome');

      const instanceNames = new Set<string>();
      const instanceNumbers = new Set<string>();
      const blockedNames = new Set<string>();

      if (instancias) {
        instancias.forEach(inst => {
          if (inst.nome_instancia) {
            const n = inst.nome_instancia.toLowerCase();
            instanceNames.add(n);
            blockedNames.add(n);
          }
          if (inst.numero_chip) instanceNumbers.add(inst.numero_chip);
        });
      }
      if (profilesTeam) {
        profilesTeam.forEach(p => {
          if (p.nome) {
            const n = p.nome.toLowerCase().trim();
            blockedNames.add(n);
            // Também bloqueia variações iniciais com 2+ palavras (ex: "Isadora Cristina")
            const parts = n.split(/\s+/);
            if (parts.length >= 2) blockedNames.add(`${parts[0]} ${parts[1]}`);
          }
        });
      }

      for (const contactData of contacts) {
        // Extrair jid e nome do contato
        const jid = contactData.id || contactData.jid || contactData.remoteJid;
        const contactName = contactData.pushName || contactData.name || contactData.notify || contactData.verifiedName;

        if (!jid || !contactName) {
          console.log('Contato sem jid ou nome válido:', contactData);
          continue;
        }

        // Ignorar contatos que são grupos ou broadcasts
        if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('status@broadcast')) {
          console.log('Ignorando contato de grupo/broadcast:', jid);
          continue;
        }

        const phone = jid.split('@')[0].replace(/\s+/g, '');

        // Check anti-contaminação: o nome proposto bate com um membro da
        // equipe (instância OU profile)? Se sim, é quase certo que é ruído
        // da agenda da fonte (alguém salvou a própria equipe no celular).
        const nameLower = contactName.toLowerCase().trim();
        let isInstanceName = false;

        // Bloqueio direto por nome completo
        if (blockedNames.has(nameLower)) {
          isInstanceName = true;
          console.log(`Ignorando - nome "${contactName}" está na blocklist da equipe`);
        }

        // Bloqueio por prefixo de instância (fallback pra variações com ":")
        if (!isInstanceName) {
          for (const instName of instanceNames) {
            if (nameLower.includes(instName) || instName.includes(nameLower.substring(0, 5))) {
              isInstanceName = true;
              console.log(`Ignorando update - nome "${contactName}" parece ser de instância "${instName}"`);
              break;
            }
          }
        }

        // Bloqueio por pattern "Nome Sobrenome" que case com profile
        if (!isInstanceName) {
          for (const blocked of blockedNames) {
            // Se o contactName COMEÇA com qualquer nome bloqueado (ex: "Isadora" em "Isadora Cristina Volek")
            if (blocked.length >= 5 && (nameLower.startsWith(blocked) || blocked.startsWith(nameLower))) {
              isInstanceName = true;
              console.log(`Ignorando - "${contactName}" colide com nome bloqueado "${blocked}"`);
              break;
            }
          }
        }
        
        // Verificar se é o mesmo número de uma instância
        if (instanceNumbers.has(phone)) {
          console.log(`Ignorando update - ${phone} é número de uma instância`);
          continue;
        }

        if (isInstanceName) {
          continue;
        }

        // Nunca sobrescrever nomes já definidos.
        // O evento contacts.* pode trazer "pushName" (apelido na agenda do remetente) e isso
        // tem causado regressão (nome do bot/instância sobrescrevendo contato real).
        const normalizedNewName = String(contactName).trim();
        if (!normalizedNewName) continue;

        // Buscar contato atual
        const { data: existingContact } = await supabase
          .from('contacts')
          .select('id, name, phone')
          .eq('jid', jid)
          .maybeSingle();

        const currentName = (existingContact?.name || '').trim();
        const currentPhone = (existingContact?.phone || phone).trim();
        const isNameMissing = !currentName || currentName === currentPhone || currentName === phone;

        // Se não existe contato ainda, cria; se existe, só define nome quando estiver faltando.
        if (!existingContact) {
          console.log(`Criando contato ${jid} (contacts.*) com nome: ${normalizedNewName}`);
          const { error: insertContactError } = await supabase
            .from('contacts')
            .insert({
              jid,
              phone,
              name: normalizedNewName,
              updated_at: new Date().toISOString(),
            });

          if (insertContactError) {
            console.error('Erro ao criar contato (contacts.*):', insertContactError);
          } else {
            updatedCount++;
          }
        } else if (isNameMissing && normalizedNewName !== currentPhone && normalizedNewName !== phone) {
          console.log(`Definindo nome inicial do contato ${jid} (não tinha nome): ${normalizedNewName}`);
          const { error: updateContactError } = await supabase
            .from('contacts')
            .update({ name: normalizedNewName, updated_at: new Date().toISOString() })
            .eq('id', existingContact.id);

          if (updateContactError) {
            console.error('Erro ao atualizar contato (contacts.*):', updateContactError);
          } else {
            updatedCount++;
          }
        } else {
          console.log(`Ignorando update de nome para ${jid} (já tem nome definido):`, { currentName, incoming: normalizedNewName });
        }

        // Atualizar conversas APENAS se o nome ainda estiver faltando (mesma regra).
        // Isso evita que o nome da instância/bot sobrescreva o nome do contato na UI.
        const { error: updateConversaError } = await supabase
          .from('conversas')
          .update({ nome_contato: normalizedNewName, updated_at: new Date().toISOString() })
          .eq('numero_contato', phone)
          .or(`nome_contato.is.null,nome_contato.eq.${phone}`);

        if (updateConversaError) {
          // Pode ser apenas "nenhuma linha"; manter log baixo
          console.log('Conversa não atualizada (nome já definido ou inexistente):', phone);
        }
      }

      console.log(`Contatos atualizados: ${updatedCount}`);

      return new Response(
        JSON.stringify({ success: true, event, updated: updatedCount }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // HANDLE: messages.update - Atualização de status de mensagens
    if (event === 'messages.update') {
      const data = payload.body?.data || payload.data;
      
      if (!data) {
        console.log('messages.update sem data');
        return new Response(
          JSON.stringify({ success: true, message: 'messages.update sem data' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
      }

      // Pode ser um array de updates
      const updates = Array.isArray(data) ? data : [data];
      let updatedCount = 0;

      for (const update of updates) {
        const waMessageId = update.key?.id || update.id;
        const newStatus = update.status || update.update?.status;

        if (!waMessageId || !newStatus) {
          console.log('Update sem waMessageId ou status:', update);
          continue;
        }

        console.log(`Atualizando status da mensagem ${waMessageId} para ${newStatus}`);

        // Atualizar status na tabela messages
        const { error: updateMsgError } = await supabase
          .from('messages')
          .update({ status: newStatus })
          .eq('wa_message_id', waMessageId);

        if (updateMsgError) {
          console.error('Erro ao atualizar status da mensagem:', updateMsgError);
        } else {
          updatedCount++;
        }

        // Se status é READ, atualizar unread_count da conversa
        if (newStatus === 'READ' || newStatus === 'read') {
          // Buscar a mensagem para pegar o contact_id ou phone
          const { data: msg } = await supabase
            .from('messages')
            .select('contact_id')
            .eq('wa_message_id', waMessageId)
            .maybeSingle();

          if (msg?.contact_id) {
            // Buscar contato para pegar o phone
            const { data: contact } = await supabase
              .from('contacts')
              .select('phone')
              .eq('id', msg.contact_id)
              .maybeSingle();

            if (contact?.phone) {
              // Resetar unread_count da conversa
              await supabase
                .from('conversas')
                .update({ unread_count: 0 })
                .eq('numero_contato', contact.phone);
            }
          }
        }
      }

      return new Response(
        JSON.stringify({ success: true, event: 'messages.update', updated: updatedCount }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // HANDLE: connection.update
    if (event === 'connection.update') {
      const data = payload.body?.data || payload.data;
      const instanceName = payload.body?.instance || payload.instance;
      const state = data?.state || data?.connection;

      console.log(`Connection update para ${instanceName}: ${state}`);

      if (instanceName && state) {
        // Mapear estado da Evolution para nosso sistema
        let status = 'desconectada';
        if (state === 'open' || state === 'connected') {
          status = 'conectada';
        } else if (state === 'connecting') {
          status = 'conectando';
        }

        // Atualizar status da instância
        const { error } = await supabase
          .from('instancias_whatsapp')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('nome_instancia', instanceName);

        if (error) {
          console.error('Erro ao atualizar status da instância:', error);
        }
      }

      return new Response(
        JSON.stringify({ success: true, event: 'connection.update', instance: instanceName, state }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // HANDLE: qrcode.updated
    if (event === 'qrcode.updated') {
      console.log('QR Code atualizado - evento registrado');
      return new Response(
        JSON.stringify({ success: true, event: 'qrcode.updated' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // HANDLE: send.message (mensagem enviada pelo sistema)
    if (event === 'send.message') {
      console.log('Mensagem enviada pelo sistema - registrado');
      // Podemos processar como messages.upsert se tiver os mesmos dados
      // Por enquanto, apenas registrar
      return new Response(
        JSON.stringify({ success: true, event: 'send.message' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // HANDLE: messages.upsert - Nova mensagem
    if (event !== 'messages.upsert') {
      console.log('Evento não suportado:', event);
      return new Response(
        JSON.stringify({ success: false, code: 'UNSUPPORTED_EVENT', message: 'Evento não suportado', event }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Validar API key — aceita tanto a global quanto qualquer per-instância
    // cadastrada em instancias_whatsapp.token_instancia. Evolution envia apikey
    // por instância (ex: 7995AA66...), não a global (429683C...).
    const incomingApiKey = payload.body?.apikey;
    const globalApiKey = Deno.env.get('EVOLUTION_API_KEY');
    if (incomingApiKey && globalApiKey && incomingApiKey !== globalApiKey) {
      const { data: instancia } = await supabase
        .from('instancias_whatsapp')
        .select('id')
        .eq('token_instancia', incomingApiKey)
        .maybeSingle();
      if (!instancia) {
        console.error('API key não reconhecida:', incomingApiKey.substring(0, 6) + '***');
        return new Response(
          JSON.stringify({ success: false, error: 'API key inválida' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
        );
      }
    }

    const data = payload.body?.data || payload.data;
    
    if (!data || !data.key) {
      console.log('messages.upsert sem data válido');
      return new Response(
        JSON.stringify({ success: true, message: 'messages.upsert sem data válido' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    const remoteJid = (data.key.remoteJid || '').trim();
    const phone = remoteJid.split('@')[0].replace(/\s+/g, ''); // Extrair número e remover espaços
    const pushName = (data.pushName || '').trim().replace(/^\n+/, ''); // Remover \n do início
    const waMessageId = data.key.id;
    const isFromMe = Boolean(data.key.fromMe); // Se a mensagem foi enviada pelo bot
    
    // Extrair informações da instância
    const instanceUuid = data.instanceId || payload.body?.instance || payload.instance;
    const instanceName = payload.body?.instance || payload.instance;

    // 1. Buscar ou criar contato
    let contact = null;
    const { data: existingContact, error: selectError } = await supabase
      .from('contacts')
      .select('*')
      .eq('jid', remoteJid)
      .maybeSingle();

    if (selectError) {
      console.error('Erro ao buscar contato:', selectError);
      throw selectError;
    }

    // Função auxiliar para buscar foto de perfil
    const fetchProfilePicture = async (phoneNumber: string, instName: string): Promise<string | null> => {
      try {
        // Buscar configuração global (Evolution API)
        const { data: configData, error: configError } = await supabase
          .from('config_global')
          .select('evolution_base_url, evolution_api_key')
          .single();

        if (configError || !configData?.evolution_base_url || !configData?.evolution_api_key) {
          console.log('[FOTO] Config Evolution não encontrada');
          return null;
        }

        console.log(`[FOTO] Buscando foto de ${phoneNumber} via instância ${instName}`);
        
        const response = await fetch(`${configData.evolution_base_url}/chat/fetchProfilePictureUrl/${instName}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': configData.evolution_api_key,
          },
          body: JSON.stringify({ number: phoneNumber }),
        });

        if (!response.ok) {
          console.log(`[FOTO] Erro HTTP ${response.status} ao buscar foto de ${phoneNumber}`);
          return null;
        }

        const data = await response.json();
        const pictureUrl = data.profilePictureUrl || data.picture || data.url;
        
        if (pictureUrl) {
          console.log(`[FOTO] Foto encontrada para ${phoneNumber}`);
          return pictureUrl;
        }
        
        console.log(`[FOTO] Contato ${phoneNumber} sem foto disponível`);
        return null;
      } catch (err) {
        console.error(`[FOTO] Erro ao buscar foto de ${phoneNumber}:`, err);
        return null;
      }
    };

    if (existingContact) {
      contact = existingContact;
      // IMPORTANTE: Só atualizar nome se:
      // 1. A mensagem NÃO for enviada pelo bot (fromMe = false)
      // 2. O contato NÃO tem nome definido
      // 3. pushName existe
      // Quando fromMe = true, o pushName é o nome da instância/bot, não do contato!
      if (pushName && !existingContact.name && !isFromMe) {
        const { data: updatedContact, error: updateError } = await supabase
          .from('contacts')
          .update({ name: pushName, updated_at: new Date().toISOString() })
          .eq('id', existingContact.id)
          .select()
          .single();

        if (updateError) {
          console.error('Erro ao atualizar contato:', updateError);
        } else {
          contact = updatedContact;
          console.log('Contato atualizado com pushName (não tinha nome, mensagem recebida):', contact);
        }
      }
      
      // Buscar foto se contato não tem foto ainda (só para mensagens recebidas — fromMe não precisa)
      if (!isFromMe && !existingContact.profile_picture_url && instanceName) {
        const profilePic = await fetchProfilePicture(phone, instanceName);
        if (profilePic) {
          await supabase
            .from('contacts')
            .update({ profile_picture_url: profilePic, updated_at: new Date().toISOString() })
            .eq('id', existingContact.id);
          
          // Atualizar também na conversa
          await supabase
            .from('conversas')
            .update({ foto_contato: profilePic, updated_at: new Date().toISOString() })
            .eq('numero_contato', phone);
          
          console.log(`[FOTO] Foto atualizada para contato existente ${phone}`);
        }
      }
    } else {
      // Criar novo contato
      // IMPORTANTE: Só usar pushName como nome se a mensagem NÃO for fromMe
      // Quando fromMe = true, pushName é o nome da instância/bot
      const { data: newContact, error: insertError } = await supabase
        .from('contacts')
        .insert({
          jid: remoteJid,
          phone: phone,
          name: isFromMe ? null : (pushName || null), // Só usar pushName se for mensagem recebida
        })
        .select()
        .single();

      if (insertError) {
        console.error('Erro ao criar contato:', insertError);
        throw insertError;
      }

      contact = newContact;
      console.log('Novo contato criado:', contact, isFromMe ? '(fromMe - sem pushName)' : '');

      // Classificar contato novo com IA e buscar foto (só para mensagens recebidas)
      // Quando fromMe = true, o contato remoto pode não ter contexto suficiente ainda
      if (!isFromMe) {
        try {
          const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
          const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
          fetch(`${supabaseUrl}/functions/v1/classificar-contato-ia`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${anonKey}`,
            },
            body: JSON.stringify({ contact_id: newContact.id }),
          }).catch(err => console.error('[CLASSIFICAR-AUTO] Erro ao disparar classificação:', err));
        } catch (e) {
          console.error('[CLASSIFICAR-AUTO] Erro:', e);
        }
      }

      // Buscar foto para novo contato (só para mensagens recebidas)
      if (!isFromMe && instanceName) {
        const profilePic = await fetchProfilePicture(phone, instanceName);
        if (profilePic) {
          await supabase
            .from('contacts')
            .update({ profile_picture_url: profilePic, updated_at: new Date().toISOString() })
            .eq('id', newContact.id);
          
          console.log(`[FOTO] Foto salva para novo contato ${phone}`);
        }
      }
    }

    // 2. Buscar ou criar instância WhatsApp
    let instanciaWhatsappId = null;
    
    if (instanceUuid) {
      let { data: instanciaWhatsapp, error: instanciaError } = await supabase
        .from('instancias_whatsapp')
        .select('id')
        .eq('instancia_id', instanceUuid)
        .maybeSingle();

      // Tentar também por nome
      if (!instanciaWhatsapp && instanceName) {
        const { data: instByName } = await supabase
          .from('instancias_whatsapp')
          .select('id')
          .eq('nome_instancia', instanceName)
          .maybeSingle();
        
        if (instByName) {
          instanciaWhatsapp = instByName;
        }
      }

      if (!instanciaWhatsapp) {
        console.log('Instância não encontrada, criando automaticamente:', instanceUuid);
        const { data: newInstancia, error: createInstanciaError } = await supabase
          .from('instancias_whatsapp')
          .insert({
            instancia_id: instanceUuid,
            nome_instancia: instanceName || instanceUuid,
            tipo_canal: 'whatsapp',
            ativo: true,
            cor_identificacao: '#3B82F6'
          })
          .select('id')
          .single();

        if (createInstanciaError) {
          console.error('Erro ao criar instância WhatsApp:', createInstanciaError);
        } else {
          instanciaWhatsapp = newInstancia;
          console.log('Instância criada com ID:', instanciaWhatsapp.id);
        }
      }
      
      if (instanciaWhatsapp) {
        instanciaWhatsappId = instanciaWhatsapp.id;
      }
    }

    // 3. Buscar ou criar número WhatsApp e vincular à instância
    let numeroWhatsappId = null;
    
    if (phone && instanciaWhatsappId) {
      let { data: numeroWhatsapp, error: numeroError } = await supabase
        .from('numeros_whatsapp')
        .select('*')
        .eq('numero', phone)
        .maybeSingle();

      if (!numeroWhatsapp) {
        console.log('Número não encontrado, criando:', phone);
        const { data: newNumero, error: createNumeroError } = await supabase
          .from('numeros_whatsapp')
          .insert({
            numero: phone,
            jid: remoteJid,
            instancia_atual_id: instanciaWhatsappId,
            nome_display: pushName || null,
            ativo: true
          })
          .select()
          .single();

        if (createNumeroError) {
          console.error('Erro ao criar número WhatsApp:', createNumeroError);
        } else {
          numeroWhatsapp = newNumero;
          console.log('Número criado com ID:', numeroWhatsapp.id);
          
          await supabase
            .from('historico_numero_instancia')
            .insert({
              numero_whatsapp_id: numeroWhatsapp.id,
              instancia_id: instanciaWhatsappId,
              motivo: 'webhook_auto_create'
            });
        }
      } else {
        console.log('Número encontrado:', numeroWhatsapp.id);
        
        if (numeroWhatsapp.instancia_atual_id !== instanciaWhatsappId) {
          console.log('Instância mudou, atualizando número:', phone);
          
          if (numeroWhatsapp.instancia_atual_id) {
            await supabase
              .from('historico_numero_instancia')
              .update({ 
                desvinculado_em: new Date().toISOString(),
                motivo: 'nova_conexao'
              })
              .eq('numero_whatsapp_id', numeroWhatsapp.id)
              .eq('instancia_id', numeroWhatsapp.instancia_atual_id)
              .is('desvinculado_em', null);
          }
          
          await supabase
            .from('numeros_whatsapp')
            .update({ 
              instancia_atual_id: instanciaWhatsappId,
              updated_at: new Date().toISOString()
            })
            .eq('id', numeroWhatsapp.id);
          
          await supabase
            .from('historico_numero_instancia')
            .insert({
              numero_whatsapp_id: numeroWhatsapp.id,
              instancia_id: instanciaWhatsappId,
              motivo: 'webhook_update'
            });
        }
      }
      
      if (numeroWhatsapp) {
        numeroWhatsappId = numeroWhatsapp.id;
      }
    }

    // 4. Verificar se mensagem já existe
    const { data: existingMessage, error: msgSelectError } = await supabase
      .from('messages')
      .select('id')
      .eq('wa_message_id', waMessageId)
      .maybeSingle();

    if (msgSelectError) {
      console.error('Erro ao verificar mensagem existente:', msgSelectError);
      throw msgSelectError;
    }

    if (existingMessage) {
      console.log('Mensagem já existe, ignorando:', waMessageId);
      return new Response(
        JSON.stringify({ success: true, message: 'Mensagem já existe', id: existingMessage.id }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // 5. Extrair texto e tipo de mídia da mensagem
    let messageText = null;
    let messageType = 'text';
    let mediaUrl = null;
    let mediaBase64 = null;
    let mediaMimeType = null;
    let mediaFileName = null;

    // Texto simples
    if (data.message?.conversation) {
      messageText = data.message.conversation;
      messageType = 'text';
    } else if (data.message?.extendedTextMessage?.text) {
      messageText = data.message.extendedTextMessage.text;
      messageType = 'text';
    }
    // Imagem
    else if (data.message?.imageMessage) {
      const img = data.message.imageMessage;
      messageText = img.caption || '📷 Imagem';
      messageType = 'image';
      mediaUrl = img.url || null;
      mediaBase64 = img.base64 || null;
      mediaMimeType = img.mimetype || 'image/jpeg';
      mediaFileName = img.fileName || 'image.jpg';
    }
    // Vídeo
    else if (data.message?.videoMessage) {
      const vid = data.message.videoMessage;
      messageText = vid.caption || '🎬 Vídeo';
      messageType = 'video';
      mediaUrl = vid.url || null;
      mediaBase64 = vid.base64 || null;
      mediaMimeType = vid.mimetype || 'video/mp4';
      mediaFileName = vid.fileName || 'video.mp4';
    }
    // Áudio
    else if (data.message?.audioMessage) {
      const aud = data.message.audioMessage;
      messageText = '🎤 Áudio';
      messageType = 'audio';
      mediaUrl = aud.url || null;
      mediaBase64 = aud.base64 || null;
      mediaMimeType = aud.mimetype || 'audio/ogg';
      mediaFileName = 'audio.ogg';
    }
    // PTT (Push to Talk - áudio de voz)
    else if (data.message?.pttMessage) {
      const ptt = data.message.pttMessage;
      messageText = '🎤 Áudio';
      messageType = 'audio';
      mediaUrl = ptt.url || null;
      mediaBase64 = ptt.base64 || null;
      mediaMimeType = ptt.mimetype || 'audio/ogg';
      mediaFileName = 'audio.ogg';
    }
    // Documento
    else if (data.message?.documentMessage) {
      const doc = data.message.documentMessage;
      messageText = `📎 ${doc.fileName || 'Documento'}`;
      messageType = 'document';
      mediaUrl = doc.url || null;
      mediaBase64 = doc.base64 || null;
      mediaMimeType = doc.mimetype || 'application/octet-stream';
      mediaFileName = doc.fileName || 'document';
    }
    // Documento com caption
    else if (data.message?.documentWithCaptionMessage) {
      const docWithCaption = data.message.documentWithCaptionMessage?.message?.documentMessage;
      if (docWithCaption) {
        messageText = docWithCaption.caption || `📎 ${docWithCaption.fileName || 'Documento'}`;
        messageType = 'document';
        mediaUrl = docWithCaption.url || null;
        mediaBase64 = docWithCaption.base64 || null;
        mediaMimeType = docWithCaption.mimetype || 'application/octet-stream';
        mediaFileName = docWithCaption.fileName || 'document';
      }
    }
    // Sticker
    else if (data.message?.stickerMessage) {
      messageText = '🏷️ Figurinha';
      messageType = 'sticker';
      mediaUrl = data.message.stickerMessage.url || null;
      mediaBase64 = data.message.stickerMessage.base64 || null;
    }
    // Localização
    else if (data.message?.locationMessage) {
      const loc = data.message.locationMessage;
      messageText = `📍 Localização: ${loc.degreesLatitude}, ${loc.degreesLongitude}`;
      messageType = 'location';
    }
    // Localização ao vivo
    else if (data.message?.liveLocationMessage) {
      const loc = data.message.liveLocationMessage;
      messageText = `📍 Localização ao vivo: ${loc.degreesLatitude}, ${loc.degreesLongitude}`;
      messageType = 'location';
    }
    // Contato
    else if (data.message?.contactMessage) {
      const contactMsg = data.message.contactMessage;
      messageText = `👤 Contato: ${contactMsg.displayName || 'Contato'}`;
      messageType = 'contact';
    }
    // Array de contatos
    else if (data.message?.contactsArrayMessage) {
      const contacts = data.message.contactsArrayMessage.contacts || [];
      const names = contacts.map((c: any) => c.displayName).join(', ');
      messageText = `👤 Contatos: ${names || 'Contatos'}`;
      messageType = 'contact';
    }
    // Reação
    else if (data.message?.reactionMessage) {
      const reaction = data.message.reactionMessage;
      messageText = `${reaction.text || '👍'} (reação)`;
      messageType = 'reaction';
    }
    // Poll (enquete)
    else if (data.message?.pollCreationMessage) {
      const poll = data.message.pollCreationMessage;
      messageText = `📊 Enquete: ${poll.name || 'Enquete'}`;
      messageType = 'poll';
    }
    // Botões
    else if (data.message?.buttonsResponseMessage) {
      messageText = data.message.buttonsResponseMessage.selectedButtonId || 'Resposta de botão';
      messageType = 'button_response';
    }
    // Lista
    else if (data.message?.listResponseMessage) {
      messageText = data.message.listResponseMessage.title || 'Resposta de lista';
      messageType = 'list_response';
    }
    // Template buttons
    else if (data.message?.templateButtonReplyMessage) {
      messageText = data.message.templateButtonReplyMessage.selectedId || 'Resposta de template';
      messageType = 'template_response';
    }

    // Ignorar apenas se não tiver nenhum conteúdo válido
    if (!messageText && !mediaUrl && !mediaBase64) {
      console.log('Mensagem sem conteúdo válido, ignorando. Message object:', JSON.stringify(data.message, null, 2));
      return new Response(
        JSON.stringify({ success: true, message: 'Mensagem sem conteúdo ignorada' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    console.log(`Tipo de mensagem: ${messageType}, Texto: ${messageText?.substring(0, 50)}`);
    if (mediaUrl) console.log(`Media URL presente`);
    if (mediaBase64) console.log(`Media Base64 presente (${mediaBase64.length} chars)`);

    // 6. Extrair contexto da mensagem
    const messageContextInfo = data.message?.messageContextInfo || null;

    // 7. Mascarar apikey para auditoria
    let apikeyHash = null;
    if (payload.body?.apikey) {
      const apikey = payload.body.apikey;
      if (apikey.length > 8) {
        apikeyHash = `${apikey.substring(0, 4)}***${apikey.substring(apikey.length - 4)}`;
      } else {
        apikeyHash = '***';
      }
    }

    // 8. Criar nova mensagem com todos os metadados
    const { data: newMessage, error: insertMsgError } = await supabase
      .from('messages')
      .insert({
        wa_message_id: waMessageId,
        contact_id: contact.id,
        instancia_whatsapp_id: instanciaWhatsappId,
        instance: instanceName,
        instance_uuid: instanceUuid,
        from_me: Boolean(data.key.fromMe),
        text: messageText || '',
        status: data.status || 'PENDING',
        message_type: messageType,
        wa_timestamp: data.messageTimestamp,
        webhook_received_at: payload.body?.date_time,
        sender_lid: data.key.senderLid || null,
        source: data.source || null,
        sender_jid: payload.body?.sender || null,
        raw_payload: data,
        http_headers: headers,
        http_params: params,
        http_query: query,
        http_meta: httpMeta,
        http_client_ip: clientIp,
        http_user_agent: userAgent,
        event: event,
        destination: payload.body?.destination || null,
        server_url: payload.body?.server_url || null,
        apikey_hash: apikeyHash,
        message_context_info: messageContextInfo,
      })
      .select()
      .single();

    if (insertMsgError) {
      console.error('Erro ao inserir mensagem:', insertMsgError);
      throw insertMsgError;
    }

    console.log('Mensagem salva com sucesso:', newMessage.id);

    // 9. Atualizar ou criar conversa vinculada ao número WhatsApp
    if (numeroWhatsappId) {
      // IMPORTANTE: filtrar por instância! Antes só filtrava por phone, o que
      // (a) retornava conversa de outra instância e (b) com UNIQUE(numero, instance)
      // no DB agora dois webhooks simultâneos batiam o SELECT antes do INSERT e
      // davam conflict. Lookup por (phone, instance) + UPSERT com onConflict
      // resolve a race.
      const { data: existingConversa } = await supabase
        .from('conversas')
        .select('id, unread_count')
        .eq('numero_contato', phone)
        .eq('current_instance_id', instanciaWhatsappId)
        .maybeSingle();

      const isFromContact = !Boolean(data.key.fromMe);
      const CLOSURE_PATTERNS = /^(ok|okay|obrigad[oa]|obg|vlw|valeu|blz|beleza|perfeito|combinado|certo|entendi|show|top|massa|boa|bom dia|boa tarde|boa noite|tá|ta|sim|não|nao|haha|kk|rs|kkk|👍|👌|🙏|😊|😁|❤|🤝|👏)$/i;
      const isClosure = isFromContact && messageText && CLOSURE_PATTERNS.test(messageText.trim());
      const updateData: any = {
        numero_whatsapp_id: numeroWhatsappId,
        current_instance_id: instanciaWhatsappId,
        ultima_mensagem: messageText,
        ultima_interacao: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_message_from_me: isFromContact ? (isClosure ? null : false) : true,
      };

      // Incrementar unread_count se mensagem é do contato
      if (isFromContact) {
        if (pushName) {
          updateData.nome_contato = pushName;
        }
      }

      if (existingConversa) {
        // Incrementar unread_count se mensagem é do contato
        if (isFromContact) {
          updateData.unread_count = (existingConversa.unread_count || 0) + 1;
        }

        await supabase
          .from('conversas')
          .update(updateData)
          .eq('id', existingConversa.id);

        console.log('Conversa atualizada:', existingConversa.id, 'unread_count:', updateData.unread_count);

        // ── Assistente Maikon (Stage 6): comando /m, !bot, /maikonect ──
        // Se msg do contato (fromMe=false) começa com prefix bot e phone está
        // na whitelist, rotea pra assistente-maikon em vez de seguir flow normal.
        if (isFromContact && messageText && typeof messageText === 'string') {
          try {
            const { data: cfgBot } = await supabase
              .from('config_global')
              .select('bot_ativo, bot_admin_phones, bot_trigger_prefixes')
              .limit(1).single();

            if (cfgBot?.bot_ativo && Array.isArray(cfgBot.bot_admin_phones)) {
              const senderPhone = phone; // já normalizado acima (só dígitos)
              const whitelist = (cfgBot.bot_admin_phones as string[])
                .map(p => p.replace(/\D/g, ''));
              const phoneOnlyDigits = senderPhone.replace(/\D/g, '');
              // Match por sufixo — cobre variações com/sem 55/9
              const isAdmin = whitelist.some(p =>
                phoneOnlyDigits.endsWith(p.slice(-10)) || p.endsWith(phoneOnlyDigits.slice(-10))
              );

              if (isAdmin) {
                const prefixes = (cfgBot.bot_trigger_prefixes as string[] | null) || ['/m', '!bot', '/maikonect'];
                const trimmed = messageText.trim();
                const lower = trimmed.toLowerCase();
                const matchPrefix = prefixes.find(p => lower.startsWith(p.toLowerCase() + ' ') || lower === p.toLowerCase());

                if (matchPrefix) {
                  const comando = trimmed.slice(matchPrefix.length).trim();
                  console.log(`[bot-maikon] trigger de ${senderPhone}: "${comando}"`);

                  // Fire-and-forget — o bot responde async
                  const supabaseUrlBot = Deno.env.get('SUPABASE_URL')!;
                  const svcKeyBot = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
                  fetch(`${supabaseUrlBot}/functions/v1/assistente-maikon`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${svcKeyBot}`,
                    },
                    body: JSON.stringify({
                      msg: comando || 'oi',
                      sender_phone: senderPhone,
                      instancia_id: instanciaWhatsappId,
                      instancia_nome: instanceName,
                    }),
                  }).catch(e => console.error('[bot-maikon] falha invoke:', e));

                  // Não continua flow normal pra essa msg (é comando)
                }
              }
            }
          } catch (botErr) {
            console.warn('[bot-maikon] erro check:', botErr);
          }
        }

        // ── Callback de campanha: lead respondeu? ──
        // Se a msg é do contato E ele tem campanha_envios com status='enviado'
        // em campanha ativa, marca respondeu_em + flip status pra em_conversa.
        // A IA responder (Stage 4) vai usar vw_envios_aguardando_ia pra processar.
        if (isFromContact && contact?.id) {
          try {
            const { data: envioAtivo } = await supabase
              .from('campanha_envios')
              .select('id, status, respondeu_em, campanha:campanha_id(status, briefing_ia)')
              .eq('lead_id', contact.id)
              .in('status', ['enviado', 'em_conversa'])
              .order('enviado_em', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (envioAtivo) {
              const camp = (envioAtivo.campanha as { status?: string } | null);
              if (camp && ['ativa', 'em_andamento'].includes(camp.status || '')) {
                const updates: Record<string, unknown> = {
                  primeira_msg_contato_em: new Date().toISOString(),
                };
                if (envioAtivo.status === 'enviado') {
                  updates.status = 'em_conversa';
                  updates.respondeu_em = new Date().toISOString();
                  console.log(`[callback] Lead ${contact.id} respondeu campanha (flip em_conversa)`);
                }
                await supabase.from('campanha_envios')
                  .update(updates)
                  .eq('id', envioAtivo.id);
              }
            }
          } catch (cbErr) {
            console.warn('[callback-campanha] erro ignorável:', cbErr);
          }
        }
      } else {
        const insertPayload = {
          numero_contato: phone,
          nome_contato: isFromContact ? (pushName || null) : null,
          contact_id: contact.id,
          numero_whatsapp_id: numeroWhatsappId,
          orig_instance_id: instanciaWhatsappId,
          current_instance_id: instanciaWhatsappId,
          instancia_id: instanciaWhatsappId,
          ultima_mensagem: messageText,
          ultima_interacao: new Date().toISOString(),
          status: 'novo',
          unread_count: isFromContact ? 1 : 0,
          last_message_from_me: isFromContact ? (isClosure ? null : false) : true,
        };

        // UPSERT com onConflict: se dois webhooks chegam ao mesmo tempo e ambos
        // viram "não existe", o segundo cai no UPDATE em vez de criar duplicata.
        const { data: newConversa, error: conversaError } = await supabase
          .from('conversas')
          .upsert(insertPayload, { onConflict: 'numero_contato,current_instance_id' })
          .select()
          .single();

        if (conversaError) {
          console.error('Erro ao criar/atualizar conversa:', conversaError);
        } else {
          console.log('Nova conversa criada:', newConversa.id);

          // Roteamento automático: atribuir responsável com base no perfil do contato
          try {
            const perfilContato = contact.perfil_profissional;
            if (perfilContato) {
              const { data: regra } = await supabase
                .from("regras_roteamento")
                .select("responsavel_user_id")
                .contains("perfis_profissionais", [perfilContato])
                .eq("ativo", true)
                .order("prioridade", { ascending: false })
                .limit(1)
                .maybeSingle();

              if (regra?.responsavel_user_id) {
                await supabase
                  .from("conversas")
                  .update({ responsavel_atual: regra.responsavel_user_id })
                  .eq("id", newConversa.id);
                console.log(`[ROTEAMENTO] Conversa ${newConversa.id} atribuída para ${regra.responsavel_user_id} (perfil: ${perfilContato})`);
              }
            }
          } catch (routeErr) {
            console.error('[ROTEAMENTO] Erro:', routeErr);
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message_id: newMessage.id, 
        contact_id: contact.id,
        numero_whatsapp_id: numeroWhatsappId,
        message_type: messageType
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error('Erro ao processar webhook:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
