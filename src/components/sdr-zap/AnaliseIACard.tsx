import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles, RefreshCw, X, ChevronDown, ChevronUp,
  AlertTriangle, AlertCircle, CheckCircle2, Heart, Frown, Search as SearchIcon,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Analise {
  id: string;
  conversa_id: string;
  analyzed_at: string;
  sentimento: string;
  confianca: number;
  resumo: string;
  pontos_chave: string[];
  proxima_acao_sugerida: string | null;
  perfil_sugerido: string | null;
  perfil_sugerido_confianca: number | null;
  urgencia_nivel: number | null;
  model_version: string;
  mensagens_analisadas: number;
}

interface AnaliseIACardProps {
  conversaId: string;
  userId?: string | null;
  onClose: () => void;
}

const SENTIMENTO_STYLE: Record<string, { icon: typeof Sparkles; color: string; bg: string; label: string }> = {
  positivo:  { icon: CheckCircle2,    color: "text-mh-teal-700",   bg: "bg-mh-teal-500/10",    label: "Positivo" },
  neutro:    { icon: Sparkles,        color: "text-mh-ink-2",      bg: "bg-muted",             label: "Neutro" },
  negativo:  { icon: Frown,           color: "text-destructive",   bg: "bg-destructive/10",    label: "Negativo" },
  urgente:   { icon: AlertCircle,     color: "text-destructive",   bg: "bg-destructive/15",    label: "Urgente" },
  frustrado: { icon: AlertTriangle,   color: "text-amber-700",     bg: "bg-amber-100",         label: "Frustrado" },
  curioso:   { icon: SearchIcon,      color: "text-mh-navy-700",   bg: "bg-mh-navy-100",       label: "Curioso" },
};

const PERFIL_LABEL: Record<string, string> = {
  paciente: "Paciente",
  medico_cirurgiao_cardiaco: "Cirurgião cardíaco",
  medico_outra_especialidade: "Médico (outra especialidade)",
  anestesista: "Anestesista",
  enfermeiro: "Enfermeiro",
  gestor_hospital: "Gestor hospitalar",
  diretor_hospital: "Diretor de hospital",
  administrativo: "Administrativo",
  fornecedor: "Fornecedor",
  vendedor_spam: "Vendedor / spam",
  indefinido: "Indefinido",
};

function urgenciaPill(nivel: number | null) {
  if (!nivel) return null;
  const tones = [
    { min: 1, max: 2, bg: "bg-muted", fg: "text-mh-ink-3", label: "Pode esperar" },
    { min: 3, max: 3, bg: "bg-amber-100", fg: "text-amber-700", label: "Responder hoje" },
    { min: 4, max: 4, bg: "bg-destructive/10", fg: "text-destructive", label: "Responder agora" },
    { min: 5, max: 5, bg: "bg-destructive/20", fg: "text-destructive", label: "Emergência" },
  ];
  const match = tones.find(t => nivel >= t.min && nivel <= t.max) || tones[0];
  return <Badge className={`${match.bg} ${match.fg} border-transparent font-semibold`}>{match.label}</Badge>;
}

export function AnaliseIACard({ conversaId, userId, onClose }: AnaliseIACardProps) {
  const [analise, setAnalise] = useState<Analise | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const loadLatest = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            order: (col: string, opts: { ascending: boolean }) => {
              limit: (n: number) => {
                maybeSingle: () => Promise<{ data: Analise | null }>;
              };
            };
          };
        };
      };
    })
      .from("whatsapp_conversa_analise")
      .select("*")
      .eq("conversa_id", conversaId)
      .order("analyzed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setAnalise(data);
    setLoading(false);
  }, [conversaId]);

  useEffect(() => {
    loadLatest();
  }, [loadLatest]);

  const runAnalise = async () => {
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("analisar-conversa-ia", {
        body: { conversa_id: conversaId, user_id: userId ?? undefined },
      });
      if (error) throw error;
      if ((data as { success?: boolean }).success) {
        setAnalise((data as { analise: Analise }).analise);
        toast.success("Análise concluída");
      } else {
        toast.error((data as { error?: string })?.error || "Falha ao analisar");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao analisar");
    } finally {
      setAnalyzing(false);
    }
  };

  const sentStyle = analise ? (SENTIMENTO_STYLE[analise.sentimento] || SENTIMENTO_STYLE.neutro) : null;
  const SentIcon = sentStyle?.icon || Sparkles;

  return (
    <div className="border-b border-border bg-gradient-to-br from-mh-navy-50 to-card px-4 py-3 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="mh-gradient-gold h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0">
            <Sparkles className="h-3.5 w-3.5 text-mh-navy-950" />
          </div>
          <div className="min-w-0">
            <div className="font-serif-display text-sm font-medium text-mh-ink leading-tight">
              Análise da IA
            </div>
            {analise && (
              <div className="text-[10px] text-mh-ink-3">
                {formatDistanceToNow(new Date(analise.analyzed_at), { addSuffix: true, locale: ptBR })}
                {" · "}
                {analise.mensagens_analisadas} msgs · Gemini 2.5
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button
            variant="ghost" size="sm" onClick={runAnalise} disabled={analyzing}
            className="h-7 text-xs gap-1"
          >
            <RefreshCw className={`h-3 w-3 ${analyzing ? "animate-spin" : ""}`} />
            {analise ? "Reanalizar" : "Analisar"}
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="mt-2 space-y-1">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ) : !analise ? (
        <p className="text-xs text-mh-ink-3 mt-2 italic">
          Clique em "Analisar" para a IA qualificar essa conversa (sentimento, urgência, perfil e próxima ação).
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mt-2.5">
            {sentStyle && (
              <Badge className={`${sentStyle.bg} ${sentStyle.color} border-transparent font-semibold gap-1`}>
                <SentIcon className="h-3 w-3" />
                {sentStyle.label}
                <span className="opacity-70">· {(analise.confianca * 100).toFixed(0)}%</span>
              </Badge>
            )}
            {urgenciaPill(analise.urgencia_nivel)}
            {analise.perfil_sugerido && analise.perfil_sugerido !== "indefinido" && (
              <Badge variant="outline" className="gap-1">
                <Heart className="h-3 w-3" />
                {PERFIL_LABEL[analise.perfil_sugerido] || analise.perfil_sugerido}
                {analise.perfil_sugerido_confianca !== null && (
                  <span className="opacity-60">· {(analise.perfil_sugerido_confianca * 100).toFixed(0)}%</span>
                )}
              </Badge>
            )}
          </div>

          <p className="text-sm text-mh-ink-2 mt-2.5 leading-relaxed">
            {analise.resumo}
          </p>

          {analise.proxima_acao_sugerida && (
            <div className="mt-2 flex items-start gap-2 bg-mh-gold-100/50 border border-mh-gold-300/30 rounded-md px-2.5 py-2">
              <Sparkles className="h-3.5 w-3.5 text-mh-gold-700 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-mh-ink-2">
                <span className="font-semibold text-mh-gold-700">Sugestão: </span>
                {analise.proxima_acao_sugerida}
              </div>
            </div>
          )}

          {analise.pontos_chave.length > 0 && (
            <div className="mt-2">
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 text-[11px] text-mh-ink-3 hover:text-mh-ink transition-colors"
              >
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {expanded ? "Ocultar pontos-chave" : `Ver ${analise.pontos_chave.length} pontos-chave`}
              </button>
              {expanded && (
                <ul className="mt-1.5 space-y-1 pl-4">
                  {analise.pontos_chave.map((p, i) => (
                    <li key={i} className="text-xs text-mh-ink-2 list-disc leading-snug">{p}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
