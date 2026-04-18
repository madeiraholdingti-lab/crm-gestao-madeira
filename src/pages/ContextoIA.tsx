import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  BrainCircuit,
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  CheckCircle2,
  CircleDot,
  X,
  MapPin,
  Building,
  Briefcase,
  AlertTriangle,
} from "lucide-react";

interface Pergunta {
  id?: string;
  pergunta: string;
  ordem: number;
  obrigatoria: boolean;
}

interface Script {
  id: string;
  nome: string;
  descricao_vaga: string | null;
  ativo: boolean;
  created_at: string;
  perguntas: Pergunta[];
  tipo_vaga: string | null;
  presencial: boolean | null;
  necessario_mudar: boolean | null;
  detalhes_vaga: string[] | null;
}

const tiposVagaOptions = [
  { value: "plantao", label: "Plantão" },
  { value: "por_hora", label: "Por Hora" },
  { value: "por_producao", label: "Por Produção" },
];

export default function ContextoIA() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingScript, setEditingScript] = useState<Script | null>(null);

  // Form state
  const [nome, setNome] = useState("");
  const [descricaoVaga, setDescricaoVaga] = useState("");
  const [perguntas, setPerguntas] = useState<Pergunta[]>([]);
  const [tipoVaga, setTipoVaga] = useState("");
  const [presencial, setPresencial] = useState(false);
  const [necessarioMudar, setNecessarioMudar] = useState(false);
  const [detalhesVaga, setDetalhesVaga] = useState<string[]>([]);
  const [novoDetalhe, setNovoDetalhe] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchScripts();
  }, []);

  const fetchScripts = async () => {
    setLoading(true);
    const { data: scriptsData, error } = await supabase
      .from("ia_scripts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Erro ao carregar scripts");
      setLoading(false);
      return;
    }

    // Fetch perguntas for each script
    const scriptsWithPerguntas: Script[] = [];
    for (const s of scriptsData || []) {
      const { data: perguntasData } = await supabase
        .from("ia_script_perguntas")
        .select("*")
        .eq("script_id", s.id)
        .order("ordem", { ascending: true });

      scriptsWithPerguntas.push({
        ...s,
        perguntas: (perguntasData || []) as Pergunta[],
      });
    }

    setScripts(scriptsWithPerguntas);
    setLoading(false);
  };

  const openNew = () => {
    setEditingScript(null);
    setNome("");
    setDescricaoVaga("");
    setPerguntas([]);
    setTipoVaga("");
    setPresencial(false);
    setNecessarioMudar(false);
    setDetalhesVaga([]);
    setNovoDetalhe("");
    setDialogOpen(true);
  };

  const openEdit = (script: Script) => {
    setEditingScript(script);
    setNome(script.nome);
    setDescricaoVaga(script.descricao_vaga || "");
    setPerguntas(script.perguntas.map((p) => ({ ...p })));
    setTipoVaga(script.tipo_vaga || "");
    setPresencial(script.presencial ?? false);
    setNecessarioMudar(script.necessario_mudar ?? false);
    setDetalhesVaga(script.detalhes_vaga || []);
    setNovoDetalhe("");
    setDialogOpen(true);
  };

  const addPergunta = () => {
    setPerguntas((prev) => [
      ...prev,
      { pergunta: "", ordem: prev.length, obrigatoria: true },
    ]);
  };

  const removePergunta = (idx: number) => {
    setPerguntas((prev) => prev.filter((_, i) => i !== idx).map((p, i) => ({ ...p, ordem: i })));
  };

  const updatePergunta = (idx: number, field: keyof Pergunta, value: any) => {
    setPerguntas((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p))
    );
  };

  const addDetalhe = () => {
    if (!novoDetalhe.trim()) return;
    setDetalhesVaga((prev) => [...prev, novoDetalhe.trim()]);
    setNovoDetalhe("");
  };

  const removeDetalhe = (idx: number) => {
    setDetalhesVaga((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!nome.trim()) {
      toast.error("Nome do script é obrigatório");
      return;
    }
    setSaving(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      const scriptPayload = {
        nome,
        descricao_vaga: descricaoVaga || null,
        tipo_vaga: tipoVaga || null,
        presencial: presencial,
        necessario_mudar: necessarioMudar,
        detalhes_vaga: detalhesVaga.length > 0 ? detalhesVaga : [],
      };

      if (editingScript) {
        const { error } = await supabase
          .from("ia_scripts")
          .update(scriptPayload)
          .eq("id", editingScript.id);

        if (error) throw error;

        // Delete old perguntas and re-insert
        await supabase
          .from("ia_script_perguntas")
          .delete()
          .eq("script_id", editingScript.id);

        if (perguntas.length > 0) {
          const { error: pErr } = await supabase
            .from("ia_script_perguntas")
            .insert(
              perguntas.map((p, i) => ({
                script_id: editingScript.id,
                pergunta: p.pergunta,
                ordem: i,
                obrigatoria: p.obrigatoria,
              }))
            );
          if (pErr) throw pErr;
        }

        toast.success("Script atualizado!");
      } else {
        const { data: newScript, error } = await supabase
          .from("ia_scripts")
          .insert({ ...scriptPayload, created_by: user?.id })
          .select()
          .single();

        if (error) throw error;

        if (perguntas.length > 0) {
          const { error: pErr } = await supabase
            .from("ia_script_perguntas")
            .insert(
              perguntas.map((p, i) => ({
                script_id: newScript.id,
                pergunta: p.pergunta,
                ordem: i,
                obrigatoria: p.obrigatoria,
              }))
            );
          if (pErr) throw pErr;
        }

        toast.success("Script criado!");
      }

      setDialogOpen(false);
      fetchScripts();
    } catch (e: any) {
      toast.error("Erro ao salvar: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleAtivo = async (script: Script) => {
    const { error } = await supabase
      .from("ia_scripts")
      .update({ ativo: !script.ativo })
      .eq("id", script.id);

    if (error) {
      toast.error("Erro ao atualizar status");
      return;
    }
    fetchScripts();
  };

  const deleteScript = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este script?")) return;
    const { error } = await supabase.from("ia_scripts").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir");
      return;
    }
    toast.success("Script excluído");
    fetchScripts();
  };

  const getTipoVagaLabel = (value: string | null) => {
    return tiposVagaOptions.find(t => t.value === value)?.label || value;
  };

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5">
            <BrainCircuit className="h-7 w-7 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Contexto IA</h1>
            <p className="text-sm text-muted-foreground">
              Gerencie scripts de IA para respostas automáticas no WhatsApp
            </p>
          </div>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" />
          Novo Script
        </Button>
      </div>

      {/* Scripts list */}
      {loading ? (
        <div className="text-center text-muted-foreground py-12">Carregando...</div>
      ) : scripts.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <BrainCircuit className="h-12 w-12 text-muted-foreground/40" />
            <p className="text-muted-foreground">Nenhum script cadastrado</p>
            <Button variant="outline" onClick={openNew} className="gap-2">
              <Plus className="h-4 w-4" />
              Criar primeiro script
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {scripts.map((script) => (
            <Card key={script.id} className={!script.ativo ? "opacity-60" : ""}>
              <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-lg">{script.nome}</CardTitle>
                    <Badge variant={script.ativo ? "default" : "secondary"}>
                      {script.ativo ? "Ativo" : "Inativo"}
                    </Badge>
                    {script.tipo_vaga && (
                      <Badge variant="outline">{getTipoVagaLabel(script.tipo_vaga)}</Badge>
                    )}
                  </div>
                  {script.descricao_vaga && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {script.descricao_vaga}
                    </p>
                  )}
                  {/* Info badges */}
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    {script.presencial !== null && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {script.presencial ? "Presencial" : "Remoto"}
                      </span>
                    )}
                    {script.necessario_mudar !== null && script.necessario_mudar && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Building className="h-3 w-3" />
                        Necessário se mudar
                      </span>
                    )}
                    {script.detalhes_vaga && script.detalhes_vaga.length > 0 && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <AlertTriangle className="h-3 w-3" />
                        {script.detalhes_vaga.length} gatilho(s)
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Switch
                    checked={script.ativo}
                    onCheckedChange={() => toggleAtivo(script)}
                  />
                  <Button variant="ghost" size="icon" onClick={() => openEdit(script)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteScript(script.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardHeader>
              {script.perguntas.length > 0 && (
                <CardContent className="pt-0">
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Checklist ({script.perguntas.length} perguntas)
                  </p>
                  <div className="flex flex-col gap-1">
                    {script.perguntas.map((p, i) => (
                      <div key={p.id || i} className="flex items-center gap-2 text-sm">
                        {p.obrigatoria ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                        ) : (
                          <CircleDot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        <span className="truncate">{p.pergunta}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Dialog create/edit */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingScript ? "Editar Script" : "Novo Script"}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Nome do Script *</label>
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex: Vaga Cardiologista SP"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Descrição da Vaga</label>
              <Textarea
                value={descricaoVaga}
                onChange={(e) => setDescricaoVaga(e.target.value)}
                placeholder="Descreva a vaga, critérios, informações relevantes para a IA..."
                rows={4}
              />
            </div>

            {/* Tipo de Vaga */}
            <div>
              <Label className="mb-1 block">Tipo de Vaga</Label>
              <Select value={tipoVaga} onValueChange={setTipoVaga}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o tipo de vaga..." />
                </SelectTrigger>
                <SelectContent>
                  {tiposVagaOptions.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Presencial + Necessário se mudar */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-sm font-normal">Presencial</Label>
                </div>
                <Switch checked={presencial} onCheckedChange={setPresencial} />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Building className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-sm font-normal">Necessário se mudar</Label>
                </div>
                <Switch checked={necessarioMudar} onCheckedChange={setNecessarioMudar} />
              </div>
            </div>

            {/* Detalhes da Vaga (gatilhos) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <label className="text-sm font-medium">Detalhes / Gatilhos da Vaga</label>
                  <p className="text-xs text-muted-foreground">
                    Perguntas ou situações específicas que o médico pode levantar fora do script
                  </p>
                </div>
              </div>

              <div className="flex gap-2 mb-2">
                <Input
                  value={novoDetalhe}
                  onChange={(e) => setNovoDetalhe(e.target.value)}
                  placeholder="Ex: Pergunta se fazemos por produção..."
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDetalhe(); } }}
                />
                <Button variant="outline" size="sm" onClick={addDetalhe} className="shrink-0 gap-1">
                  <Plus className="h-3.5 w-3.5" />
                  Adicionar
                </Button>
              </div>

              {detalhesVaga.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-3 border border-dashed rounded-md">
                  Nenhum detalhe adicionado
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {detalhesVaga.map((detalhe, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 rounded-md border p-2 bg-muted/30 text-sm"
                    >
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      <span className="flex-1">{detalhe}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 h-7 w-7"
                        onClick={() => removeDetalhe(idx)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Perguntas checklist */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">Checklist de Perguntas</label>
                <Button variant="outline" size="sm" onClick={addPergunta} className="gap-1">
                  <Plus className="h-3.5 w-3.5" />
                  Pergunta
                </Button>
              </div>

              {perguntas.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-md">
                  Nenhuma pergunta adicionada
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {perguntas.map((p, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 rounded-md border p-2 bg-muted/30"
                    >
                      <GripVertical className="h-4 w-4 text-muted-foreground mt-2.5 shrink-0" />
                      <div className="flex-1 flex flex-col gap-1.5">
                        <Input
                          value={p.pergunta}
                          onChange={(e) => updatePergunta(idx, "pergunta", e.target.value)}
                          placeholder={`Pergunta ${idx + 1}`}
                          className="text-sm"
                        />
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Switch
                            checked={p.obrigatoria}
                            onCheckedChange={(v) => updatePergunta(idx, "obrigatoria", v)}
                            className="scale-75"
                          />
                          Obrigatória
                        </label>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 h-8 w-8"
                        onClick={() => removePergunta(idx)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Salvando..." : editingScript ? "Salvar" : "Criar Script"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
