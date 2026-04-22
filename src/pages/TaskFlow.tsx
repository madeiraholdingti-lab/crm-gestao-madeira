import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { TaskFlowBoard } from "@/components/taskflow/TaskFlowBoard";
import { TaskFlowColumnsConfig } from "@/components/taskflow/TaskFlowColumnsConfig";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, CheckCircle2, Plus, Settings, UserCog } from "lucide-react";
import { toast } from "sonner";
import { startOfDay, endOfDay } from "date-fns";

interface SystemUser {
  id: string;
  nome: string;
}

interface TaskFlowProfile {
  id: string;
  nome: string;
  avatar_url: string | null;
  cor: string;
  ativo: boolean;
  user_id: string | null;
}

export default function TaskFlow() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const taskIdFromUrl = searchParams.get("task");
  
  const [profiles, setProfiles] = useState<TaskFlowProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<TaskFlowProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNewProfileDialog, setShowNewProfileDialog] = useState(false);
  const [showColumnsConfig, setShowColumnsConfig] = useState(false);
  const [showEditProfileDialog, setShowEditProfileDialog] = useState(false);
  const [editingProfile, setEditingProfile] = useState<TaskFlowProfile | null>(null);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileColor, setNewProfileColor] = useState("#3B82F6");
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [systemUsers, setSystemUsers] = useState<SystemUser[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  // Se tem task na URL, buscar a tarefa e selecionar o perfil automaticamente
  useEffect(() => {
    if (taskIdFromUrl && profiles.length > 0 && !selectedProfile) {
      fetchTaskAndSelectProfile(taskIdFromUrl);
    }
  }, [taskIdFromUrl, profiles]);

  const fetchTaskAndSelectProfile = async (taskId: string) => {
    try {
      // Buscar a tarefa para descobrir o responsável
      const { data: task, error } = await supabase
        .from("task_flow_tasks")
        .select("responsavel_id")
        .eq("id", taskId)
        .single();

      if (error || !task) {
        console.error("Tarefa não encontrada:", error);
        return;
      }

      // Se a tarefa tem responsável, selecionar esse perfil
      if (task.responsavel_id) {
        const profile = profiles.find(p => p.id === task.responsavel_id);
        if (profile) {
          setSelectedProfile(profile);
          return;
        }
      }

      // Se não tem responsável ou não encontrou, selecionar o primeiro perfil
      if (profiles.length > 0) {
        setSelectedProfile(profiles[0]);
      }
    } catch (error) {
      console.error("Erro ao buscar tarefa:", error);
    }
  };

  // Limpar o parâmetro task da URL quando voltar para seleção de perfil
  const handleBackToProfiles = () => {
    setSelectedProfile(null);
    if (taskIdFromUrl) {
      setSearchParams({});
    }
  };

  useEffect(() => {
    fetchProfiles();
    fetchSystemUsers();
    checkAdminRole();
  }, []);

  const checkAdminRole = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: roleData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .maybeSingle();
        
        setIsAdmin(roleData?.role === "admin_geral");
      }
    } catch (error) {
      console.error("Erro ao verificar role:", error);
    }
  };

  const fetchProfiles = async () => {
    try {
      const { data, error } = await supabase
        .from("task_flow_profiles")
        .select("*")
        .eq("ativo", true)
        .order("nome");

      if (error) throw error;
      setProfiles(data || []);
    } catch (error) {
      console.error("Erro ao carregar perfis:", error);
      toast.error("Erro ao carregar perfis");
    } finally {
      setLoading(false);
    }
  };

  const fetchSystemUsers = async () => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome");

      if (error) throw error;
      setSystemUsers(data || []);
    } catch (error) {
      console.error("Erro ao carregar usuários:", error);
    }
  };

  const handleCreateProfile = async () => {
    if (!newProfileName.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }

    try {
      const { data, error } = await supabase
        .from("task_flow_profiles")
        .insert({ 
          nome: newProfileName.trim(), 
          cor: newProfileColor,
          user_id: selectedUserId && selectedUserId !== "none" ? selectedUserId : null
        })
        .select()
        .single();

      if (error) throw error;

      setProfiles([...profiles, data]);
      setShowNewProfileDialog(false);
      setNewProfileName("");
      setNewProfileColor("#3B82F6");
      setSelectedUserId("");
      toast.success("Perfil criado com sucesso!");
    } catch (error) {
      console.error("Erro ao criar perfil:", error);
      toast.error("Erro ao criar perfil");
    }
  };

  const handleOpenEditProfile = (profile: TaskFlowProfile) => {
    setEditingProfile(profile);
    setNewProfileName(profile.nome);
    setNewProfileColor(profile.cor);
    setSelectedUserId(profile.user_id || "none");
    setShowEditProfileDialog(true);
  };

  const handleUpdateProfile = async () => {
    if (!editingProfile || !newProfileName.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }

    try {
      const { error } = await supabase
        .from("task_flow_profiles")
        .update({ 
          nome: newProfileName.trim(), 
          cor: newProfileColor,
          user_id: selectedUserId && selectedUserId !== "none" ? selectedUserId : null
        })
        .eq("id", editingProfile.id);

      if (error) throw error;

      setProfiles(profiles.map(p => 
        p.id === editingProfile.id 
          ? { ...p, nome: newProfileName.trim(), cor: newProfileColor, user_id: selectedUserId && selectedUserId !== "none" ? selectedUserId : null }
          : p
      ));
      setShowEditProfileDialog(false);
      setEditingProfile(null);
      setNewProfileName("");
      setNewProfileColor("#3B82F6");
      setSelectedUserId("");
      toast.success("Perfil atualizado com sucesso!");
    } catch (error) {
      console.error("Erro ao atualizar perfil:", error);
      toast.error("Erro ao atualizar perfil");
    }
  };

  // Memoizar datas para estabilizar queryKey
  const todayStart = useMemo(() => startOfDay(new Date()).toISOString(), []);
  const todayEnd = useMemo(() => endOfDay(new Date()).toISOString(), []);

  // Buscar contagem de tarefas finalizadas hoje (todas, bate com o dashboard da Home)
  const { data: completedTodayCount = 0 } = useQuery({
    queryKey: ["tasks-completed-today", todayStart],
    queryFn: async () => {
      const { data: finCol } = await supabase
        .from("task_flow_columns")
        .select("id")
        .eq("nome", "Finalizada")
        .single();

      if (!finCol) return 0;

      const { count, error } = await supabase
        .from("task_flow_tasks")
        .select("id", { count: "exact", head: true })
        .eq("column_id", finCol.id)
        .is("deleted_at", null)
        .gte("updated_at", todayStart)
        .lte("updated_at", todayEnd);

      if (error) return 0;
      return count || 0;
    },
    enabled: !!selectedProfile,
    refetchInterval: 120000,
  });

  // Se um perfil está selecionado, mostra o board
  if (selectedProfile) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header do Board — identidade Madeira Holding */}
          <div className="flex items-center justify-between p-4 border-b border-border bg-card">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleBackToProfiles}
                className="hover:bg-muted"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center text-white font-serif-display text-xl font-medium shadow-sm"
                style={{ backgroundColor: selectedProfile.cor }}
              >
                {selectedProfile.avatar_url ? (
                  <img src={selectedProfile.avatar_url} alt={selectedProfile.nome} className="w-full h-full rounded-full object-cover" />
                ) : (
                  selectedProfile.nome.charAt(0).toUpperCase()
                )}
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-mh-gold-600">
                  Task-Flow Board
                </div>
                <h1 className="font-serif-display text-xl font-medium text-mh-ink leading-tight">
                  {selectedProfile.nome}
                </h1>
              </div>

              {/* Métrica de tarefas realizadas hoje — dourado em vez de verde pra identidade */}
              <div className="flex items-center gap-2 ml-4 bg-mh-gold-100 text-mh-gold-700 px-3 py-1.5 rounded-full border border-mh-gold-300/50">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span className="font-serif-display text-base font-semibold tabular-nums">{completedTodayCount}</span>
                <span className="text-[11px] font-medium">realizadas hoje</span>
              </div>
            </div>

            {/* Botão de configuração (apenas admin) */}
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowColumnsConfig(true)}
                className="border-mh-navy-700/20 hover:border-mh-navy-700 hover:bg-mh-navy-50"
              >
                <Settings className="h-4 w-4 mr-2" />
                Configurar Colunas
              </Button>
            )}
          </div>

          {/* Kanban Board */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <TaskFlowBoard
              selectedProfile={selectedProfile}
              allProfiles={profiles}
              initialTaskId={taskIdFromUrl}
              key={showColumnsConfig ? "refresh" : "normal"}
            />
          </div>
        </div>

        {/* Modal de configuração de colunas */}
        <TaskFlowColumnsConfig
          open={showColumnsConfig}
          onClose={() => setShowColumnsConfig(false)}
        />
      </div>
    );
  }

  // Tela inicial de seleção de perfil
  return (
    <div className="h-full bg-background">
      <div className="container mx-auto py-10 px-4">
        <div className="flex items-start justify-between mb-10">
          <div className="flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mh-gold-600 mb-2">
              Operação · Gestão de Tarefas
            </div>
            <h1 className="font-serif-display text-3xl md:text-4xl font-medium text-mh-ink leading-tight">
              Task-Flow
            </h1>
            <p className="text-sm text-mh-ink-3 mt-2 max-w-lg">
              Escolha o perfil para abrir o kanban correspondente. Cada pessoa da equipe
              tem seu próprio board com as tarefas atribuídas.
            </p>
          </div>

          {isAdmin && (
            <Button
              variant="outline"
              onClick={() => setShowColumnsConfig(true)}
              className="border-mh-navy-700/20 hover:border-mh-navy-700 hover:bg-mh-navy-50"
            >
              <Settings className="h-4 w-4 mr-2" />
              Configurar Colunas
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {/* Cards dos perfis existentes */}
            {profiles.map((profile) => (
              <Card
                key={profile.id}
                className="cursor-pointer hover:shadow-lg transition-all hover:-translate-y-0.5 border relative group overflow-hidden"
                onClick={() => setSelectedProfile(profile)}
              >
                {/* Faixa colorida no topo — accent do perfil */}
                <div className="h-1 w-full" style={{ backgroundColor: profile.cor }} />

                {/* Botão de configuração (apenas admin) */}
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity z-10 h-8 w-8"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenEditProfile(profile);
                    }}
                  >
                    <UserCog className="h-4 w-4" />
                  </Button>
                )}
                <CardContent className="p-7 flex flex-col items-center gap-3">
                  <div
                    className="w-20 h-20 rounded-full flex items-center justify-center text-white font-serif-display text-3xl font-medium shadow-md ring-4"
                    style={{ backgroundColor: profile.cor, ['--tw-ring-color' as string]: `${profile.cor}20` }}
                  >
                    {profile.avatar_url ? (
                      <img
                        src={profile.avatar_url}
                        alt={profile.nome}
                        className="w-full h-full rounded-full object-cover"
                      />
                    ) : (
                      profile.nome.charAt(0).toUpperCase()
                    )}
                  </div>
                  <h2 className="font-serif-display text-xl font-medium text-mh-ink mt-1">{profile.nome}</h2>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-mh-ink-3 group-hover:text-mh-gold-600 transition-colors">
                    Abrir board →
                  </p>
                </CardContent>
              </Card>
            ))}

            {/* Card para adicionar nova secretária (apenas admin) */}
            {isAdmin && (
              <Card
                className="cursor-pointer hover:shadow-lg transition-all hover:scale-105 border-2 border-dashed border-muted-foreground/30"
                onClick={() => setShowNewProfileDialog(true)}
              >
                <CardContent className="p-8 flex flex-col items-center justify-center gap-4 h-full min-h-[200px]">
                  <div className="w-24 h-24 rounded-full flex items-center justify-center bg-muted text-muted-foreground">
                    <Plus className="h-12 w-12" />
                  </div>
                  <h2 className="text-xl font-semibold text-muted-foreground">
                    + Nova Secretária
                  </h2>
                  <p className="text-muted-foreground text-sm text-center">
                    Adicionar novo perfil ao Task-Flow
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Dialog para criar novo perfil */}
        <Dialog open={showNewProfileDialog} onOpenChange={setShowNewProfileDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nova Secretária</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="nome">Nome</Label>
                <Input
                  id="nome"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="Digite o nome..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="usuario">Associar a Usuário (opcional)</Label>
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um usuário..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {systemUsers.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cor">Cor do Perfil</Label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    id="cor"
                    value={newProfileColor}
                    onChange={(e) => setNewProfileColor(e.target.value)}
                    className="w-12 h-10 rounded cursor-pointer"
                  />
                  <Input
                    value={newProfileColor}
                    onChange={(e) => setNewProfileColor(e.target.value)}
                    className="flex-1"
                  />
                </div>
              </div>
              <div className="flex justify-center pt-4">
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center text-white text-3xl font-bold"
                  style={{ backgroundColor: newProfileColor }}
                >
                  {newProfileName.charAt(0).toUpperCase() || "?"}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setShowNewProfileDialog(false);
                setNewProfileName("");
                setNewProfileColor("#3B82F6");
                setSelectedUserId("");
              }}>
                Cancelar
              </Button>
              <Button onClick={handleCreateProfile}>Criar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog para editar perfil */}
        <Dialog open={showEditProfileDialog} onOpenChange={setShowEditProfileDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Editar Perfil</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-nome">Nome</Label>
                <Input
                  id="edit-nome"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="Digite o nome..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-usuario">Associar a Usuário</Label>
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um usuário..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {systemUsers.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-cor">Cor do Perfil</Label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    id="edit-cor"
                    value={newProfileColor}
                    onChange={(e) => setNewProfileColor(e.target.value)}
                    className="w-12 h-10 rounded cursor-pointer"
                  />
                  <Input
                    value={newProfileColor}
                    onChange={(e) => setNewProfileColor(e.target.value)}
                    className="flex-1"
                  />
                </div>
              </div>
              <div className="flex justify-center pt-4">
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center text-white text-3xl font-bold"
                  style={{ backgroundColor: newProfileColor }}
                >
                  {newProfileName.charAt(0).toUpperCase() || "?"}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setShowEditProfileDialog(false);
                setEditingProfile(null);
                setNewProfileName("");
                setNewProfileColor("#3B82F6");
                setSelectedUserId("");
              }}>
                Cancelar
              </Button>
              <Button onClick={handleUpdateProfile}>Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Modal de configuração de colunas */}
        <TaskFlowColumnsConfig
          open={showColumnsConfig}
          onClose={() => setShowColumnsConfig(false)}
        />
      </div>
    </div>
  );
}
