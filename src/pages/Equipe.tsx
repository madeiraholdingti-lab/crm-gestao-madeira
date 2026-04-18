import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Users, Mail, Phone, Shield, Edit, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface TeamMember {
  id: string;
  nome: string;
  telefone_contato: string | null;
  cor_perfil: string;
  email?: string;
  role?: string;
}

const roleLabels: { [key: string]: string } = {
  admin_geral: "Admin Geral",
  medico: "Médico",
  administrativo: "Administrativo",
  secretaria_medica: "Secretária Médica",
};

const roleBadgeVariants: { [key: string]: "default" | "secondary" | "destructive" | "outline" } = {
  admin_geral: "destructive",
  medico: "default",
  administrativo: "secondary",
  secretaria_medica: "outline",
};

export default function Equipe() {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTeamMembers();
  }, []);

  const fetchTeamMembers = async () => {
    try {
      // Buscar todos os perfis
      const { data: profilesData, error: profilesError } = await supabase
        .from("profiles")
        .select("id, nome, telefone_contato, cor_perfil");

      if (profilesError) throw profilesError;

      // Buscar roles de cada usuário
      const { data: rolesData, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id, role");

      if (rolesError) throw rolesError;

      // Buscar emails dos usuários
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        toast.error("Você precisa estar logado");
        return;
      }

      // Combinar dados
      const membersWithRoles = profilesData?.map((profile) => {
        const userRole = rolesData?.find((r) => r.user_id === profile.id);
        return {
          ...profile,
          role: userRole?.role || "sem_role",
        };
      }) || [];

      // Buscar emails via API admin (apenas para admin)
      const membersWithEmails = await Promise.all(
        membersWithRoles.map(async (member) => {
          try {
            // Tentar buscar email via supabase (funciona apenas para admin)
            const { data: userData } = await supabase.auth.admin.getUserById(member.id);
            return {
              ...member,
              email: userData?.user?.email || "Email não disponível",
            };
          } catch {
            return {
              ...member,
              email: "Email não disponível",
            };
          }
        })
      );

      setTeamMembers(membersWithEmails);
    } catch (error) {
      console.error("Erro ao carregar equipe:", error);
      toast.error("Erro ao carregar membros da equipe");
    } finally {
      setLoading(false);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Users className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold text-foreground">Gestão de Equipe</h1>
            <p className="text-muted-foreground">Gerencie os membros da sua equipe</p>
          </div>
        </div>
      </div>

      {teamMembers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-16 w-16 text-muted-foreground mb-4" />
            <p className="text-lg font-medium text-muted-foreground">
              Nenhum membro da equipe encontrado
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {teamMembers.map((member) => (
            <Card key={member.id} className="hover:shadow-lg transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start gap-4">
                  <Avatar className="h-12 w-12" style={{ backgroundColor: member.cor_perfil }}>
                    <AvatarFallback className="text-white font-semibold">
                      {getInitials(member.nome)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 space-y-1">
                    <CardTitle className="text-lg">{member.nome}</CardTitle>
                    <Badge variant={roleBadgeVariants[member.role || ""] || "outline"}>
                      <Shield className="h-3 w-3 mr-1" />
                      {roleLabels[member.role || ""] || "Sem Função"}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-4 w-4" />
                    <span className="truncate">{member.email}</span>
                  </div>
                  {member.telefone_contato && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="h-4 w-4" />
                      <span>{member.telefone_contato}</span>
                    </div>
                  )}
                </div>
                
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" size="sm" className="flex-1">
                    <Edit className="h-3 w-3 mr-1" />
                    Editar
                  </Button>
                  <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive hover:text-destructive-foreground">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
