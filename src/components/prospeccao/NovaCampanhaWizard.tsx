import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Settings, Send, MessageSquare, Sparkles } from "lucide-react";

const TIPOS = [
  { v: "prospeccao", l: "Prospecção (padrão)" },
  { v: "evento", l: "Evento" },
  { v: "reativacao", l: "Reativação" },
  { v: "divulgacao", l: "Divulgação" },
  { v: "pos_operatorio", l: "Pós-operatório" },
  { v: "custom", l: "Custom" },
];

const DIAS_SEMANA = [
  { v: 1, l: "Seg" }, { v: 2, l: "Ter" }, { v: 3, l: "Qua" },
  { v: 4, l: "Qui" }, { v: 5, l: "Sex" }, { v: 6, l: "Sáb" }, { v: 0, l: "Dom" },
];

interface Instancia {
  id: string;
  nome_instancia: string;
  numero_chip: string | null;
  cor_identificacao: string | null;
  status: string | null;
}

interface BriefingIA {
  ia_ativa?: boolean;
  persona?: string;
  objetivo?: string;
  contexto?: string;
  handoff_keywords?: string[];
  handoff_telefones?: string[];
  handoff_telefone?: string; // legacy
  handoff_numero_chip?: string;
}

export interface CampanhaEditInput {
  id?: string;
  nome: string;
  descricao: string | null;
  mensagem: string;
  tipo: string | null;
  chip_ids: string[];
  filtro_tipo_lead: string[] | null;
  filtro_perfil_profissional: string[] | null;
  envios_por_dia: number | null;
  intervalo_min_minutos: number | null;
  intervalo_max_minutos: number | null;
  horario_inicio: string | null;
  horario_fim: string | null;
  dias_semana: number[] | null;
  spintax_ativo: boolean | null;
  briefing_ia: BriefingIA | null;
  status?: string;
  ativo?: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: CampanhaEditInput | null;
  onSaved: () => void;
}

const defaultBriefing = (): BriefingIA => ({
  ia_ativa: true,
  persona: "Você é da equipe do Dr. Maikon Madeira, cirurgião cardíaco em Itajaí/SC. Fala direto, sem formalidade, como colega de profissão.",
  objetivo: "Qualificar o interesse do contato e escalar pra humano se demonstrar fit real.",
  contexto: "",
  handoff_keywords: ["salario", "salário", "valor", "remuneração", "remuneracao"],
  handoff_telefones: [],
});

const emptyForm = (): CampanhaEditInput => ({
  nome: "",
  descricao: "",
  mensagem: "",
  tipo: "prospeccao",
  chip_ids: [],
  filtro_tipo_lead: [],
  filtro_perfil_profissional: [],
  envios_por_dia: 120,
  intervalo_min_minutos: 1,
  intervalo_max_minutos: 3,
  horario_inicio: "09:00",
  horario_fim: "18:00",
  dias_semana: [1, 2, 3, 4, 5],
  spintax_ativo: true,
  briefing_ia: defaultBriefing(),
});

