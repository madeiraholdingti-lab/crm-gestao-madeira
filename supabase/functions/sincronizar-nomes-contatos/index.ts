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
      console.error('[SYNC-NOMES] Erro ao buscar configuração:', configError);
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
    const limit = body.limit || 100;

    // Buscar TODAS as instâncias do banco de dados
    const { data: instancias, error: instanciasError } = await supabase
      .from('instancias_whatsapp')
      .select('id, nome_instancia, instancia_id, status, connection_status')
      .neq('status', 'deletada');

    if (instanciasError) {
      console.error('[SYNC-NOMES] Erro ao buscar instâncias:', instanciasError);
      return new Response(
        JSON.stringify({ error: 'Erro ao buscar instâncias' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Buscar instâncias conectadas na Evolution API
    // Observação: dependendo da versão/integração, a Evolution pode retornar o identificador
    // da instância em campos diferentes (name / instanceName / instanceId). Então coletamos todos.
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
          .flatMap((inst: any) => [inst.name, inst.instanceName, inst.instanceId].filter(Boolean));
        
        console.log(`[SYNC-NOMES] Instâncias conectadas na Evolution: ${instanciasConectadas.join(', ')}`);
      }
    } catch (err) {
      console.error('[SYNC-NOMES] Erro ao buscar instâncias da Evolution:', err);
    }

    // Se não conseguiu buscar da Evolution, usar todas as instâncias do banco
    const instanciasConectadasSet = new Set((instanciasConectadas || []).filter(Boolean));
    const instanciasParaUsar = instanciasConectadasSet.size > 0
      ? (instancias || []).filter(i => instanciasConectadasSet.has(i.nome_instancia) || instanciasConectadasSet.has(i.instancia_id))
      : (instancias || []).filter(i => i.status === 'ativa');

    const getEvolutionInstanceName = (inst: any): string | null => {
      const candidates = [inst?.nome_instancia, inst?.instancia_id].filter(Boolean) as string[];
      // Preferir o identificador que a Evolution reportou como conectado
      for (const c of candidates) {
        if (instanciasConectadasSet.has(c)) return c;
      }
      return candidates[0] || null;
    };

    console.log(`[SYNC-NOMES] Usando ${instanciasParaUsar.length} instâncias para sincronização`);

    if (instanciasParaUsar.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Nenhuma instância conectada encontrada' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Lista de nomes de instância/bot conhecidos (para ignorar/limpar)
    // Também adicionar os nomes de TODAS as instâncias do sistema.
    //
    // Inclui também "nomes contaminados" — pushNames de remetentes de grupo
    // que foram aplicados em massa a participantes em syncs históricos
    // (bug pré-migração 04/2026). Manter na lista previne regressão se
    // algum webhook antigo tentar reaplicar.
    const nomesInstanciaBloqueados = [
      'Dr. Maikon Madeira', 'Dr Maikon Madeira', 'Maikon GSS', 'RUBI',
      'Disparos3367', 'Isadora ', 'Rafaela', 'Disparos Cardiologista',
      'isadoraVolek', 'PacientesRafaela', 'Maikon Madeira',
      'Dr Maikon Madeira Gss Saúde .:', 'Dr Maikon Madeira Gss Saúde',
      // Nomes contaminados via pushName de grupos
      'Dr. Sandro Valério Fadel',
      'Gestao Serviço Saúde',
      'Mariana Chiarello - Assistente Administrativa',
      'Bruno Sampaio - Wati',
      // Adicionar nomes de todas as instâncias do banco
      ...(instancias || []).flatMap(i => [i.nome_instancia, i.instancia_id]).filter(Boolean)
    ];

    const nomesInstanciaBloqueadosUniq = Array.from(
      new Set(
        nomesInstanciaBloqueados
          .map(n => String(n).trim())
          .filter(Boolean)
      )
    );

    // PASSO 1: Limpar nomes de instância existentes no banco
    console.log('[SYNC-NOMES] Limpando nomes de instância do banco...');
    let cleanedCount = 0;

    // Limpeza por match exato (bem mais rápida que loop)
    const { data: cleanedContactsExact } = await supabase
      .from('contacts')
      .update({ name: null, updated_at: new Date().toISOString() })
      .in('name', nomesInstanciaBloqueadosUniq)
      .select('id');

    if (cleanedContactsExact && cleanedContactsExact.length > 0) {
      cleanedCount += cleanedContactsExact.length;
      console.log(`[SYNC-NOMES] Limpou ${cleanedContactsExact.length} contatos por match exato (lista de instâncias)`);
    }

    await supabase
      .from('conversas')
      .update({ nome_contato: null, updated_at: new Date().toISOString() })
      .in('nome_contato', nomesInstanciaBloqueadosUniq);

    // Também limpar com ILIKE para variações
    const { data: cleanedMaikon } = await supabase
      .from('contacts')
      .update({ name: null, updated_at: new Date().toISOString() })
      .ilike('name', '%Maikon Madeira Gss%')
      .select('id');
    
    if (cleanedMaikon && cleanedMaikon.length > 0) {
      cleanedCount += cleanedMaikon.length;
      console.log(`[SYNC-NOMES] Limpou ${cleanedMaikon.length} contatos com variações de Maikon`);
    }

    await supabase
      .from('conversas')
      .update({ nome_contato: null, updated_at: new Date().toISOString() })
      .ilike('nome_contato', '%Maikon Madeira Gss%');

    console.log(`[SYNC-NOMES] Total de contatos limpos: ${cleanedCount}`);

    // PASSO 2: Buscar contatos que precisam de nome atualizado
    // Priorizar: nome nulo/vazio OU nome já conhecido como instância.
    const idsSelecionados = new Set<string>();
    const contatosSelecionados: any[] = [];

    const pushContacts = (rows: any[] | null | undefined) => {
      for (const r of rows || []) {
        if (!r?.id || idsSelecionados.has(r.id)) continue;
        idsSelecionados.add(r.id);
        contatosSelecionados.push(r);
        if (contatosSelecionados.length >= limit) break;
      }
    };

    const { data: contatosSemNome, error: semNomeError } = await supabase
      .from('contacts')
      .select('id, phone, jid, name')
      .or('name.is.null,name.eq.')
      .not('jid', 'ilike', '%@g.us')
      .not('jid', 'ilike', '%@broadcast')
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (semNomeError) {
      console.error('[SYNC-NOMES] Erro ao buscar contatos sem nome:', semNomeError);
    }
    pushContacts(contatosSemNome);

    if (contatosSelecionados.length < limit) {
      const remaining = limit - contatosSelecionados.length;
      const { data: contatosComNomeDeInstancia, error: instNameError } = await supabase
        .from('contacts')
        .select('id, phone, jid, name')
        .in('name', nomesInstanciaBloqueadosUniq)
        .not('jid', 'ilike', '%@g.us')
        .not('jid', 'ilike', '%@broadcast')
        .order('updated_at', { ascending: false })
        .limit(remaining);

      if (instNameError) {
        console.error('[SYNC-NOMES] Erro ao buscar contatos com nome de instância:', instNameError);
      }
      pushContacts(contatosComNomeDeInstancia);
    }

    // Preencher o restante com os mais recentes (caso ainda falte)
    if (contatosSelecionados.length < limit) {
      const remaining = limit - contatosSelecionados.length;
      const { data: contatosRecentes, error: recentesError } = await supabase
        .from('contacts')
        .select('id, phone, jid, name')
        .not('jid', 'ilike', '%@g.us')
        .not('jid', 'ilike', '%@broadcast')
        .order('updated_at', { ascending: false })
        .limit(remaining);

      if (recentesError) {
        console.error('[SYNC-NOMES] Erro ao buscar contatos recentes:', recentesError);
      }
      pushContacts(contatosRecentes);
    }

    const contacts = contatosSelecionados;

    // Filtrar contatos que realmente precisam de atualização
    const contatosParaAtualizar = (contacts || []).filter(c => {
      const nome = (c.name || '').trim();
      const phone = (c.phone || '').trim();
      
      if (!nome) return true;
      if (nome === phone || nome === phone.replace(/\D/g, '')) return true;
      if (nomesInstanciaBloqueadosUniq.some(n => nome.toLowerCase() === n.toLowerCase())) return true;
      
      return false;
    });

    console.log(`[SYNC-NOMES] Encontrados ${contacts?.length || 0} contatos, ${contatosParaAtualizar.length} precisam de atualização`);

    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;
    const results: { phone: string; success: boolean; newName?: string; instance?: string; error?: string }[] = [];

    const normalizePhoneCandidates = (raw: string): string[] => {
      const digits = String(raw || '').replace(/\D/g, '');
      if (!digits) return [];

      const candidates = new Set<string>();
      candidates.add(digits);
      // Se vier com 55 + DDD + número, também tentar sem 55
      if (digits.startsWith('55') && digits.length >= 12) {
        candidates.add(digits.slice(2));
      }
      // Sempre tentar os últimos 11 dígitos (DDD + número)
      if (digits.length > 11) {
        candidates.add(digits.slice(-11));
      }
      return Array.from(candidates);
    };

    const buildFindContactsBody = (jid: string | null | undefined, phone: string | null | undefined) => {
      const attempts: string[] = [];
      const jidStr = (jid || '').trim();
      const phoneDigits = String(phone || '').replace(/\D/g, '');

      if (jidStr) attempts.push(jidStr);
      if (phoneDigits) {
        attempts.push(`${phoneDigits}@s.whatsapp.net`);
        attempts.push(`${phoneDigits}@lid`);
        // Alguns provedores usam só o número como id
        attempts.push(phoneDigits);
      }

      return Array.from(new Set(attempts)).map(id => ({ where: { id } }));
    };

    for (const contact of contatosParaAtualizar) {
      let updated = false;
      
      // Tentar com cada instância conectada até conseguir
      for (const instancia of instanciasParaUsar) {
        if (updated) break;

        const evolutionInstanceName = getEvolutionInstanceName(instancia);
        if (!evolutionInstanceName) continue;
        
        try {
          // Tentar múltiplas chaves de busca, pois alguns contatos vêm como @lid
          const bodies = buildFindContactsBody(contact.jid, contact.phone);
          let contactInfo: any = null;

          for (const b of bodies) {
            const response = await fetch(`${evolutionUrl}/chat/findContacts/${encodeURIComponent(evolutionInstanceName)}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'apikey': evolutionApiKey,
              },
              body: JSON.stringify(b),
            });

            if (!response.ok) {
              continue;
            }

            const data = await response.json();
            const maybe = Array.isArray(data) ? data[0] : data;
            if (maybe && Object.keys(maybe).length > 0) {
              contactInfo = maybe;
              break;
            }
          }

          if (!contactInfo) {
            continue; // Tentar próxima instância
          }

          const pushName = contactInfo?.pushName || contactInfo?.name || contactInfo?.notify || null;

          if (pushName) {
            const trimmedName = String(pushName).trim();
            
            // Verificar se o nome obtido NÃO é um nome de instância/bot
            const isNomeInvalido = nomesInstanciaBloqueadosUniq.some(n => 
              trimmedName.toLowerCase() === n.toLowerCase()
            );

            const isNomeIgualTelefone = trimmedName === contact.phone || 
                                         trimmedName === contact.phone.replace(/\D/g, '');

            if (isNomeInvalido || isNomeIgualTelefone) {
              continue; // Tentar próxima instância
            }

            // Atualizar contato com o nome obtido
            const { error: updateError } = await supabase
              .from('contacts')
              .update({ 
                name: trimmedName,
                updated_at: new Date().toISOString()
              })
              .eq('id', contact.id);

            if (!updateError) {
              // Também atualizar na tabela conversas
              // Preferir por contact_id (mais confiável); fallback por variações de telefone
              const phoneCandidates = normalizePhoneCandidates(contact.phone);
              const orParts = [`contact_id.eq.${contact.id}`];
              for (const p of phoneCandidates) orParts.push(`numero_contato.eq.${p}`);

              await supabase
                .from('conversas')
                .update({ 
                  nome_contato: trimmedName,
                  updated_at: new Date().toISOString()
                })
                .or(orParts.join(','));

              successCount++;
              updated = true;
              results.push({ phone: contact.phone, success: true, newName: trimmedName, instance: evolutionInstanceName });
              console.log(`[SYNC-NOMES] Nome atualizado para ${contact.phone}: "${trimmedName}" (via ${evolutionInstanceName})`);
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
        skippedCount++;
        results.push({ phone: contact.phone, success: false, error: 'Nenhuma instância retornou nome válido' });
      }

      // Delay entre contatos
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    console.log(`[SYNC-NOMES] Concluído: ${cleanedCount} limpos, ${successCount} atualizados, ${failCount} falhas, ${skippedCount} ignorados`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        total: contacts?.length || 0,
        processed: contatosParaAtualizar.length,
        cleanedCount,
        instanciasUsadas: instanciasParaUsar.map(i => getEvolutionInstanceName(i)).filter(Boolean),
        successCount,
        failCount,
        skippedCount,
        results 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[SYNC-NOMES] Erro geral:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
