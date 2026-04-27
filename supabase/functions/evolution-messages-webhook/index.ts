import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Gera todas as variantes plausíveis do mesmo número BR, cobrindo:
 * - com/sem prefixo "55" (código do país)
 * - com/sem "9" mobile (celular novo vs antigo)
 * - últimos 10/11 dígitos pra match parcial
 *
 * Essencial porque o Evolution API às vezes envia o phone sem o "9" de celular
 * (ex: 555484351512) enquanto o banco tem com (ex: 5554984351512). Sem isso,
 * matches por telefone falham e criamos contatos duplicados.
 */
function gerarVariantesTelefoneBR(raw: string): string[] {
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) return [];
  const set = new Set<string>([digits]);
  const sem55 = digits.startsWith('55') ? digits.slice(2) : digits;
  if (sem55) {
    set.add(sem55);
    set.add('55' + sem55);
  }
  // Sem 9 mobile: "AABXXXXXXXX" (11 dígitos, 3º caractere é 9)
  if (sem55.length === 11 && sem55[2] === '9') {
    const sem9 = sem55.slice(0, 2) + sem55.slice(3);
    set.add(sem9);
    set.add('55' + sem9);
  }
  // Com 9 mobile: "AABXXXXXXXX" (10 dígitos, sem o 9)
  if (sem55.length === 10) {
    const com9 = sem55.slice(0, 2) + '9' + sem55.slice(2);
    set.add(com9);
    set.add('55' + com9);
  }
  // Fallback: últimos 10/11
  const last10 = digits.slice(-10);
  const last11 = digits.slice(-11);
  if (last10) { set.add(last10); set.add('55' + last10); }
  if (last11) { set.add(last11); set.add('55' + last11); }
  return [...set].filter(v => v.length >= 10);
}

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

        // Se status é READ, zerar unread_count da conversa.
        // Aceita string ('READ'/'read') OU número (Baileys: 4=DELIVERY_ACK, 5=READ).
        const isRead =
          newStatus === 'READ' || newStatus === 'read' || newStatus === 5 || newStatus === '5';
        if (isRead) {
          // Estratégia 1: tentar achar a msg no banco e zerar pelo contact_id
          // (mais preciso, mas pode falhar se msg ainda não foi inserida).
          const { data: msg } = await supabase
            .from('messages')
            .select('contact_id, instance_uuid')
            .eq('wa_message_id', waMessageId)
            .maybeSingle();

          if (msg?.contact_id && msg?.instance_uuid) {
            await supabase
              .from('conversas')
              .update({ unread_count: 0 })
              .eq('contact_id', msg.contact_id)
              .eq('current_instance_id', msg.instance_uuid)
              .gt('unread_count', 0);
          } else {
            // Estratégia 2: fallback pelo remoteJid + instance do payload.
            // Usado quando msg.update chega antes da msg.upsert (race comum).
            const remoteJid =
              update.key?.remoteJid || update.remoteJid || update.chatId || '';
            const instanceFromUpdate =
              payload.body?.instance || payload.instance || update.instanceId;

            if (remoteJid && instanceFromUpdate) {
              const phoneOnly = remoteJid.split('@')[0].replace(/\D/g, '');
              if (phoneOnly) {
                // Busca instância UUID
                const { data: instRow } = await supabase
                  .from('instancias_whatsapp')
                  .select('id')
                  .or(`nome_instancia.eq.${instanceFromUpdate},instancia_id.eq.${instanceFromUpdate}`)
                  .maybeSingle();

                if (instRow?.id) {
                  // Zera todas variantes do phone (com/sem 9)
                  const variantes = gerarVariantesTelefoneBR(phoneOnly);
                  if (variantes.length > 0) {
                    await supabase
                      .from('conversas')
                      .update({ unread_count: 0 })
                      .in('numero_contato', variantes)
                      .eq('current_instance_id', instRow.id)
                      .gt('unread_count', 0);
                  }
                }
              }
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

    const rawRemoteJid = (data.key.remoteJid || '').trim();
    // WhatsApp moderno usa @lid (Linked Device ID) pra esconder phone real.
    // O phone vem em key.remoteJidAlt. Se for LID, usa o Alt como JID canônico
    // e guarda o LID em contacts.lid_jid pra correlacionar futuras msgs.
    // Só consideramos LID quando o remoteJid CRU termina em @lid.
    // addressingMode='lid' isolado pode aparecer em msgs já resolvidas — aí
    // remoteJid já é @s.whatsapp.net e não temos LID válido pra guardar.
    const isLidMessage = rawRemoteJid.endsWith('@lid');
    const remoteJidAlt = (data.key.remoteJidAlt || '').trim();
    const remoteJid = (isLidMessage && remoteJidAlt) ? remoteJidAlt : rawRemoteJid;
    const lidJid = isLidMessage ? rawRemoteJid : null;

    if (isLidMessage && !remoteJidAlt) {
      console.log(`[lid] msg ${rawRemoteJid} sem remoteJidAlt — não dá pra resolver phone, ignorando`);
      return new Response(
        JSON.stringify({ success: true, message: 'LID sem phone resolvível ignorada' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    const phone = remoteJid.split('@')[0].replace(/\s+/g, ''); // phone real (de remoteJid ou remoteJidAlt)
    const pushName = (data.pushName || '').trim().replace(/^\n+/, ''); // Remover \n do início
    const waMessageId = data.key.id;
    const isFromMe = Boolean(data.key.fromMe); // Se a mensagem foi enviada pelo bot

    if (isLidMessage) {
      console.log(`[lid] resolvido ${rawRemoteJid} → ${remoteJid}`);
    }
    
    // Extrair informações da instância
    const instanceUuid = data.instanceId || payload.body?.instance || payload.instance;
    const instanceName = payload.body?.instance || payload.instance;

    // 1. Buscar ou criar contato — considera variantes com/sem 9 de celular
    // pra evitar duplicar contatos quando Evolution envia sem o 9 mobile
    // (Ex: 555484351512 é o mesmo contato que 5554984351512)
    let contact = null;
    const phoneVariants = gerarVariantesTelefoneBR(phone);
    const jidVariants = phoneVariants.map(p =>
      remoteJid.includes('@') ? `${p}@${remoteJid.split('@')[1]}` : p
    );

    // Busca por JID exato OU qualquer variante de JID OU qualquer variante de phone
    // OU pelo lid_jid (caso seja msg @lid e o contato já tenha lid armazenado)
    const orFilters = [
      `jid.in.(${jidVariants.join(',')})`,
      `phone.in.(${phoneVariants.join(',')})`,
    ];
    if (lidJid) {
      orFilters.push(`lid_jid.eq.${lidJid}`);
    }
    const { data: existingContacts, error: selectError } = await supabase
      .from('contacts')
      .select('*')
      .or(orFilters.join(','))
      .order('created_at', { ascending: true })
      .limit(5);

    if (selectError) {
      console.error('Erro ao buscar contato:', selectError);
      throw selectError;
    }

    // Se encontrou mais de 1 variante, pega o que bate exato primeiro, senão o mais antigo
    const existingContact = (existingContacts || []).find(c => c.jid === remoteJid)
      || (existingContacts || []).find(c => c.phone === phone)
      || (existingContacts || [])[0]
      || null;

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

      // Salva o lid_jid no contato existente quando msg veio via @lid e ele ainda não tinha
      if (lidJid && !existingContact.lid_jid) {
        const { data: updatedLid } = await supabase
          .from('contacts')
          .update({ lid_jid: lidJid, updated_at: new Date().toISOString() })
          .eq('id', existingContact.id)
          .select()
          .single();
        if (updatedLid) {
          contact = updatedLid;
          console.log(`[lid] lid_jid ${lidJid} associado ao contato ${existingContact.id}`);
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
          lid_jid: lidJid,
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

    // 8.1 Auto-transcrição de áudio recebido (não só campanhas).
    //     Só transcreve msgs do contato (from_me=false) — áudios enviados pelo
    //     próprio bot/operador não precisam de transcrição.
    //     Async/fire-and-forget: não bloqueia o webhook.
    const isAudioRecebido =
      messageType === 'audio' && !Boolean(data.key.fromMe) && Deno.env.get('OPENAI_API_KEY');
    if (isAudioRecebido) {
      const transcribeUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/transcrever-audio`;
      const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      fetch(transcribeUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${svcKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message_id: newMessage.id }),
      }).catch((e) => console.warn('[auto-transcribe] fire-and-forget falhou:', e));
    }

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

        // ── LGPD Opt-out: detecta "parar"/"remover"/etc na msg do contato ──
        // CUIDADOS contra falso positivo:
        //   1. Regex MUITO restritiva — só comandos claros, não preposição "para".
        //      Bug histórico (27/04): "Para o Wilson..." disparava opt-out porque
        //      o regex tinha `parar?` que aceitava "para" sem o "r" final.
        //   2. Whitelist da equipe: msgs trocadas entre membros (Maikon, Iza,
        //      Mariana, Raul) NUNCA disparam opt-out. Detecta via:
        //      - phone do remetente bate com numero_chip de instância 'atendimento'
        //      - phone do remetente bate com numero_chip de outras instâncias
        //        (admin_phones do bot, etc).
        //   3. Mensagem precisa ser CURTA (<60 chars) e o match precisa ocupar
        //      proporção significativa do texto — comando isolado, não preposição.
        let isOptOut = false;
        if (isFromContact && phone && messageText) {
          const textLower = messageText.toLowerCase().trim();
          // ⚠️ Regex apertada: só palavras inequívocas. Sem `para` (preposição),
          // sem `sai` (3ª pessoa), sem `remove` solto.
          // Aceita: PARAR, PARE, STOP, DESCADASTRAR, UNSUBSCRIBE, frases claras.
          const optOutRegex =
            /^(parar|pare\b|para\s+de\s+(mandar|enviar)|remover\s+(meu|meus)|stop\b|descadastrar|desinscrever|unsubscribe|cancelar\s+(inscri|cadastr)|n[ãa]o\s+quero\s+mais\s+(receber|mensagens|contat)|n[ãa]o\s+envi(e|ar|em)\s+mais|n[ãa]o\s+me\s+mand(e|ar|em)\s+mais)\b/i;
          const matches = optOutRegex.test(textLower) && textLower.length < 60;

          // Whitelist da equipe: se phone do remetente é número de instância
          // (atendimento ou disparo) ou bot_admin_phones do config_global,
          // NÃO dispara opt-out. Msg interna entre Maikon/Iza/Mariana/Raul.
          let isInternalTeam = false;
          if (matches) {
            const phoneOnlyDigits = phone.replace(/\D/g, '');
            const last10 = phoneOnlyDigits.slice(-10);
            const variants = gerarVariantesTelefoneBR(phone);

            const { data: instRows } = await supabase
              .from('instancias_whatsapp')
              .select('numero_chip, finalidade')
              .neq('status', 'deletada');
            const instPhones = (instRows || [])
              .map((r: { numero_chip?: string }) => (r.numero_chip || '').replace(/\D/g, ''))
              .filter(Boolean);

            const { data: cfgBot } = await supabase
              .from('config_global')
              .select('bot_admin_phones')
              .limit(1)
              .single();
            const adminPhones: string[] = Array.isArray((cfgBot as { bot_admin_phones?: string[] } | null)?.bot_admin_phones)
              ? ((cfgBot as { bot_admin_phones: string[] }).bot_admin_phones).map(p => p.replace(/\D/g, ''))
              : [];

            const allTeam = [...instPhones, ...adminPhones];
            isInternalTeam = allTeam.some(t => {
              if (!t) return false;
              const tLast10 = t.slice(-10);
              return tLast10 === last10 || variants.some(v => v === t || v.endsWith(tLast10));
            });

            if (isInternalTeam) {
              console.log(`[opt-out] SKIP — phone ${phone} é da equipe interna (msg entre Maikon/Iza/Mariana/Raul)`);
            }
          }

          if (matches && !isInternalTeam) {
            isOptOut = true;
            console.log(`[opt-out] Detectado em msg do ${phone}: "${messageText.slice(0, 60)}"`);
            try {
              const phoneVariants = gerarVariantesTelefoneBR(phone);

              // 1. Marca todos campanha_envios ativos desse telefone como descartado
              const { data: enviosAtivos } = await supabase
                .from('campanha_envios')
                .select('id, lead_id')
                .in('telefone', phoneVariants)
                .in('status', ['pendente', 'enviado', 'em_conversa', 'qualificado']);

              if (enviosAtivos && enviosAtivos.length > 0) {
                const ids = enviosAtivos.map((e: { id: string }) => e.id);
                await supabase.from('campanha_envios')
                  .update({ status: 'descartado', erro: `Opt-out via WhatsApp: "${messageText.slice(0, 100)}"` })
                  .in('id', ids);
                console.log(`[opt-out] ${ids.length} envios marcados como descartado`);

                // 2. Pega lead_ids únicos e insere em blacklist
                const leadIds = [...new Set(enviosAtivos.map((e: { lead_id: string }) => e.lead_id).filter(Boolean))];
                for (const leadId of leadIds) {
                  await supabase.from('lead_blacklist')
                    .upsert({ lead_id: leadId, motivo: `Opt-out via WhatsApp: "${messageText.slice(0, 100)}"` }, { onConflict: 'lead_id' })
                    .select();
                }
                console.log(`[opt-out] ${leadIds.length} leads adicionados em lead_blacklist`);
              }

              // 3. Envia confirmação LGPD pro contato (obrigação legal)
              if (instanceName) {
                try {
                  const evoUrl = Deno.env.get('EVOLUTION_API_URL') || 'https://sdsd-evolution-api.r65ocn.easypanel.host';
                  const evoKey = Deno.env.get('EVOLUTION_API_KEY');
                  if (evoKey) {
                    await fetch(`${evoUrl}/message/sendText/${encodeURIComponent(instanceName)}`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'apikey': evoKey },
                      body: JSON.stringify({
                        number: phone,
                        text: 'Recebido. Seu contato foi removido das nossas listas de comunicação. Não enviaremos mais mensagens. Obrigado!'
                      })
                    }).catch((e) => console.warn('[opt-out] erro ao enviar confirmação:', e));
                  }
                } catch (sendErr) {
                  console.warn('[opt-out] erro envio confirmação:', sendErr);
                }
              }
            } catch (optOutErr) {
              console.error('[opt-out] erro ao processar:', optOutErr);
            }
          }
        }

        // ── Fila de debounce: evita múltiplas chamadas IA quando lead manda várias msgs ──
        // Toda msg de contato em campanha ativa vai pra campanha_msg_queue.
        // n8n webhook `campanha-msg-debounce` vai aguardar 10s e checar se essa é a última msg desse phone.
        // Se for, consolida histórico + dispara IA. Se não, silenciosamente sai.
        //
        // Skipamos se foi opt-out (já marcamos descartado).
        if (!isOptOut && isFromContact && contact?.id && phone) {
          try {
            const { data: envioAtivo } = await supabase
              .from('campanha_envios')
              .select('id, status, respondeu_em, telefone, campanha:campanha_id(status, briefing_ia)')
              .in('telefone', gerarVariantesTelefoneBR(phone))
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

                // ── Processa mídia (Whisper/Vision) ANTES de enfileirar ──
                // Só pra contatos em campanha ativa, evita gastar OpenAI/Gemini com spam.
                let processedText = messageText;
                try {
                  if (messageType === 'audio' && mediaBase64) {
                    const openaiKey = Deno.env.get('OPENAI_API_KEY');
                    if (openaiKey) {
                      const bin = Uint8Array.from(atob(mediaBase64), c => c.charCodeAt(0));
                      const blob = new Blob([bin], { type: mediaMimeType || 'audio/ogg' });
                      const form = new FormData();
                      form.append('file', blob, mediaFileName || 'audio.ogg');
                      form.append('model', 'whisper-1');
                      form.append('language', 'pt');
                      const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${openaiKey}` },
                        body: form,
                      });
                      if (r.ok) {
                        const j = await r.json();
                        if (j.text) {
                          processedText = `[Áudio]: ${j.text}`;
                          console.log(`[whisper] transcrição: ${j.text.slice(0, 80)}`);
                        }
                      } else {
                        console.warn('[whisper] falha', r.status, await r.text().catch(() => ''));
                      }
                    }
                  } else if (messageType === 'image' && mediaBase64) {
                    const geminiKey = Deno.env.get('GEMINI_API_KEY');
                    if (geminiKey) {
                      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
                        body: JSON.stringify({
                          contents: [{
                            role: 'user',
                            parts: [
                              { text: 'Descreva essa imagem em português, de forma objetiva, em 1-2 frases. Se for documento médico (CRM, RQE, diploma, exame, comprovante), extraia números e dados visíveis.' },
                              { inline_data: { mime_type: mediaMimeType || 'image/jpeg', data: mediaBase64 } }
                            ]
                          }],
                          generationConfig: { temperature: 0.2, maxOutputTokens: 300 }
                        }),
                      });
                      if (r.ok) {
                        const j = await r.json();
                        const desc = j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        if (desc) {
                          const caption = (messageText && messageText !== '📷 Imagem') ? ` (legenda: ${messageText})` : '';
                          processedText = `[Imagem]: ${desc}${caption}`;
                          console.log(`[vision] descrição: ${desc.slice(0, 80)}`);
                        }
                      } else {
                        console.warn('[vision] falha', r.status);
                      }
                    }
                  }
                } catch (mediaErr) {
                  console.warn('[media-process] erro ignorável:', mediaErr);
                }

                // ── Enfileira msg + dispara n8n debounce (10s) ──
                try {
                  const { data: queued } = await supabase
                    .from('campanha_msg_queue')
                    .insert({
                      phone,
                      contact_id: contact.id,
                      wa_message_id: messageId,
                      text: processedText,
                      message_type: messageType,
                      media_url: mediaUrl,
                      instance_name: instanceName,
                      instance_uuid: instanciaWhatsappId,
                      from_me: false,
                    })
                    .select('id, created_at')
                    .single();

                  // Atualiza messages.text com texto processado (transcrição/descrição),
                  // pra que o histórico que a IA consulta tenha o conteúdo real, não placeholder
                  if (processedText !== messageText && messageId) {
                    await supabase
                      .from('messages')
                      .update({ text: processedText })
                      .eq('wa_message_id', messageId)
                      .eq('from_me', false);
                  }

                  if (queued?.id) {
                    // Dispara n8n webhook que vai aguardar 10s + checar owner + chamar IA
                    fetch('https://sdsd-n8n.r65ocn.easypanel.host/webhook/campanha-msg-debounce', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        queue_msg_id: queued.id,
                        phone,
                        campanha_envio_id: envioAtivo.id,
                        queued_at: queued.created_at,
                      }),
                    }).catch((e) => console.warn('[debounce] erro trigger n8n:', e));
                  }
                } catch (qErr) {
                  console.warn('[debounce] erro enfileirar:', qErr);
                }
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
