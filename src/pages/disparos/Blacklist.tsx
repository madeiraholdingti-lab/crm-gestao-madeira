import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Ban, Plus, Search, Trash2, UserX, Phone, Calendar, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import DisparosTopNav from "@/components/DisparosTopNav";

interface BlacklistItem {
  id: string;
  lead_id: string;
  motivo: string | null;
  created_at: string;
  leads: {
    id: string;
    nome: string | null;
    telefone: string;
    email: string | null;
    tipo_lead: string | null;
  } | null;
}

interface Lead {
  id: string;
  nome: string | null;
  telefone: string;
  email: string | null;
  tipo_lead: string | null;
}

export default function Blacklist() {
  const [blacklist, setBlacklist] = useState<BlacklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  
  // Estado para adicionar lead
  const [leadsDisponiveis, setLeadsDisponiveis] = useState<Lead[]>([]);
  const [leadSearch, setLeadSearch] = useState("");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [motivo, setMotivo] = useState("");
  const [addingLead, setAddingLead] = useState(false);

  useEffect(() => {
    fetchBlacklist();
  }, []);

  const fetchBlacklist = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("lead_blacklist")
      .select(`
        *,
        leads (
          id,
          nome,
          telefone,
          email,
          tipo_lead
        )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Erro ao carregar blacklist");
      console.error(error);
    } else {
      setBlacklist(data || []);
    }
    setLoading(false);
  };

  const searchLeads = async (term: string) => {
    if (term.length < 2) {
      setLeadsDisponiveis([]);
      return;
    }

    // Buscar leads que não estão na blacklist
    const { data, error } = await supabase
      .from("leads")
      .select("id, nome, telefone, email, tipo_lead")
      .or(`nome.ilike.%${term}%,telefone.ilike.%${term}%`)
      .not("id", "in", `(${blacklist.map(b => b.lead_id).join(",") || "00000000-0000-0000-0000-000000000000"})`)
      .limit(10);

    if (!error && data) {
      setLeadsDisponiveis(data);
    }
  };

  const handleAddToBlacklist = async () => {
    if (!selectedLead) {
      toast.error("Selecione um lead");
      return;
    }

    setAddingLead(true);
    
    const { data: userData } = await supabase.auth.getUser();
    
    const { error } = await supabase.from("lead_blacklist").insert({
      lead_id: selectedLead.id,
      motivo: motivo.trim() || null,
      adicionado_por: userData.user?.id
    });

    if (error) {
      if (error.code === "23505") {
        toast.error("Este lead já está na blacklist");
      } else {
        toast.error("Erro ao adicionar à blacklist");
        console.error(error);
      }
    } else {
      toast.success("Lead adicionado à blacklist");
      setDialogOpen(false);
      setSelectedLead(null);
      setMotivo("");
      setLeadSearch("");
      setLeadsDisponiveis([]);
      fetchBlacklist();
    }
    
    setAddingLead(false);
  };

  const handleRemoveFromBlacklist = async (id: string, leadNome: string) => {
    const confirmRemove = window.confirm(
      `Tem certeza que deseja remover "${leadNome || 'Lead'}" da blacklist? Este lead poderá participar de disparos novamente.`
    );

    if (!confirmRemove) return;

    const { error } = await supabase
      .from("lead_blacklist")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Erro ao remover da blacklist");
      console.error(error);
    } else {
      toast.success("Lead removido da blacklist");
      fetchBlacklist();
    }
  };

  const filteredBlacklist = blacklist.filter(item => {
    const lead = item.leads;
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      lead?.nome?.toLowerCase().includes(term) ||
      lead?.telefone?.includes(term) ||
      item.motivo?.toLowerCase().includes(term)
    );
  });

  return (
    <div className="p-4 md:p-6">
      <DisparosTopNav />
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
              <Ban className="h-7 w-7 text-red-500" />
              Blacklist
            </h1>
            <p className="text-muted-foreground mt-1">
              Leads bloqueados que nunca receberão disparos
            </p>
          </div>
          
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Adicionar à Blacklist
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <UserX className="h-5 w-5 text-red-500" />
                  Adicionar Lead à Blacklist
                </DialogTitle>
              </DialogHeader>
              
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Buscar Lead</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Digite nome ou telefone..."
                      value={leadSearch}
                      onChange={(e) => {
                        setLeadSearch(e.target.value);
                        searchLeads(e.target.value);
                      }}
                      className="pl-9"
                    />
                  </div>
                  
                  {leadsDisponiveis.length > 0 && !selectedLead && (
                    <ScrollArea className="h-40 border rounded-md">
                      <div className="p-2 space-y-1">
                        {leadsDisponiveis.map((lead) => (
                          <div
                            key={lead.id}
                            className="p-2 rounded hover:bg-muted cursor-pointer flex items-center justify-between"
                            onClick={() => {
                              setSelectedLead(lead);
                              setLeadSearch(lead.nome || lead.telefone);
                              setLeadsDisponiveis([]);
                            }}
                          >
                            <div>
                              <p className="font-medium">{lead.nome || "Sem nome"}</p>
                              <p className="text-sm text-muted-foreground">{lead.telefone}</p>
                            </div>
                            {lead.tipo_lead && (
                              <Badge variant="outline" className="text-xs">
                                {lead.tipo_lead}
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                  
                  {selectedLead && (
                    <Card className="bg-red-500/10 border-red-500/30">
                      <CardContent className="p-3 flex items-center justify-between">
                        <div>
                          <p className="font-medium">{selectedLead.nome || "Sem nome"}</p>
                          <p className="text-sm text-muted-foreground">{selectedLead.telefone}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedLead(null);
                            setLeadSearch("");
                          }}
                        >
                          Trocar
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                </div>
                
                <div className="space-y-2">
                  <Label>Motivo (opcional)</Label>
                  <Textarea
                    placeholder="Ex: Pediu para não receber mais mensagens..."
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    rows={3}
                  />
                </div>
                
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    Este lead <strong>nunca mais</strong> receberá disparos em massa enquanto estiver na blacklist.
                  </p>
                </div>
              </div>
              
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Cancelar</Button>
                </DialogClose>
                <Button 
                  onClick={handleAddToBlacklist} 
                  disabled={!selectedLead || addingLead}
                  className="bg-red-600 hover:bg-red-700"
                >
                  {addingLead ? "Adicionando..." : "Adicionar à Blacklist"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats */}
        <Card className="bg-red-500/5 border-red-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-red-500/20 flex items-center justify-center">
                <Ban className="h-6 w-6 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{blacklist.length}</p>
                <p className="text-sm text-muted-foreground">Leads bloqueados</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar na blacklist..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle>Leads Bloqueados</CardTitle>
            <CardDescription>
              Estes leads não receberão nenhum disparo em massa
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : filteredBlacklist.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchTerm ? "Nenhum resultado encontrado" : "Nenhum lead na blacklist"}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lead</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Bloqueado em</TableHead>
                    <TableHead className="w-[80px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBlacklist.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <UserX className="h-4 w-4 text-red-500" />
                          <span className="font-medium">
                            {item.leads?.nome || "Sem nome"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Phone className="h-3 w-3" />
                          {item.leads?.telefone}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-muted-foreground">
                          {item.motivo || "-"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-muted-foreground text-sm">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(item.created_at), "dd/MM/yyyy", { locale: ptBR })}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                          onClick={() => handleRemoveFromBlacklist(item.id, item.leads?.nome || "")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
