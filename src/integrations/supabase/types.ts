export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      briefings_home: {
        Row: {
          conteudo: string
          gerado_em: string | null
          id: string
          links_acao: Json | null
          user_id: string | null
        }
        Insert: {
          conteudo: string
          gerado_em?: string | null
          id?: string
          links_acao?: Json | null
          user_id?: string | null
        }
        Update: {
          conteudo?: string
          gerado_em?: string | null
          id?: string
          links_acao?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "briefings_home_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      campanha_envios: {
        Row: {
          campanha_id: string
          created_at: string
          enviado_em: string | null
          envio_id: string | null
          erro: string | null
          id: string
          lead_id: string
          status: string | null
          telefone: string
          tentativas: number | null
          wa_message_id: string | null
        }
        Insert: {
          campanha_id: string
          created_at?: string
          enviado_em?: string | null
          envio_id?: string | null
          erro?: string | null
          id?: string
          lead_id: string
          status?: string | null
          telefone: string
          tentativas?: number | null
          wa_message_id?: string | null
        }
        Update: {
          campanha_id?: string
          created_at?: string
          enviado_em?: string | null
          envio_id?: string | null
          erro?: string | null
          id?: string
          lead_id?: string
          status?: string | null
          telefone?: string
          tentativas?: number | null
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campanha_envios_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas_disparo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_envios_envio_id_fkey"
            columns: ["envio_id"]
            isOneToOne: false
            referencedRelation: "envios_disparo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_envios_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      campanhas_disparo: {
        Row: {
          agendado_para: string | null
          concluido_em: string | null
          created_at: string
          created_by: string | null
          descricao: string | null
          dias_semana: number[] | null
          enviados: number | null
          envios_por_dia: number | null
          falhas: number | null
          filtro_especialidade: string[] | null
          filtro_perfil_profissional: string[] | null
          filtro_tipo_lead: string[] | null
          horario_fim: string | null
          horario_inicio: string | null
          id: string
          iniciado_em: string | null
          instancia_id: string | null
          intervalo_max_minutos: number | null
          intervalo_min_minutos: number | null
          mensagem: string
          nome: string
          proximo_envio_em: string | null
          script_ia_id: string | null
          status: string | null
          sucesso: number | null
          tipo: string | null
          total_leads: number | null
          updated_at: string
        }
        Insert: {
          agendado_para?: string | null
          concluido_em?: string | null
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          dias_semana?: number[] | null
          enviados?: number | null
          envios_por_dia?: number | null
          falhas?: number | null
          filtro_especialidade?: string[] | null
          filtro_perfil_profissional?: string[] | null
          filtro_tipo_lead?: string[] | null
          horario_fim?: string | null
          horario_inicio?: string | null
          id?: string
          iniciado_em?: string | null
          instancia_id?: string | null
          intervalo_max_minutos?: number | null
          intervalo_min_minutos?: number | null
          mensagem: string
          nome: string
          proximo_envio_em?: string | null
          script_ia_id?: string | null
          status?: string | null
          sucesso?: number | null
          tipo?: string | null
          total_leads?: number | null
          updated_at?: string
        }
        Update: {
          agendado_para?: string | null
          concluido_em?: string | null
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          dias_semana?: number[] | null
          enviados?: number | null
          envios_por_dia?: number | null
          falhas?: number | null
          filtro_especialidade?: string[] | null
          filtro_perfil_profissional?: string[] | null
          filtro_tipo_lead?: string[] | null
          horario_fim?: string | null
          horario_inicio?: string | null
          id?: string
          iniciado_em?: string | null
          instancia_id?: string | null
          intervalo_max_minutos?: number | null
          intervalo_min_minutos?: number | null
          mensagem?: string
          nome?: string
          proximo_envio_em?: string | null
          script_ia_id?: string | null
          status?: string | null
          sucesso?: number | null
          tipo?: string | null
          total_leads?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campanhas_disparo_instancia_id_fkey"
            columns: ["instancia_id"]
            isOneToOne: false
            referencedRelation: "instancias_whatsapp"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanhas_disparo_script_ia_id_fkey"
            columns: ["script_ia_id"]
            isOneToOne: false
            referencedRelation: "ia_scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      config_global: {
        Row: {
          created_at: string
          evolution_api_key: string | null
          evolution_base_url: string
          gemini_api_key: string | null
          id: string
          ignorar_mensagens_internas: boolean | null
          updated_at: string
          webhook_base64_enabled: boolean | null
          webhook_ia_disparos: string | null
          webhook_ia_respondendo: string | null
          webhook_url: string | null
        }
        Insert: {
          created_at?: string
          evolution_api_key?: string | null
          evolution_base_url?: string
          gemini_api_key?: string | null
          id?: string
          ignorar_mensagens_internas?: boolean | null
          updated_at?: string
          webhook_base64_enabled?: boolean | null
          webhook_ia_disparos?: string | null
          webhook_ia_respondendo?: string | null
          webhook_url?: string | null
        }
        Update: {
          created_at?: string
          evolution_api_key?: string | null
          evolution_base_url?: string
          gemini_api_key?: string | null
          id?: string
          ignorar_mensagens_internas?: boolean | null
          updated_at?: string
          webhook_base64_enabled?: boolean | null
          webhook_ia_disparos?: string | null
          webhook_ia_respondendo?: string | null
          webhook_url?: string | null
        }
        Relationships: []
      }
      contact_attachments: {
        Row: {
          contact_id: string
          created_at: string | null
          file_name: string
          file_size: number | null
          file_type: string | null
          file_url: string
          id: string
          uploaded_by: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string | null
          file_name: string
          file_size?: number | null
          file_type?: string | null
          file_url: string
          id?: string
          uploaded_by?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string | null
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_attachments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          cargo: string | null
          cidade: string | null
          classificado_em: string | null
          created_at: string
          especialidade: string | null
          id: string
          instituicao: string | null
          jid: string
          name: string | null
          observacoes: string | null
          perfil_confirmado: boolean | null
          perfil_profissional: string | null
          perfil_sugerido_ia: string | null
          phone: string
          profile_picture_url: string | null
          relevancia: string | null
          tipo_contato: string | null
          tipo_jid: string | null
          updated_at: string
        }
        Insert: {
          cargo?: string | null
          cidade?: string | null
          classificado_em?: string | null
          created_at?: string
          especialidade?: string | null
          id?: string
          instituicao?: string | null
          jid: string
          name?: string | null
          observacoes?: string | null
          perfil_confirmado?: boolean | null
          perfil_profissional?: string | null
          perfil_sugerido_ia?: string | null
          phone: string
          profile_picture_url?: string | null
          relevancia?: string | null
          tipo_contato?: string | null
          tipo_jid?: string | null
          updated_at?: string
        }
        Update: {
          cargo?: string | null
          cidade?: string | null
          classificado_em?: string | null
          created_at?: string
          especialidade?: string | null
          id?: string
          instituicao?: string | null
          jid?: string
          name?: string | null
          observacoes?: string | null
          perfil_confirmado?: boolean | null
          perfil_profissional?: string | null
          perfil_sugerido_ia?: string | null
          phone?: string
          profile_picture_url?: string | null
          relevancia?: string | null
          tipo_contato?: string | null
          tipo_jid?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      conversas: {
        Row: {
          anotacao_transferencia: string | null
          contact_id: string | null
          created_at: string
          current_instance_id: string | null
          fixada: boolean
          follow_up_em: string | null
          follow_up_nota: string | null
          foto_contato: string | null
          id: string
          instancia_id: string | null
          last_message_from_me: boolean | null
          nome_contato: string | null
          numero_contato: string
          numero_whatsapp_id: string | null
          orig_instance_id: string | null
          responsavel_atual: string | null
          status: string
          status_qualificacao: string | null
          tags: string[] | null
          ultima_interacao: string | null
          ultima_mensagem: string | null
          unread_count: number | null
          updated_at: string
        }
        Insert: {
          anotacao_transferencia?: string | null
          contact_id?: string | null
          created_at?: string
          current_instance_id?: string | null
          fixada?: boolean
          follow_up_em?: string | null
          follow_up_nota?: string | null
          foto_contato?: string | null
          id?: string
          instancia_id?: string | null
          last_message_from_me?: boolean | null
          nome_contato?: string | null
          numero_contato: string
          numero_whatsapp_id?: string | null
          orig_instance_id?: string | null
          responsavel_atual?: string | null
          status?: string
          status_qualificacao?: string | null
          tags?: string[] | null
          ultima_interacao?: string | null
          ultima_mensagem?: string | null
          unread_count?: number | null
          updated_at?: string
        }
        Update: {
          anotacao_transferencia?: string | null
          contact_id?: string | null
          created_at?: string
          current_instance_id?: string | null
          fixada?: boolean
          follow_up_em?: string | null
          follow_up_nota?: string | null
          foto_contato?: string | null
          id?: string
          instancia_id?: string | null
          last_message_from_me?: boolean | null
          nome_contato?: string | null
          numero_contato?: string
          numero_whatsapp_id?: string | null
          orig_instance_id?: string | null
          responsavel_atual?: string | null
          status?: string
          status_qualificacao?: string | null
          tags?: string[] | null
          ultima_interacao?: string | null
          ultima_mensagem?: string | null
          unread_count?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversas_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversas_current_instance_id_fkey"
            columns: ["current_instance_id"]
            isOneToOne: false
            referencedRelation: "instancias_whatsapp"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversas_instancia_id_fkey"
            columns: ["instancia_id"]
            isOneToOne: false
            referencedRelation: "instancias_whatsapp"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversas_numero_whatsapp_id_fkey"
            columns: ["numero_whatsapp_id"]
            isOneToOne: false
            referencedRelation: "numeros_whatsapp"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversas_orig_instance_id_fkey"
            columns: ["orig_instance_id"]
            isOneToOne: false
            referencedRelation: "instancias_whatsapp"
            referencedColumns: ["id"]
          },
        ]
      }
      envios_disparo: {
        Row: {
          agendado_para: string | null
          ativo: boolean
          campanha_id: string
          concluido_em: string | null
          created_at: string
          created_by: string | null
          dias_semana: number[] | null
          enviados: number | null
          envios_por_dia: number | null
          falhas: number | null
          filtro_tipo_lead: string[] | null
          horario_fim: string | null
          horario_inicio: string | null
          id: string
          iniciado_em: string | null
          instancia_id: string | null
          intervalo_max_minutos: number | null
          intervalo_min_minutos: number | null
          proximo_envio_em: string | null
          status: string | null
          sucesso: number | null
          total_leads: number | null
          updated_at: string
        }
        Insert: {
          agendado_para?: string | null
          ativo?: boolean
          campanha_id: string
          concluido_em?: string | null
          created_at?: string
          created_by?: string | null
          dias_semana?: number[] | null
          enviados?: number | null
          envios_por_dia?: number | null
          falhas?: number | null
          filtro_tipo_lead?: string[] | null
          horario_fim?: string | null
          horario_inicio?: string | null
          id?: string
          iniciado_em?: string | null
          instancia_id?: string | null
          intervalo_max_minutos?: number | null
          intervalo_min_minutos?: number | null
          proximo_envio_em?: string | null
          status?: string | null
          sucesso?: number | null
          total_leads?: number | null
          updated_at?: string
        }
        Update: {
          agendado_para?: string | null
          ativo?: boolean
          campanha_id?: string
          concluido_em?: string | null
          created_at?: string
          created_by?: string | null
          dias_semana?: number[] | null
          enviados?: number | null
          envios_por_dia?: number | null
          falhas?: number | null
          filtro_tipo_lead?: string[] | null
          horario_fim?: string | null
          horario_inicio?: string | null
          id?: string
          iniciado_em?: string | null
          instancia_id?: string | null
          intervalo_max_minutos?: number | null
          intervalo_min_minutos?: number | null
          proximo_envio_em?: string | null
          status?: string | null
          sucesso?: number | null
          total_leads?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "envios_disparo_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas_disparo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envios_disparo_instancia_id_fkey"
            columns: ["instancia_id"]
            isOneToOne: false
            referencedRelation: "instancias_whatsapp"
            referencedColumns: ["id"]
          },
        ]
      }
      especialidades: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          nome: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          nome: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          nome?: string
        }
        Relationships: []
      }
      eventos_agenda: {
        Row: {
          created_at: string
          data_hora_fim: string
          data_hora_inicio: string
          descricao: string | null
          google_event_id: string | null
          id: string
          medico_id: string
          paciente_id: string | null
          status: string
          tipo_evento: string
          titulo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          data_hora_fim: string
          data_hora_inicio: string
          descricao?: string | null
          google_event_id?: string | null
          id?: string
          medico_id: string
          paciente_id?: string | null
          status?: string
          tipo_evento?: string
          titulo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          data_hora_fim?: string
          data_hora_inicio?: string
          descricao?: string | null
          google_event_id?: string | null
          id?: string
          medico_id?: string
          paciente_id?: string | null
          status?: string
          tipo_evento?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: []
      }
      historico_numero_instancia: {
        Row: {
          created_at: string
          desvinculado_em: string | null
          id: string
          instancia_id: string
          motivo: string | null
          numero_whatsapp_id: string
          vinculado_em: string
        }
        Insert: {
          created_at?: string
          desvinculado_em?: string | null
          id?: string
          instancia_id: string
          motivo?: string | null
          numero_whatsapp_id: string
          vinculado_em?: string
        }
        Update: {
          created_at?: string
          desvinculado_em?: string | null
          id?: string
          instancia_id?: string
          motivo?: string | null
          numero_whatsapp_id?: string
          vinculado_em?: string
        }
        Relationships: [
          {
            foreignKeyName: "historico_numero_instancia_instancia_id_fkey"
            columns: ["instancia_id"]
            isOneToOne: false
            referencedRelation: "instancias_whatsapp"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historico_numero_instancia_numero_whatsapp_id_fkey"
            columns: ["numero_whatsapp_id"]
            isOneToOne: false
            referencedRelation: "numeros_whatsapp"
            referencedColumns: ["id"]
          },
        ]
      }
      ia_script_perguntas: {
        Row: {
          created_at: string
          id: string
          obrigatoria: boolean
          ordem: number
          pergunta: string
          script_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          obrigatoria?: boolean
          ordem?: number
          pergunta: string
          script_id: string
        }
        Update: {
          created_at?: string
          id?: string
          obrigatoria?: boolean
          ordem?: number
          pergunta?: string
          script_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ia_script_perguntas_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "ia_scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      ia_scripts: {
        Row: {
          ativo: boolean
          created_at: string
          created_by: string | null
          descricao_vaga: string | null
          detalhes_vaga: string[] | null
          id: string
          necessario_mudar: boolean | null
          nome: string
          presencial: boolean | null
          tipo_vaga: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          created_by?: string | null
          descricao_vaga?: string | null
          detalhes_vaga?: string[] | null
          id?: string
          necessario_mudar?: boolean | null
          nome: string
          presencial?: boolean | null
          tipo_vaga?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          created_by?: string | null
          descricao_vaga?: string | null
          detalhes_vaga?: string[] | null
          id?: string
          necessario_mudar?: boolean | null
          nome?: string
          presencial?: boolean | null
          tipo_vaga?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      instance_events: {
        Row: {
          created_at: string
          event: string
          id: string
          instance_name: string
          instance_uuid: string | null
          payload: Json | null
        }
        Insert: {
          created_at?: string
          event: string
          id?: string
          instance_name: string
          instance_uuid?: string | null
          payload?: Json | null
        }
        Update: {
          created_at?: string
          event?: string
          id?: string
          instance_name?: string
          instance_uuid?: string | null
          payload?: Json | null
        }
        Relationships: []
      }
      instancias_whatsapp: {
        Row: {
          ativo: boolean
          connection_status: string | null
          cor_identificacao: string | null
          created_at: string
          criado_por: string | null
          id: string
          instancia_id: string
          nome_instancia: string
          numero_chip: string | null
          qrcode_base64: string | null
          qrcode_updated_at: string | null
          status: string
          tipo_canal: string | null
          token_instancia: string | null
          token_zapi: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          connection_status?: string | null
          cor_identificacao?: string | null
          created_at?: string
          criado_por?: string | null
          id?: string
          instancia_id: string
          nome_instancia: string
          numero_chip?: string | null
          qrcode_base64?: string | null
          qrcode_updated_at?: string | null
          status?: string
          tipo_canal?: string | null
          token_instancia?: string | null
          token_zapi?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          connection_status?: string | null
          cor_identificacao?: string | null
          created_at?: string
          criado_por?: string | null
          id?: string
          instancia_id?: string
          nome_instancia?: string
          numero_chip?: string | null
          qrcode_base64?: string | null
          qrcode_updated_at?: string | null
          status?: string
          tipo_canal?: string | null
          token_instancia?: string | null
          token_zapi?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      lead_blacklist: {
        Row: {
          adicionado_por: string | null
          created_at: string
          id: string
          lead_id: string
          motivo: string | null
        }
        Insert: {
          adicionado_por?: string | null
          created_at?: string
          id?: string
          lead_id: string
          motivo?: string | null
        }
        Update: {
          adicionado_por?: string | null
          created_at?: string
          id?: string
          lead_id?: string
          motivo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_blacklist_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_campanha_historico: {
        Row: {
          campanha_id: string
          created_at: string
          enviado_em: string | null
          id: string
          lead_id: string
          status: string | null
        }
        Insert: {
          campanha_id: string
          created_at?: string
          enviado_em?: string | null
          id?: string
          lead_id: string
          status?: string | null
        }
        Update: {
          campanha_id?: string
          created_at?: string
          enviado_em?: string | null
          id?: string
          lead_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_campanha_historico_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas_disparo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_campanha_historico_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_comment_attachments: {
        Row: {
          comment_id: string
          created_at: string
          file_name: string
          file_size: number | null
          file_type: string | null
          file_url: string
          id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          file_name: string
          file_size?: number | null
          file_type?: string | null
          file_url: string
          id?: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_comment_attachments_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "lead_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_comments: {
        Row: {
          autor_id: string | null
          created_at: string
          id: string
          lead_id: string
          texto: string
        }
        Insert: {
          autor_id?: string | null
          created_at?: string
          id?: string
          lead_id: string
          texto: string
        }
        Update: {
          autor_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_comments_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_comments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_especialidades_secundarias: {
        Row: {
          created_at: string
          especialidade_id: string
          id: string
          lead_id: string
        }
        Insert: {
          created_at?: string
          especialidade_id: string
          id?: string
          lead_id: string
        }
        Update: {
          created_at?: string
          especialidade_id?: string
          id?: string
          lead_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_especialidades_secundarias_especialidade_id_fkey"
            columns: ["especialidade_id"]
            isOneToOne: false
            referencedRelation: "especialidades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_especialidades_secundarias_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          anotacoes: string | null
          ativo: boolean | null
          created_at: string
          dados_extras: Json | null
          email: string | null
          especialidade: string | null
          especialidade_id: string | null
          id: string
          nome: string | null
          origem: string | null
          tags: string[] | null
          telefone: string
          tipo_lead: string | null
          updated_at: string
        }
        Insert: {
          anotacoes?: string | null
          ativo?: boolean | null
          created_at?: string
          dados_extras?: Json | null
          email?: string | null
          especialidade?: string | null
          especialidade_id?: string | null
          id?: string
          nome?: string | null
          origem?: string | null
          tags?: string[] | null
          telefone: string
          tipo_lead?: string | null
          updated_at?: string
        }
        Update: {
          anotacoes?: string | null
          ativo?: boolean | null
          created_at?: string
          dados_extras?: Json | null
          email?: string | null
          especialidade?: string | null
          especialidade_id?: string | null
          id?: string
          nome?: string | null
          origem?: string | null
          tags?: string[] | null
          telefone?: string
          tipo_lead?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_especialidade_id_fkey"
            columns: ["especialidade_id"]
            isOneToOne: false
            referencedRelation: "especialidades"
            referencedColumns: ["id"]
          },
        ]
      }
      mensagens: {
        Row: {
          conteudo: string
          conversa_id: string
          created_at: string
          enviado_por: string | null
          id: string
          lida: boolean
          remetente: string
          status: string | null
          tipo_mensagem: string
          wa_message_id: string | null
        }
        Insert: {
          conteudo: string
          conversa_id: string
          created_at?: string
          enviado_por?: string | null
          id?: string
          lida?: boolean
          remetente: string
          status?: string | null
          tipo_mensagem?: string
          wa_message_id?: string | null
        }
        Update: {
          conteudo?: string
          conversa_id?: string
          created_at?: string
          enviado_por?: string | null
          id?: string
          lida?: boolean
          remetente?: string
          status?: string | null
          tipo_mensagem?: string
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mensagens_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          contact_id: string | null
          created_at: string
          emoji: string
          from_me: boolean
          id: string
          message_wa_id: string
          reacted_at: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          emoji: string
          from_me?: boolean
          id?: string
          message_wa_id: string
          reacted_at?: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          emoji?: string
          from_me?: boolean
          id?: string
          message_wa_id?: string
          reacted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          apikey_hash: string | null
          contact_id: string
          created_at: string
          destination: string | null
          event: string | null
          from_me: boolean
          http_client_ip: string | null
          http_headers: Json | null
          http_meta: Json | null
          http_params: Json | null
          http_query: Json | null
          http_user_agent: string | null
          id: string
          instance: string
          instance_uuid: string
          instancia_whatsapp_id: string | null
          is_edited: boolean | null
          media_mime_type: string | null
          media_url: string | null
          message_context_info: Json | null
          message_type: string | null
          raw_payload: Json | null
          sender_jid: string | null
          sender_lid: string | null
          server_url: string | null
          source: string | null
          status: string | null
          text: string | null
          tipo_jid: string | null
          wa_message_id: string
          wa_timestamp: number | null
          webhook_received_at: string | null
        }
        Insert: {
          apikey_hash?: string | null
          contact_id: string
          created_at?: string
          destination?: string | null
          event?: string | null
          from_me?: boolean
          http_client_ip?: string | null
          http_headers?: Json | null
          http_meta?: Json | null
          http_params?: Json | null
          http_query?: Json | null
          http_user_agent?: string | null
          id?: string
          instance: string
          instance_uuid: string
          instancia_whatsapp_id?: string | null
          is_edited?: boolean | null
          media_mime_type?: string | null
          media_url?: string | null
          message_context_info?: Json | null
          message_type?: string | null
          raw_payload?: Json | null
          sender_jid?: string | null
          sender_lid?: string | null
          server_url?: string | null
          source?: string | null
          status?: string | null
          text?: string | null
          tipo_jid?: string | null
          wa_message_id: string
          wa_timestamp?: number | null
          webhook_received_at?: string | null
        }
        Update: {
          apikey_hash?: string | null
          contact_id?: string
          created_at?: string
          destination?: string | null
          event?: string | null
          from_me?: boolean
          http_client_ip?: string | null
          http_headers?: Json | null
          http_meta?: Json | null
          http_params?: Json | null
          http_query?: Json | null
          http_user_agent?: string | null
          id?: string
          instance?: string
          instance_uuid?: string
          instancia_whatsapp_id?: string | null
          is_edited?: boolean | null
          media_mime_type?: string | null
          media_url?: string | null
          message_context_info?: Json | null
          message_type?: string | null
          raw_payload?: Json | null
          sender_jid?: string | null
          sender_lid?: string | null
          server_url?: string | null
          source?: string | null
          status?: string | null
          text?: string | null
          tipo_jid?: string | null
          wa_message_id?: string
          wa_timestamp?: number | null
          webhook_received_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_instancia_whatsapp_id_fkey"
            columns: ["instancia_whatsapp_id"]
            isOneToOne: false
            referencedRelation: "instancias_whatsapp"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacoes: {
        Row: {
          created_at: string
          dados: Json | null
          id: string
          lida: boolean
          mensagem: string
          tipo: string
          titulo: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          dados?: Json | null
          id?: string
          lida?: boolean
          mensagem: string
          tipo: string
          titulo: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          dados?: Json | null
          id?: string
          lida?: boolean
          mensagem?: string
          tipo?: string
          titulo?: string
          user_id?: string | null
        }
        Relationships: []
      }
      numeros_whatsapp: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          instancia_atual_id: string | null
          jid: string | null
          nome_display: string | null
          numero: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          instancia_atual_id?: string | null
          jid?: string | null
          nome_display?: string | null
          numero: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          instancia_atual_id?: string | null
          jid?: string | null
          nome_display?: string | null
          numero?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "numeros_whatsapp_instancia_atual_id_fkey"
            columns: ["instancia_atual_id"]
            isOneToOne: false
            referencedRelation: "instancias_whatsapp"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          ativo: boolean
          cor_perfil: string
          created_at: string
          id: string
          instancia_padrao_id: string | null
          nome: string
          telefone_contato: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          cor_perfil?: string
          created_at?: string
          id: string
          instancia_padrao_id?: string | null
          nome: string
          telefone_contato?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          cor_perfil?: string
          created_at?: string
          id?: string
          instancia_padrao_id?: string | null
          nome?: string
          telefone_contato?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_instancia_padrao_id_fkey"
            columns: ["instancia_padrao_id"]
            isOneToOne: false
            referencedRelation: "instancias_whatsapp"
            referencedColumns: ["id"]
          },
        ]
      }
      regras_roteamento: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          id: string
          perfis_profissionais: string[]
          prioridade: number | null
          responsavel_user_id: string | null
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          id?: string
          perfis_profissionais: string[]
          prioridade?: number | null
          responsavel_user_id?: string | null
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          id?: string
          perfis_profissionais?: string[]
          prioridade?: number | null
          responsavel_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "regras_roteamento_responsavel_user_id_fkey"
            columns: ["responsavel_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_messages: {
        Row: {
          active: boolean
          contact_id: string | null
          created_at: string
          created_by: string
          frequency: string
          id: string
          instance_id: string
          last_run_at: string | null
          message_text: string
          month_day: number | null
          next_run_at: string | null
          nome_disparo: string
          phone: string
          send_time: string
          updated_at: string
          week_days: number[] | null
        }
        Insert: {
          active?: boolean
          contact_id?: string | null
          created_at?: string
          created_by: string
          frequency: string
          id?: string
          instance_id: string
          last_run_at?: string | null
          message_text: string
          month_day?: number | null
          next_run_at?: string | null
          nome_disparo: string
          phone: string
          send_time: string
          updated_at?: string
          week_days?: number[] | null
        }
        Update: {
          active?: boolean
          contact_id?: string | null
          created_at?: string
          created_by?: string
          frequency?: string
          id?: string
          instance_id?: string
          last_run_at?: string | null
          message_text?: string
          month_day?: number | null
          next_run_at?: string | null
          nome_disparo?: string
          phone?: string
          send_time?: string
          updated_at?: string
          week_days?: number[] | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "instancias_whatsapp"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_messages_log: {
        Row: {
          error_message: string | null
          id: string
          scheduled_message_id: string
          sent_at: string
          success: boolean
          wa_message_id: string | null
        }
        Insert: {
          error_message?: string | null
          id?: string
          scheduled_message_id: string
          sent_at?: string
          success: boolean
          wa_message_id?: string | null
        }
        Update: {
          error_message?: string | null
          id?: string
          scheduled_message_id?: string
          sent_at?: string
          success?: boolean
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_messages_log_scheduled_message_id_fkey"
            columns: ["scheduled_message_id"]
            isOneToOne: false
            referencedRelation: "scheduled_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      task_flow_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_size: number | null
          file_type: string | null
          file_url: string
          id: string
          task_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size?: number | null
          file_type?: string | null
          file_url: string
          id?: string
          task_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          id?: string
          task_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_flow_attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_flow_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_flow_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "task_flow_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_flow_checklists: {
        Row: {
          concluido: boolean
          created_at: string
          id: string
          ordem: number
          task_id: string
          texto: string
        }
        Insert: {
          concluido?: boolean
          created_at?: string
          id?: string
          ordem?: number
          task_id: string
          texto: string
        }
        Update: {
          concluido?: boolean
          created_at?: string
          id?: string
          ordem?: number
          task_id?: string
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_flow_checklists_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_flow_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_flow_columns: {
        Row: {
          cor: string | null
          created_at: string
          icone: string | null
          id: string
          nome: string
          ordem: number
          tipo: string
        }
        Insert: {
          cor?: string | null
          created_at?: string
          icone?: string | null
          id?: string
          nome: string
          ordem?: number
          tipo?: string
        }
        Update: {
          cor?: string | null
          created_at?: string
          icone?: string | null
          id?: string
          nome?: string
          ordem?: number
          tipo?: string
        }
        Relationships: []
      }
      task_flow_comments: {
        Row: {
          attachment_id: string | null
          autor_id: string | null
          created_at: string
          id: string
          task_id: string
          texto: string
          tipo: string
        }
        Insert: {
          attachment_id?: string | null
          autor_id?: string | null
          created_at?: string
          id?: string
          task_id: string
          texto: string
          tipo?: string
        }
        Update: {
          attachment_id?: string | null
          autor_id?: string | null
          created_at?: string
          id?: string
          task_id?: string
          texto?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_flow_comments_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "task_flow_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_flow_comments_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_flow_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_flow_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_flow_history: {
        Row: {
          autor_id: string | null
          created_at: string
          descricao: string
          id: string
          task_id: string
          tipo: string
          valor_anterior: string | null
          valor_novo: string | null
        }
        Insert: {
          autor_id?: string | null
          created_at?: string
          descricao: string
          id?: string
          task_id: string
          tipo: string
          valor_anterior?: string | null
          valor_novo?: string | null
        }
        Update: {
          autor_id?: string | null
          created_at?: string
          descricao?: string
          id?: string
          task_id?: string
          tipo?: string
          valor_anterior?: string | null
          valor_novo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_flow_history_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_flow_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_flow_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_flow_profiles: {
        Row: {
          ativo: boolean
          avatar_url: string | null
          cor: string
          created_at: string
          id: string
          nome: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          ativo?: boolean
          avatar_url?: string | null
          cor?: string
          created_at?: string
          id?: string
          nome: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          ativo?: boolean
          avatar_url?: string | null
          cor?: string
          created_at?: string
          id?: string
          nome?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_flow_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_flow_tags: {
        Row: {
          cor: string
          created_at: string
          id: string
          nome: string
        }
        Insert: {
          cor?: string
          created_at?: string
          id?: string
          nome: string
        }
        Update: {
          cor?: string
          created_at?: string
          id?: string
          nome?: string
        }
        Relationships: []
      }
      task_flow_task_tags: {
        Row: {
          created_at: string
          id: string
          tag_id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          tag_id: string
          task_id: string
        }
        Update: {
          created_at?: string
          id?: string
          tag_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_flow_task_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "task_flow_tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_flow_task_tags_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_flow_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_flow_tasks: {
        Row: {
          audio_url: string | null
          column_id: string
          created_at: string
          criado_por_id: string | null
          data_retorno: string | null
          deleted_at: string | null
          deleted_by: string | null
          descricao: string | null
          id: string
          ordem: number
          origem: string | null
          prazo: string | null
          responsavel_id: string | null
          resumo: string | null
          titulo: string
          updated_at: string
        }
        Insert: {
          audio_url?: string | null
          column_id: string
          created_at?: string
          criado_por_id?: string | null
          data_retorno?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          descricao?: string | null
          id?: string
          ordem?: number
          origem?: string | null
          prazo?: string | null
          responsavel_id?: string | null
          resumo?: string | null
          titulo: string
          updated_at?: string
        }
        Update: {
          audio_url?: string | null
          column_id?: string
          created_at?: string
          criado_por_id?: string | null
          data_retorno?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          descricao?: string | null
          id?: string
          ordem?: number
          origem?: string | null
          prazo?: string | null
          responsavel_id?: string | null
          resumo?: string | null
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_flow_tasks_column_id_fkey"
            columns: ["column_id"]
            isOneToOne: false
            referencedRelation: "task_flow_columns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_flow_tasks_criado_por_id_fkey"
            columns: ["criado_por_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_flow_tasks_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "task_flow_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tipos_lead: {
        Row: {
          cor: string
          created_at: string
          created_by: string | null
          id: string
          nome: string
        }
        Insert: {
          cor?: string
          created_at?: string
          created_by?: string | null
          id?: string
          nome: string
        }
        Update: {
          cor?: string
          created_at?: string
          created_by?: string | null
          id?: string
          nome?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      calculate_next_run: {
        Args: {
          p_current_time?: string
          p_frequency: string
          p_month_day: number
          p_send_time: string
          p_week_days: number[]
        }
        Returns: string
      }
      cleanup_deleted_tasks: { Args: never; Returns: undefined }
      get_current_user_profile: {
        Args: never
        Returns: {
          ativo: boolean
          cor_perfil: string
          id: string
          instancia_nome: string
          instancia_numero: string
          instancia_padrao_id: string
          nome: string
          role: Database["public"]["Enums"]["app_role"]
          telefone_contato: string
        }[]
      }
      get_instancia_ativa_numero: {
        Args: { p_numero: string }
        Returns: string
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hub_contacts_activity: { Args: { p_days?: number }; Returns: Json }
      hub_contacts_filter: {
        Args: {
          p_days?: number
          p_especialidade?: string
          p_instance_id?: string
          p_instituicao?: string
          p_limit?: number
          p_offset?: number
          p_perfil?: string
        }
        Returns: Json
      }
      hub_contacts_summary: { Args: never; Returns: Json }
      listar_leads_disponiveis_disparo: {
        Args: {
          p_campanha_id: string
          p_current_envio_id?: string
          p_filter_busca?: string
          p_filter_especialidade?: string
          p_filter_tipo_lead?: string
          p_page?: number
          p_per_page?: number
        }
        Returns: Json
      }
      migrar_numero_para_instancia: {
        Args: {
          p_motivo?: string
          p_nova_instancia_id: string
          p_numero: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role:
        | "admin_geral"
        | "medico"
        | "secretaria_medica"
        | "administrativo"
        | "disparador"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin_geral",
        "medico",
        "secretaria_medica",
        "administrativo",
        "disparador",
      ],
    },
  },
} as const
