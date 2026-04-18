import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Edit, UserX, UserCheck, KeyRound, Loader2, Mail, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

interface Usuario {
  id: string;
  nome: string;
  telefone_contato: string | null;
  instancia_padrao_id: string | null;
  ativo: boolean;
  created_at: string;
  role?: string;
  email?: string;
  instancia_nome?: string;
  instancia_numero?: string;
}

interface Instancia {
  id: string;
  nome_instancia: string;
  numero_chip: string | null;
  ativo: boolean;
  status: string;
}

const roleLabels: Record<string, string> = {
  admin_geral: "Admin Geral",
  medico: "Médico",
  secretaria_medica: "Secretária",
  administrativo: "Administrativo",
  disparador: "Disparador",
};

export default function Usuarios() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [instancias, setInstancias] = useState<Instancia[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<Usuario | null>(null);
  const [resettingPassword, setResettingPassword] = useState<string | null>(null);

  // Filtros
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  const [formData, setFormData] = useState({
    nome: "",
    email: "",
    password: "",
    telefone_contato: "",
    instancia_padrao_id: "",
    role: "secretaria_medica",
    ativo: true,
  });

  // Filtrar usuários
  const filteredUsuarios = useMemo(() => {
    return usuarios.filter((user) => {
      const matchesSearch =
        searchTerm === "" ||
        user.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (user.email && user.email.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesRole =
        roleFilter === "all" || user.role === roleFilter;

      return matchesSearch && matchesRole;
    });
  }, [usuarios, searchTerm, roleFilter]);

  useEffect(() => {
    fetchUsuarios();
    fetchInstancias();

    // Realtime para instâncias - atualiza lista quando instância muda
    const instanciasChannel = supabase
      .channel('instancias-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'instancias_whatsapp',
        },
        () => {
          console.log('[Usuarios] Instância atualizada, recarregando...');
          fetchInstancias();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(instanciasChannel);
    };
  }, []);

  const fetchUsuarios = async () => {
    try {
      setLoading(true);

      // Buscar profiles com suas roles e instâncias
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select(`
          id,
          nome,
          telefone_contato,
          instancia_padrao_id,
          ativo,
          created_at
        `);

      if (profilesError) throw profilesError;

      // Buscar roles
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id, role");

      if (rolesError) throw rolesError;

      // Buscar instâncias
      const { data: instanciasData, error: instanciasError } = await supabase
        .from("instancias_whatsapp")
        .select("id, nome_instancia, numero_chip");

      if (instanciasError) throw instanciasError;

      // Buscar emails dos usuários via edge function
      let authUsers: { id: string; email: string }[] = [];
      try {
        const { data: authData, error: authError } = await supabase.functions.invoke(
          'listar-usuarios-admin'
        );
        if (!authError && authData?.users) {
          authUsers = authData.users;
        }
      } catch (e) {
        console.error("Erro ao buscar emails:", e);
      }

      // Combinar dados
      const usuariosCompletos = profiles?.map((profile) => {
        const userRole = roles?.find((r) => r.user_id === profile.id);
        const instancia = instanciasData?.find((i) => i.id === profile.instancia_padrao_id);
        const authUser = authUsers.find((u) => u.id === profile.id);

        return {
          ...profile,
          role: userRole?.role || "Sem role",
          email: authUser?.email || null,
          instancia_nome: instancia?.nome_instancia || null,
          instancia_numero: instancia?.numero_chip || null,
        };
      }) || [];

      setUsuarios(usuariosCompletos);
    } catch (error) {
      console.error("Erro ao buscar usuários:", error);
      toast.error("Erro ao carregar usuários");
    } finally {
      setLoading(false);
    }
  };

  const fetchInstancias = async () => {
    try {
      const { data, error } = await supabase
        .from("instancias_whatsapp")
        .select("id, nome_instancia, numero_chip, ativo, status")
        .neq("status", "deletada")
        .order("ativo", { ascending: false })
        .order("nome_instancia");

      if (error) throw error;
      setInstancias(data || []);
    } catch (error) {
      console.error("Erro ao buscar instâncias:", error);
    }
  };

  const handleOpenDialog = (user?: Usuario) => {
    if (user) {
      setEditingUser(user);
      setFormData({
        nome: user.nome,
        email: user.email || "",
        password: "",
        telefone_contato: user.telefone_contato || "",
        instancia_padrao_id: user.instancia_padrao_id || "",
        role: user.role || "",
        ativo: user.ativo,
      });
    } else {
      setEditingUser(null);
      setFormData({
        nome: "",
        email: "",
        password: "",
        telefone_contato: "",
        instancia_padrao_id: "",
        role: "secretaria_medica",
        ativo: true,
      });
    }
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      if (!formData.nome.trim()) {
        toast.error("Nome é obrigatório");
        return;
      }

      setSaving(true);

      if (editingUser) {
        // Atualizar usuário existente
        const updateData = {
          nome: formData.nome.trim(),
          telefone_contato: formData.telefone_contato.trim() || null,
          instancia_padrao_id: formData.instancia_padrao_id || null,
          ativo: formData.ativo,
        };

        const { error } = await supabase
          .from("profiles")
          .update(updateData)
          .eq("id", editingUser.id);

        if (error) throw error;

        // Atualizar role se alterada
        if (formData.role && formData.role !== editingUser.role) {
          const { error: roleError } = await supabase.functions.invoke('atualizar-role-usuario', {
            body: { userId: editingUser.id, role: formData.role }
          });

          if (roleError) {
            console.error("Erro ao atualizar role:", roleError);
            toast.error("Erro ao atualizar role do usuário");
          }
        }

        toast.success("Usuário atualizado com sucesso");
      } else {
        // Criar novo usuário
        if (!formData.email.trim()) {
          toast.error("Email é obrigatório");
          setSaving(false);
          return;
        }
        if (!formData.password || formData.password.length < 6) {
          toast.error("Senha deve ter no mínimo 6 caracteres");
          setSaving(false);
          return;
        }

        const { data, error } = await supabase.functions.invoke('criar-usuario', {
          body: {
            email: formData.email.trim(),
            password: formData.password,
            nome: formData.nome.trim(),
            telefone_contato: formData.telefone_contato.trim() || null,
            role: formData.role || 'secretaria_medica',
            instancia_padrao_id: formData.instancia_padrao_id || null,
          }
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        toast.success("Usuário criado com sucesso!");
      }

      setDialogOpen(false);
      fetchUsuarios();
    } catch (error: any) {
      console.error("Erro ao salvar usuário:", error);
      toast.error(error.message || "Erro ao salvar usuário");
    } finally {
      setSaving(false);
    }
  };

  const toggleAtivo = async (userId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ ativo: !currentStatus })
        .eq("id", userId);

      if (error) throw error;

      toast.success(
        !currentStatus ? "Usuário ativado" : "Usuário desativado"
      );
      fetchUsuarios();
    } catch (error) {
      console.error("Erro ao alterar status:", error);
      toast.error("Erro ao alterar status do usuário");
    }
  };

  const handleResetPassword = async (userId: string, email?: string) => {
    if (!email) {
      toast.error("Email do usuário não encontrado");
      return;
    }

    try {
      setResettingPassword(userId);
      
      const { data, error } = await supabase.functions.invoke('reset-user-password', {
        body: { userId, email }
      });

      if (error) throw error;

      toast.success("Email de redefinição de senha enviado com sucesso!");
    } catch (error) {
      console.error("Erro ao enviar reset de senha:", error);
      toast.error("Erro ao enviar email de redefinição");
    } finally {
      setResettingPassword(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Gestão de Usuários</h1>
          <p className="text-muted-foreground">
            Gerencie os usuários e suas instâncias padrão de WhatsApp
          </p>
        </div>
        <Button onClick={() => handleOpenDialog()}>
          <Plus className="h-4 w-4 mr-2" />
          Novo Usuário
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle>Usuários Cadastrados</CardTitle>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome ou email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 w-64"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Filtrar por role" />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="all">Todas as roles</SelectItem>
                <SelectItem value="admin_geral">Admin Geral</SelectItem>
                <SelectItem value="medico">Médico</SelectItem>
                <SelectItem value="secretaria_medica">Secretária</SelectItem>
                <SelectItem value="administrativo">Administrativo</SelectItem>
                <SelectItem value="disparador">Disparador</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {filteredUsuarios.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              {usuarios.length === 0 ? "Nenhum usuário cadastrado" : "Nenhum usuário encontrado com os filtros aplicados"}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Instância Padrão</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsuarios.map((usuario) => (
                  <TableRow key={usuario.id}>
                    <TableCell className="font-medium">{usuario.nome}</TableCell>
                    <TableCell>
                      {usuario.email ? (
                        <div className="flex items-center gap-1">
                          <Mail className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm">{usuario.email}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{usuario.telefone_contato || "-"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{usuario.role}</Badge>
                    </TableCell>
                    <TableCell>
                      {usuario.instancia_nome ? (
                        <div className="flex items-center gap-2">
                          <span className="text-lg">📱</span>
                          <div className="flex-1">
                            <div className="font-medium">{usuario.instancia_nome}</div>
                            {usuario.instancia_numero && (
                              <div className="text-xs text-muted-foreground">
                                {usuario.instancia_numero}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground italic">Nenhuma instância vinculada</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {usuario.ativo ? (
                        <Badge variant="default" className="bg-green-500">
                          <UserCheck className="h-3 w-3 mr-1" />
                          Ativo
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          <UserX className="h-3 w-3 mr-1" />
                          Inativo
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleResetPassword(usuario.id, usuario.email)}
                          disabled={resettingPassword === usuario.id || !usuario.email}
                          title="Enviar email de redefinição de senha"
                        >
                          {resettingPassword === usuario.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <KeyRound className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenDialog(usuario)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant={usuario.ativo ? "destructive" : "default"}
                          size="sm"
                          onClick={() => toggleAtivo(usuario.id, usuario.ativo)}
                        >
                          {usuario.ativo ? (
                            <UserX className="h-4 w-4" />
                          ) : (
                            <UserCheck className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {editingUser ? "Editar Usuário" : "Novo Usuário"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="nome">Nome *</Label>
              <Input
                id="nome"
                value={formData.nome}
                onChange={(e) =>
                  setFormData({ ...formData, nome: e.target.value })
                }
                placeholder="Nome completo"
              />
            </div>

            {!editingUser && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="email">Email *</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                    placeholder="email@exemplo.com"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Senha *</Label>
                  <Input
                    id="password"
                    type="password"
                    value={formData.password}
                    onChange={(e) =>
                      setFormData({ ...formData, password: e.target.value })
                    }
                    placeholder="Mínimo 6 caracteres"
                  />
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="telefone">Telefone</Label>
              <Input
                id="telefone"
                value={formData.telefone_contato}
                onChange={(e) =>
                  setFormData({ ...formData, telefone_contato: e.target.value })
                }
                placeholder="(00) 00000-0000"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="instancia">Instância Padrão</Label>
              <div className="flex gap-2">
                <Select
                  value={formData.instancia_padrao_id || undefined}
                  onValueChange={(value) =>
                    setFormData({ ...formData, instancia_padrao_id: value })
                  }
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Nenhuma instância selecionada" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover z-50">
                    {instancias.map((inst) => (
                      <SelectItem 
                        key={inst.id} 
                        value={inst.id}
                        className="cursor-pointer"
                      >
                        <div className="flex items-center gap-2 w-full">
                          <div className="flex-1">
                            <div className="font-medium">{inst.nome_instancia}</div>
                            {inst.numero_chip && (
                              <div className="text-xs text-muted-foreground">
                                {inst.numero_chip}
                              </div>
                            )}
                          </div>
                          {inst.ativo ? (
                            <Badge variant="default" className="bg-green-500 text-white text-xs">
                              Ativa
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">
                              Inativa
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {formData.instancia_padrao_id && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      setFormData({ ...formData, instancia_padrao_id: "" })
                    }
                    title="Remover instância"
                  >
                    ✕
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {instancias.length > 0 
                  ? `${instancias.filter(i => i.ativo).length} ativas, ${instancias.filter(i => !i.ativo).length} inativas`
                  : "Nenhuma instância disponível"}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Função / Role</Label>
              <Select
                value={formData.role || undefined}
                onValueChange={(value) =>
                  setFormData({ ...formData, role: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma função" />
                </SelectTrigger>
                <SelectContent className="bg-popover z-50">
                  <SelectItem value="admin_geral">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-red-500 text-white">Admin</Badge>
                      <span>Administrador Geral</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="medico">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-blue-500 text-white">Médico</Badge>
                      <span>Médico</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="secretaria_medica">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-green-500 text-white">Secretária</Badge>
                      <span>Secretária Médica</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="administrativo">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-purple-500 text-white">Admin</Badge>
                      <span>Administrativo</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="disparador">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-orange-500 text-white">Disparador</Badge>
                      <span>Disparador</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="ativo">Usuário Ativo</Label>
              <Switch
                id="ativo"
                checked={formData.ativo}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, ativo: checked })
                }
              />
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {editingUser ? "Salvando..." : "Criando..."}
                </>
              ) : (
                editingUser ? "Salvar" : "Criar Usuário"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
