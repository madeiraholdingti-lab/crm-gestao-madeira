import "https://deno.land/x/xhr@0.1.0/mod.ts";
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
const { 
      action, // 'react' | 'delete' | 'reply' | 'edit'
      instancia_whatsapp_id,
      remote_jid,
      message_id,
      from_me,
      // For reactions
      emoji,
      // For replies
      reply_text,
      conversa_id,
      user_id,
      // For edit
      new_text
    } = await req.json();

    console.log(`[MESSAGE-ACTION] Ação: ${action}, Message ID: ${message_id}`);

    if (!action || !instancia_whatsapp_id || !remote_jid || !message_id) {
      return new Response(
        JSON.stringify({ success: false, message: "Parâmetros obrigatórios: action, instancia_whatsapp_id, remote_jid, message_id" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Inicializar Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Buscar a instância WhatsApp
    const { data: instancia, error: instanciaError } = await supabase
      .from('instancias_whatsapp')
      .select('id, instancia_id, nome_instancia')
      .eq('id', instancia_whatsapp_id)
      .single();
    
    if (instanciaError || !instancia) {
      console.error("Instância não encontrada:", instanciaError);
      return new Response(
        JSON.stringify({ success: false, message: "Instância WhatsApp não encontrada" }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Buscar configuração global
    const { data: config, error: configError } = await supabase
      .from('config_global')
      .select('evolution_base_url, evolution_api_key')
      .single();
    
    if (configError || !config) {
      console.error("Erro ao buscar configuração:", configError);
      return new Response(
        JSON.stringify({ success: false, message: "Falha ao buscar configuração da Evolution API" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const evolutionApiKey = config.evolution_api_key || Deno.env.get('EVOLUTION_API_KEY');
    const evolutionBaseUrl = config.evolution_base_url;
    const instanceName = encodeURIComponent(instancia.nome_instancia);

    let result;

    switch (action) {
      case 'react': {
        if (!emoji) {
          return new Response(
            JSON.stringify({ success: false, message: "Emoji é obrigatório para reação" }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const reactionUrl = `${evolutionBaseUrl}/message/sendReaction/${instanceName}`;
        const payload = {
          key: {
            remoteJid: remote_jid,
            fromMe: from_me,
            id: message_id
          },
          reaction: emoji // Use empty string "" to remove reaction
        };

        console.log(`[REACT] URL: ${reactionUrl}`);
        console.log(`[REACT] Payload:`, JSON.stringify(payload));

        const response = await fetch(reactionUrl, {
          method: 'POST',
          headers: {
            'apikey': evolutionApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload)
        });

        const responseBody = await response.text();
        console.log(`[REACT] Response: ${response.status} - ${responseBody}`);

        if (!response.ok) {
          return new Response(
            JSON.stringify({ success: false, message: "Erro ao enviar reação", details: responseBody }),
            { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        result = { success: true, message: "Reação enviada com sucesso" };
        break;
      }

      case 'delete': {
        const deleteUrl = `${evolutionBaseUrl}/chat/deleteMessageForEveryone/${instanceName}`;
        // Evolution API v2 expects id, fromMe, remoteJid at root level
        const payload = {
          id: message_id,
          fromMe: from_me,
          remoteJid: remote_jid
        };

        console.log(`[DELETE] URL: ${deleteUrl}`);
        console.log(`[DELETE] Payload:`, JSON.stringify(payload));

        const response = await fetch(deleteUrl, {
          method: 'DELETE',
          headers: {
            'apikey': evolutionApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload)
        });

        const responseBody = await response.text();
        console.log(`[DELETE] Response: ${response.status} - ${responseBody}`);

        if (!response.ok) {
          return new Response(
            JSON.stringify({ success: false, message: "Erro ao apagar mensagem", details: responseBody }),
            { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        result = { success: true, message: "Mensagem apagada com sucesso" };
        break;
      }

      case 'reply': {
        if (!reply_text || !conversa_id) {
          return new Response(
            JSON.stringify({ success: false, message: "reply_text e conversa_id são obrigatórios para resposta" }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Buscar o número real do contato via conversa
        const { data: conversaData, error: conversaError } = await supabase
          .from('conversas')
          .select('numero_contato, contact_id, contacts(phone, jid)')
          .eq('id', conversa_id)
          .single();

        if (conversaError || !conversaData) {
          console.error("[REPLY] Erro ao buscar conversa:", conversaError);
          return new Response(
            JSON.stringify({ success: false, message: "Conversa não encontrada" }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Usar o número do contato, não o JID (que pode ser um LID)
        let numero_contato = conversaData.numero_contato;
        
        // Se tiver contact relacionado, usar o phone do contact
        if (conversaData.contacts && (conversaData.contacts as any).phone) {
          numero_contato = (conversaData.contacts as any).phone;
        }

        // Garantir que é só o número (sem @s.whatsapp.net)
        if (numero_contato.includes('@')) {
          numero_contato = numero_contato.split('@')[0];
        }

        // Formatar para uso na Evolution API
        const remoteJidForQuoted = remote_jid; // Manter o JID original para quoted

        console.log(`[REPLY] Número do contato: ${numero_contato}, JID original: ${remote_jid}`);

        const replyUrl = `${evolutionBaseUrl}/message/sendText/${instanceName}`;
        const payload = {
          number: numero_contato,
          text: reply_text,
          quoted: {
            key: {
              remoteJid: remoteJidForQuoted,
              fromMe: from_me,
              id: message_id
            }
          }
        };

        console.log(`[REPLY] URL: ${replyUrl}`);
        console.log(`[REPLY] Payload:`, JSON.stringify(payload));

        const response = await fetch(replyUrl, {
          method: 'POST',
          headers: {
            'apikey': evolutionApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload)
        });

        const responseBody = await response.text();
        console.log(`[REPLY] Response: ${response.status} - ${responseBody}`);

        if (!response.ok) {
          return new Response(
            JSON.stringify({ success: false, message: "Erro ao enviar resposta", details: responseBody }),
            { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Registrar a resposta no banco
        let responseData;
        try {
          responseData = JSON.parse(responseBody);
        } catch (e) {}

        const waMessageId = responseData?.key?.id;

        if (user_id) {
          await supabase
            .from('mensagens')
            .insert({
              conversa_id: conversa_id,
              conteudo: reply_text,
              remetente: 'enviada',
              tipo_mensagem: 'texto',
              enviado_por: user_id,
              wa_message_id: waMessageId,
              status: 'PENDING'
            });

          await supabase
            .from('conversas')
            .update({
              ultima_mensagem: reply_text,
              ultima_interacao: new Date().toISOString()
            })
            .eq('id', conversa_id);
        }

        result = { success: true, message: "Resposta enviada com sucesso" };
        break;
      }

      case 'edit': {
        if (!new_text) {
          return new Response(
            JSON.stringify({ success: false, message: "new_text é obrigatório para edição" }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!from_me) {
          return new Response(
            JSON.stringify({ success: false, message: "Só é possível editar mensagens enviadas por você" }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Buscar o número do contato
        const { data: conversaData } = await supabase
          .from('conversas')
          .select('numero_contato, contacts(phone)')
          .eq('id', conversa_id)
          .single();

        let numero_contato = conversaData?.numero_contato || '';
        if (conversaData?.contacts && (conversaData.contacts as any).phone) {
          numero_contato = (conversaData.contacts as any).phone;
        }
        if (numero_contato.includes('@')) {
          numero_contato = numero_contato.split('@')[0];
        }

        const editUrl = `${evolutionBaseUrl}/chat/updateMessage/${instanceName}`;
        const payload = {
          number: numero_contato,
          text: new_text,
          key: {
            remoteJid: remote_jid,
            fromMe: true,
            id: message_id
          }
        };

        console.log(`[EDIT] URL: ${editUrl}`);
        console.log(`[EDIT] Payload:`, JSON.stringify(payload));

        const response = await fetch(editUrl, {
          method: 'POST',
          headers: {
            'apikey': evolutionApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload)
        });

        const responseBody = await response.text();
        console.log(`[EDIT] Response: ${response.status} - ${responseBody}`);

        if (!response.ok) {
          return new Response(
            JSON.stringify({ success: false, message: "Erro ao editar mensagem", details: responseBody }),
            { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Atualizar a mensagem no banco com flag de editada
        await supabase
          .from('messages')
          .update({ text: new_text, is_edited: true })
          .eq('wa_message_id', message_id);

        result = { success: true, message: "Mensagem editada com sucesso" };
        break;
      }

      default:
        return new Response(
          JSON.stringify({ success: false, message: `Ação desconhecida: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[MESSAGE-ACTION] Erro:', error);
    return new Response(
      JSON.stringify({ success: false, message: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