export default function NovaCampanhaWizard({ open, onOpenChange, editing, onSaved }: Props) {
  const [tab, setTab] = useState("config");
  const [form, setForm] = useState<CampanhaEditInput>(emptyForm());
  const [instancias, setInstancias] = useState<Instancia[]>([]);
  const [saving, setSaving] = useState(false);

  // Reset form quando abrir/trocar editing
  useEffect(() => {
    if (!open) return;
    setTab("config");
    if (editing) {
      // Migra handoff_telefone (legacy string) pra handoff_telefones (array)
      const b = editing.briefing_ia || defaultBriefing();
      const handoff_telefones = b.handoff_telefones?.length
        ? b.handoff_telefones
        : (b.handoff_telefone ? [b.handoff_telefone] : []);
      setForm({
        ...editing,
        descricao: editing.descricao || "",
        tipo: editing.tipo || "prospeccao",
        chip_ids: editing.chip_ids || [],
        filtro_tipo_lead: editing.filtro_tipo_lead || [],
        filtro_perfil_profissional: editing.filtro_perfil_profissional || [],
        envios_por_dia: editing.envios_por_dia ?? 120,
        intervalo_min_minutos: editing.intervalo_min_minutos ?? 1,
        intervalo_max_minutos: editing.intervalo_max_minutos ?? 3,
        horario_inicio: editing.horario_inicio || "09:00",
        horario_fim: editing.horario_fim || "18:00",
        dias_semana: editing.dias_semana || [1, 2, 3, 4, 5],
        spintax_ativo: editing.spintax_ativo ?? true,
        briefing_ia: { ...b, handoff_telefones },
      });
    } else {
      setForm(emptyForm());
    }
  }, [open, editing]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase
        .from("instancias_whatsapp")
        .select("id, nome_instancia, numero_chip, cor_identificacao, status")
        .eq("ativo", true)
        .in("status", ["conectada", "ativa", "open"])
        .order("nome_instancia");
      setInstancias((data || []) as Instancia[]);
    })();
  }, [open]);

  // Validação dos 4 blocos
  const validacao = useMemo(() => {
    const issues: Record<string, string[]> = { config: [], disparo: [], mensagem: [], briefing: [] };
    if (!form.nome || form.nome.trim().length < 3) issues.config.push("Nome muito curto");
    if (!form.tipo) issues.config.push("Selecione o tipo da campanha");

    if (!form.chip_ids || form.chip_ids.length === 0) issues.disparo.push("Selecione pelo menos 1 chip");
    if (!form.envios_por_dia || form.envios_por_dia < 1) issues.disparo.push("Envios/dia inválido");
    if (!form.dias_semana || form.dias_semana.length === 0) issues.disparo.push("Selecione pelo menos 1 dia da semana");

    if (!form.mensagem || form.mensagem.trim().length < 20) issues.mensagem.push("Mensagem muito curta (mín. 20 chars)");

    const b = form.briefing_ia || {};
    if (b.ia_ativa) {
      if (!b.persona || b.persona.length < 20) issues.briefing.push("Persona muito curta");
      if (!b.objetivo || b.objetivo.length < 10) issues.briefing.push("Objetivo muito curto");
      if (!b.handoff_telefones || b.handoff_telefones.length === 0) issues.briefing.push("Pelo menos 1 telefone de handoff");
    }
    return issues;
  }, [form]);

  const totalIssues = useMemo(() => Object.values(validacao).flat().length, [validacao]);
  const isReady = totalIssues === 0;

  async function save(ativar: boolean) {
    if (ativar && !isReady) {
      toast.error(`Faltam ${totalIssues} campo${totalIssues !== 1 ? "s" : ""} obrigatório${totalIssues !== 1 ? "s" : ""} antes de ativar`);
      return;
    }

    setSaving(true);
    const payload: Record<string, unknown> = {
      nome: form.nome.trim(),
      descricao: form.descricao?.trim() || null,
      mensagem: form.mensagem.trim(),
      tipo: form.tipo,
      chip_ids: form.chip_ids,
      instancia_id: form.chip_ids[0] || null,
      filtro_tipo_lead: form.filtro_tipo_lead,
      filtro_perfil_profissional: form.filtro_perfil_profissional,
      envios_por_dia: form.envios_por_dia,
      intervalo_min_minutos: form.intervalo_min_minutos,
      intervalo_max_minutos: form.intervalo_max_minutos,
      horario_inicio: form.horario_inicio,
      horario_fim: form.horario_fim,
      dias_semana: form.dias_semana,
      spintax_ativo: form.spintax_ativo,
      briefing_ia: form.briefing_ia,
      ativo: true,
      status: ativar ? "ativa" : (form.status === "ativa" ? "ativa" : "rascunho"),
    };

    try {
      if (editing?.id) {
        const { error } = await supabase.from("campanhas_disparo").update(payload).eq("id", editing.id);
        if (error) throw error;
        toast.success(ativar ? "Campanha atualizada e ativada" : "Campanha atualizada");
      } else {
        const { error } = await supabase.from("campanhas_disparo").insert([payload]);
        if (error) throw error;
        toast.success(ativar ? "Campanha criada e ativada" : "Campanha salva como rascunho");
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Erro ao salvar: " + msg);
    } finally {
      setSaving(false);
    }
  }

  function toggleChip(id: string) {
    setForm((p) => ({
      ...p,
      chip_ids: p.chip_ids.includes(id) ? p.chip_ids.filter((c) => c !== id) : [...p.chip_ids, id],
    }));
  }

  function toggleDia(d: number) {
    setForm((p) => ({
      ...p,
      dias_semana: (p.dias_semana || []).includes(d)
        ? (p.dias_semana || []).filter((x) => x !== d)
        : [...(p.dias_semana || []), d].sort((a, b) => a - b),
    }));
  }

  const b = form.briefing_ia || {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{editing?.id ? "Editar campanha" : "Nova campanha"}</DialogTitle>
          <DialogDescription>
            Configure em 4 passos. A campanha pode ser salva como rascunho e ativada depois.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid grid-cols-4">
            <TabTrigger value="config" icon={<Settings className="h-3 w-3" />} label="Config" issues={validacao.config.length} />
            <TabTrigger value="disparo" icon={<Send className="h-3 w-3" />} label="Disparo" issues={validacao.disparo.length} />
            <TabTrigger value="mensagem" icon={<MessageSquare className="h-3 w-3" />} label="Mensagem" issues={validacao.mensagem.length} />
            <TabTrigger value="briefing" icon={<Sparkles className="h-3 w-3" />} label="Briefing IA" issues={validacao.briefing.length} />
          </TabsList>

          <div className="flex-1 overflow-y-auto mt-4 pr-1">
            {/* CONFIG */}
            <TabsContent value="config" className="space-y-4 mt-0">
              <div>
                <Label>Nome da campanha *</Label>
                <Input
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  placeholder="Ex: Cardiologistas SC — Evento Nov/2026"
                />
              </div>
              <div>
                <Label>Descrição (interna, opcional)</Label>
                <Input
                  value={form.descricao || ""}
                  onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                  placeholder="Pra sua própria referência"
                />
              </div>
              <div>
                <Label>Tipo *</Label>
                <Select value={form.tipo || "prospeccao"} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIPOS.map((t) => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            {/* DISPARO */}
            <TabsContent value="disparo" className="space-y-4 mt-0">
              <div>
                <Label>Chips (pelo menos 1) *</Label>
                <p className="text-[11px] text-mh-ink-3 mb-2">Os chips rodam em rotação. Se um falhar, o sistema tenta o próximo.</p>
                <div className="grid grid-cols-2 gap-2">
                  {instancias.map((i) => (
                    <label key={i.id} className={
                      "flex items-center gap-2 border rounded px-3 py-2 cursor-pointer text-xs " +
                      (form.chip_ids.includes(i.id) ? "border-mh-gold-400 bg-mh-gold-50" : "border-mh-ink-200")
                    }>
                      <Checkbox checked={form.chip_ids.includes(i.id)} onCheckedChange={() => toggleChip(i.id)} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{i.nome_instancia}</div>
                        <div className="text-mh-ink-3">{i.numero_chip || "sem número"}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Envios por dia</Label>
                  <Input type="number" min={1} value={form.envios_por_dia ?? 0}
                    onChange={(e) => setForm({ ...form, envios_por_dia: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>Intervalo min (min)</Label>
                  <Input type="number" min={1} value={form.intervalo_min_minutos ?? 0}
                    onChange={(e) => setForm({ ...form, intervalo_min_minutos: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>Intervalo max (min)</Label>
                  <Input type="number" min={1} value={form.intervalo_max_minutos ?? 0}
                    onChange={(e) => setForm({ ...form, intervalo_max_minutos: Number(e.target.value) })} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Horário início</Label>
                  <Input type="time" value={form.horario_inicio || ""}
                    onChange={(e) => setForm({ ...form, horario_inicio: e.target.value })} />
                </div>
                <div>
                  <Label>Horário fim</Label>
                  <Input type="time" value={form.horario_fim || ""}
                    onChange={(e) => setForm({ ...form, horario_fim: e.target.value })} />
                </div>
              </div>

              <div>
                <Label>Dias da semana *</Label>
                <div className="flex gap-2 mt-1">
                  {DIAS_SEMANA.map((d) => {
                    const active = (form.dias_semana || []).includes(d.v);
                    return (
                      <Button key={d.v} type="button" variant={active ? "default" : "outline"} size="sm"
                        onClick={() => toggleDia(d.v)}>{d.l}</Button>
                    );
                  })}
                </div>
              </div>
            </TabsContent>

            {/* MENSAGEM */}
            <TabsContent value="mensagem" className="space-y-4 mt-0">
              <div>
                <Label>Mensagem inicial *</Label>
                <p className="text-[11px] text-mh-ink-3 mb-1">
                  Spintax: use chaves pra variações — ex: <code className="text-mh-gold-600">{"{Oi|Opa|E aí}"}</code> Dr. Como vai?<br/>
                  Placeholders: <code className="text-mh-gold-600">{"{{nome}}"}</code>
                </p>
                <Textarea
                  rows={6}
                  value={form.mensagem}
                  onChange={(e) => setForm({ ...form, mensagem: e.target.value })}
                  placeholder="Ex: {Oi|Opa|E aí} {{nome}}! {Aqui é a Iza|Sou a Iza} do time do Dr. Maikon. {Posso te chamar rapidinho?|Tá afim de um papo rápido?}"
                />
                <div className="text-[11px] text-mh-ink-3 mt-1">
                  {form.mensagem.length} caracteres
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={!!form.spintax_ativo} onCheckedChange={(v) => setForm({ ...form, spintax_ativo: v })} />
                <Label className="cursor-pointer">Ativar spintax (variações automáticas)</Label>
              </div>
            </TabsContent>

            {/* BRIEFING IA */}
            <TabsContent value="briefing" className="space-y-4 mt-0">
              <div className="flex items-center gap-2">
                <Switch
                  checked={!!b.ia_ativa}
                  onCheckedChange={(v) => setForm({ ...form, briefing_ia: { ...b, ia_ativa: v } })}
                />
                <Label className="cursor-pointer">IA conversa automaticamente com quem responder</Label>
              </div>

              {b.ia_ativa && (
                <>
                  <div>
                    <Label>Persona *</Label>
                    <p className="text-[11px] text-mh-ink-3 mb-1">Quem é você na conversa. Tom + identidade.</p>
                    <Textarea
                      rows={3}
                      value={b.persona || ""}
                      onChange={(e) => setForm({ ...form, briefing_ia: { ...b, persona: e.target.value } })}
                    />
                  </div>

                  <div>
                    <Label>Objetivo *</Label>
                    <p className="text-[11px] text-mh-ink-3 mb-1">O que a IA deve conseguir nessa conversa.</p>
                    <Textarea
                      rows={2}
                      value={b.objetivo || ""}
                      onChange={(e) => setForm({ ...form, briefing_ia: { ...b, objetivo: e.target.value } })}
                    />
                  </div>

                  <div>
                    <Label>Contexto (opcional)</Label>
                    <p className="text-[11px] text-mh-ink-3 mb-1">Detalhes da proposta: serviço, valores, data do evento, local, etc. A IA usa pra responder perguntas.</p>
                    <Textarea
                      rows={4}
                      value={b.contexto || ""}
                      onChange={(e) => setForm({ ...form, briefing_ia: { ...b, contexto: e.target.value } })}
                    />
                  </div>

                  <div>
                    <Label>Telefones pra alertar handoff * (responsável da campanha)</Label>
                    <p className="text-[11px] text-mh-ink-3 mb-1">Separe por vírgula. Ex: 5547999999999, 5547988888888</p>
                    <Input
                      className="font-mono text-xs"
                      value={(b.handoff_telefones || []).join(", ")}
                      onChange={(e) => setForm({ ...form, briefing_ia: {
                        ...b,
                        handoff_telefones: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                      }})}
                      placeholder="5547999999999, 5547988888888"
                    />
                  </div>

                  <div>
                    <Label>Palavras-chave pra escalar</Label>
                    <Input
                      className="text-xs"
                      value={(b.handoff_keywords || []).join(", ")}
                      onChange={(e) => setForm({ ...form, briefing_ia: {
                        ...b,
                        handoff_keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                      }})}
                      placeholder="salário, valor, remuneração"
                    />
                  </div>
                </>
              )}

              {!b.ia_ativa && (
                <p className="text-xs text-mh-ink-3 italic">
                  Com IA desligada, as respostas dos leads caem no SDR Zap normal pra alguém responder manualmente.
                </p>
              )}
            </TabsContent>
          </div>
        </Tabs>

        <DialogFooter className="flex items-center justify-between border-t border-mh-ink-100 pt-3 mt-2">
          <div className="text-xs text-mh-ink-3">
            {isReady ? (
              <span className="flex items-center gap-1 text-emerald-700">
                <CheckCircle2 className="h-3 w-3" /> Pronta pra ativar
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-700">
                <AlertCircle className="h-3 w-3" /> {totalIssues} pendência{totalIssues !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" disabled={saving} onClick={() => save(false)}>
              Salvar rascunho
            </Button>
            <Button disabled={saving || !isReady} onClick={() => save(true)}>
              Salvar e ativar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TabTrigger({ value, icon, label, issues }: { value: string; icon: React.ReactNode; label: string; issues: number }) {
  return (
    <TabsTrigger value={value} className="flex items-center gap-1.5">
      {icon}
      <span>{label}</span>
      {issues > 0 && (
        <Badge variant="destructive" className="h-4 min-w-4 text-[10px] px-1 ml-1">{issues}</Badge>
      )}
    </TabsTrigger>
  );
}
