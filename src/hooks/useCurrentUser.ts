import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface CurrentUserProfile {
  id: string;
  nome: string;
  telefone_contato: string | null;
  cor_perfil: string;
  instancia_padrao_id: string | null;
  ativo: boolean;
  role: string;
  instancia_nome: string | null;
  instancia_numero: string | null;
}

export const useCurrentUser = () => {
  const [profile, setProfile] = useState<CurrentUserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('get_current_user_profile');

      if (error) throw error;

      if (data && data.length > 0) {
        setProfile(data[0]);
      } else {
        setProfile(null);
      }
    } catch (err) {
      console.error('Erro ao buscar perfil do usuário:', err);
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  };

  // Buscar perfil na montagem
  useEffect(() => {
    fetchProfile();
  }, []);

  // Realtime: só criar channel quando profile.id existir
  useEffect(() => {
    if (!profile?.id) return;

    const channelName = `user-profile-changes-${profile.id}-${Math.random().toString(36).slice(2, 9)}`;
    const channel = supabase.channel(channelName);

    channel
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${profile.id}`,
        },
        () => {
          fetchProfile();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id]);

  return { profile, loading, error };
};
