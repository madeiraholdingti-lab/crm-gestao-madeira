import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { BarChart3, Send, Users, CheckCircle, XCircle, Calendar, Filter, TrendingUp, Target, MessageCircle, UserCircle, ListTodo, AlertCircle, PlusCircle } from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, eachDayOfInterval, parseISO, isPast, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Label } from "@/components/ui/label";

interface Campanha {
  id: string;
  nome: string;
}

interface EnviosPorDia {
  data: string;
  enviados: number;
  pendentes: number;
  falhas: number;
}

interface EnviosPorCampanha {
  campanha: string;
  total: number;
  enviados: number;
  pendentes: number;
  falhas: number;
}

interface EnviosPorEspecialidade {
  especialidade: string;
  total: number;
  enviados: number;
}

interface ResumoMensal {
  mes: string;
  total: number;
  enviados: number;
  pendentes: number;
  falhas: number;
}

interface ConversaoData {
  campanha: string;
  enviados: number;
  responderam: number;
  taxaConversao: number;
}

interface EnviosPorTipo {
  tipo: string;
  cor: string;
  total: number;
  enviados: number;
  pendentes: number;
  falhas: number;
}

interface TarefasPorDia {
  data: string;
  criadas: number;
  finalizadas: number;
  atrasadas: number;
}

interface TarefasPorPerfil {
  perfil: string;
  cor: string;
  criadas: number;
  finalizadas: number;
  atrasadas: number;
}

// Normaliza telefone removendo o 9 extra após DDD para comparação
const normalizarTelefone = (telefone: string): string => {
  const nums = telefone.replace(/\D/g, "");
  // Se tem 13 dígitos (55 + DDD + 9 + 8 dígitos), remove o 9 após DDD
  if (nums.length === 13 && nums.startsWith("55")) {
    return nums.slice(0, 4) + nums.slice(5); // 55XX + 8 dígitos
  }
  // Se tem 11 dígitos (DDD + 9 + 8 dígitos), remove o 9
  if (nums.length === 11) {
    return nums.slice(0, 2) + nums.slice(3); // XX + 8 dígitos
  }
  return nums;
};

const COLORS = [
  "hsl(var(--chart-1))", 
  "hsl(var(--chart-2))", 
  "hsl(var(--chart-3))", 
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899"
];

export default function Relatorios() {
  const [loading, setLoading] = useState(true);
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [selectedCampanha, setSelectedCampanha] = useState<string>("__all__");
  const [selectedPeriodo, setSelectedPeriodo] = useState<string>("30");
  
  // Dados dos relatórios
  const [enviosPorDia, setEnviosPorDia] = useState<EnviosPorDia[]>([]);
  const [enviosPorCampanha, setEnviosPorCampanha] = useState<EnviosPorCampanha[]>([]);
  const [enviosPorEspecialidade, setEnviosPorEspecialidade] = useState<EnviosPorEspecialidade[]>([]);
  const [resumoMensal, setResumoMensal] = useState<ResumoMensal[]>([]);
  const [conversaoData, setConversaoData] = useState<ConversaoData[]>([]);
  const [enviosPorTipo, setEnviosPorTipo] = useState<EnviosPorTipo[]>([]);

  // Dados de tarefas
  const [tarefasPorDia, setTarefasPorDia] = useState<TarefasPorDia[]>([]);
  const [tarefasPorPerfil, setTarefasPorPerfil] = useState<TarefasPorPerfil[]>([]);
  const [totaisTarefas, setTotaisTarefas] = useState({
    criadas: 0,
    finalizadas: 0,
    atrasadas: 0,
    emAndamento: 0,
  });
  
  // Totais
  const [totais, setTotais] = useState({
    totalEnvios: 0,
    enviados: 0,
    pendentes: 0,
    falhas: 0,
    taxaSucesso: 0,
    responderam: 0,
    taxaConversao: 0
  });

  useEffect(() => {
    fetchCampanhas();
  }, []);

  useEffect(() => {
    fetchRelatorios();
    fetchTarefasRelatorio();
  }, [selectedCampanha, selectedPeriodo]);

  const fetchCampanhas = async () => {
    const { data } = await supabase
      .from("campanhas_disparo")
      .select("id, nome")
      .order("nome");
    setCampanhas(data || []);
  };

  const fetchRelatorios = async () => {
    setLoading(true);
    try {
      const diasAtras = parseInt(selectedPeriodo);
      const dataInicio = subDays(new Date(), diasAtras).toISOString();
      
      // Query base para campanha_envios
      let query = supabase
        .from("campanha_envios")
        .select(`
          id,
          status,
          telefone,
          enviado_em,
          created_at,
          lead_id,
          campanha_id,
          campanhas_disparo (nome),
          leads (especialidade, tipo_lead)
        `)
        .gte("created_at", dataInicio);
      
      if (selectedCampanha !== "__all__") {
        query = query.eq("campanha_id", selectedCampanha);
      }

      // Buscar todos os envios com paginação
      const PAGE_SIZE = 1000;
      const allEnvios: any[] = [];
      
      for (let from = 0; from < 100000; from += PAGE_SIZE) {
        const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
        if (error) break;
        allEnvios.push(...(data || []));
        if ((data || []).length < PAGE_SIZE) break;
      }

      // Calcular totais
      const totalEnvios = allEnvios.length;
      const enviados = allEnvios.filter(e => e.status === "enviado").length;
      const pendentes = allEnvios.filter(e => e.status === "enviar" || e.status === "reenviar" || e.status === "pendente").length;
      const falhas = allEnvios.filter(e => e.status === "NoZap" || e.status === "erro" || e.status === "falha").length;
      const taxaSucesso = totalEnvios > 0 ? Math.round((enviados / totalEnvios) * 100) : 0;
      
      setTotais({ totalEnvios, enviados, pendentes, falhas, taxaSucesso, responderam: 0, taxaConversao: 0 });

      // Envios por dia
      const enviosPorDiaMap: { [key: string]: { enviados: number; pendentes: number; falhas: number } } = {};
      
      allEnvios.forEach(envio => {
        const data = format(parseISO(envio.created_at), "yyyy-MM-dd");
        if (!enviosPorDiaMap[data]) {
          enviosPorDiaMap[data] = { enviados: 0, pendentes: 0, falhas: 0 };
        }
        if (envio.status === "enviado") {
          enviosPorDiaMap[data].enviados++;
        } else if (envio.status === "enviar" || envio.status === "reenviar" || envio.status === "pendente") {
          enviosPorDiaMap[data].pendentes++;
        } else {
          enviosPorDiaMap[data].falhas++;
        }
      });

      const enviosDiaFormatted = Object.entries(enviosPorDiaMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([data, valores]) => ({
          data: format(parseISO(data), "dd/MM", { locale: ptBR }),
          ...valores
        }));
      
      setEnviosPorDia(enviosDiaFormatted);

      // Envios por campanha
      const enviosPorCampanhaMap: { [key: string]: { total: number; enviados: number; pendentes: number; falhas: number } } = {};
      
      allEnvios.forEach(envio => {
        const campanhaNome = envio.campanhas_disparo?.nome || "Sem campanha";
        if (!enviosPorCampanhaMap[campanhaNome]) {
          enviosPorCampanhaMap[campanhaNome] = { total: 0, enviados: 0, pendentes: 0, falhas: 0 };
        }
        enviosPorCampanhaMap[campanhaNome].total++;
        if (envio.status === "enviado") {
          enviosPorCampanhaMap[campanhaNome].enviados++;
        } else if (envio.status === "enviar" || envio.status === "reenviar" || envio.status === "pendente") {
          enviosPorCampanhaMap[campanhaNome].pendentes++;
        } else {
          enviosPorCampanhaMap[campanhaNome].falhas++;
        }
      });

      const enviosCampanhaFormatted = Object.entries(enviosPorCampanhaMap)
        .map(([campanha, valores]) => ({ campanha, ...valores }))
        .sort((a, b) => b.total - a.total);
      
      setEnviosPorCampanha(enviosCampanhaFormatted);

      // Envios por especialidade
      const enviosPorEspMap: { [key: string]: { total: number; enviados: number } } = {};
      
      allEnvios.forEach(envio => {
        const esp = envio.leads?.especialidade || "Sem especialidade";
        if (!enviosPorEspMap[esp]) {
          enviosPorEspMap[esp] = { total: 0, enviados: 0 };
        }
        enviosPorEspMap[esp].total++;
        if (envio.status === "enviado") {
          enviosPorEspMap[esp].enviados++;
        }
      });

      const enviosEspFormatted = Object.entries(enviosPorEspMap)
        .map(([especialidade, valores]) => ({ especialidade, ...valores }))
        .sort((a, b) => b.total - a.total);
      
      setEnviosPorEspecialidade(enviosEspFormatted);

      // Resumo mensal (últimos 6 meses)
      const enviosPorMesMap: { [key: string]: { total: number; enviados: number; pendentes: number; falhas: number } } = {};
      
      allEnvios.forEach(envio => {
        const mes = format(parseISO(envio.created_at), "yyyy-MM");
        if (!enviosPorMesMap[mes]) {
          enviosPorMesMap[mes] = { total: 0, enviados: 0, pendentes: 0, falhas: 0 };
        }
        enviosPorMesMap[mes].total++;
        if (envio.status === "enviado") {
          enviosPorMesMap[mes].enviados++;
        } else if (envio.status === "enviar" || envio.status === "reenviar" || envio.status === "pendente") {
          enviosPorMesMap[mes].pendentes++;
        } else {
          enviosPorMesMap[mes].falhas++;
        }
      });

      const resumoMensalFormatted = Object.entries(enviosPorMesMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([mes, valores]) => ({
          mes: format(parseISO(`${mes}-01`), "MMM/yy", { locale: ptBR }),
          ...valores
        }));
      
      setResumoMensal(resumoMensalFormatted);

      // === ENVIOS POR TIPO DE LEAD ===
      // Buscar cores dos tipos de lead
      const { data: tiposLead } = await supabase
        .from("tipos_lead")
        .select("nome, cor");
      
      const tiposCoresMap: { [key: string]: string } = {};
      tiposLead?.forEach(t => {
        tiposCoresMap[t.nome] = t.cor;
      });

      const enviosPorTipoMap: { [key: string]: { total: number; enviados: number; pendentes: number; falhas: number } } = {};
      
      allEnvios.forEach(envio => {
        const tipo = envio.leads?.tipo_lead || "Sem tipo";
        if (!enviosPorTipoMap[tipo]) {
          enviosPorTipoMap[tipo] = { total: 0, enviados: 0, pendentes: 0, falhas: 0 };
        }
        enviosPorTipoMap[tipo].total++;
        if (envio.status === "enviado") {
          enviosPorTipoMap[tipo].enviados++;
        } else if (envio.status === "enviar" || envio.status === "reenviar" || envio.status === "pendente") {
          enviosPorTipoMap[tipo].pendentes++;
        } else {
          enviosPorTipoMap[tipo].falhas++;
        }
      });

      const enviosTipoFormatted = Object.entries(enviosPorTipoMap)
        .map(([tipo, valores]) => ({ 
          tipo, 
          cor: tiposCoresMap[tipo] || "#6366F1",
          ...valores 
        }))
        .sort((a, b) => b.total - a.total);
      
      setEnviosPorTipo(enviosTipoFormatted);

      // === TAXA DE CONVERSÃO ===
      // Buscar respostas recebidas dos contatos após os disparos
      const telefonesEnviados = allEnvios
        .filter(e => e.status === "enviado" && e.enviado_em)
        .map(e => ({
          telefone: e.telefone.replace(/\D/g, ""),
          telefoneNormalizado: normalizarTelefone(e.telefone),
          enviadoEm: e.enviado_em,
          campanha: e.campanhas_disparo?.nome || "Sem campanha"
        }));

      // Buscar mensagens recebidas (from_me = false) dos contatos
      // Usar tanto o telefone original quanto variações com/sem 9
      const telefonesSet = new Set(telefonesEnviados.map(t => t.telefone));
      const telefonesNormalizadosSet = new Set(telefonesEnviados.map(t => t.telefoneNormalizado));
      const telefonesArray = Array.from(telefonesSet);
      
      let respostasRecebidas: { phone: string; phoneNormalizado: string; created_at: string }[] = [];
      
      if (telefonesArray.length > 0) {
        const PAGE_SIZE_MSG = 1000;

        // 1. Buscar respostas via tabela messages com JOIN em contacts para pegar o phone
        // Isso resolve o problema de JIDs @lid que não contêm o telefone
        let allMensagensEvolution: any[] = [];
        
        for (let from = 0; from < 100000; from += PAGE_SIZE_MSG) {
          const { data: mensagens, error } = await supabase
            .from("messages")
            .select("created_at, from_me, contacts!inner(phone)")
            .eq("from_me", false)
            .gte("created_at", dataInicio)
            .range(from, from + PAGE_SIZE_MSG - 1);
          
          if (error) break;
          allMensagensEvolution.push(...(mensagens || []));
          if ((mensagens || []).length < PAGE_SIZE_MSG) break;
        }

        // Adicionar respostas da tabela messages usando o phone do contact
        allMensagensEvolution.forEach(m => {
          const phone = (m.contacts as any)?.phone?.replace(/\D/g, "") || "";
          if (phone) {
            respostasRecebidas.push({
              phone,
              phoneNormalizado: normalizarTelefone(phone),
              created_at: m.created_at
            });
          }
        });

        // 2. Buscar na tabela mensagens (SDR Zap) as respostas do contato
        let allMensagensSDR: any[] = [];
        
        for (let from = 0; from < 100000; from += PAGE_SIZE_MSG) {
          const { data: mensagens, error } = await supabase
            .from("mensagens")
            .select("created_at, remetente, conversas!inner(numero_contato)")
            .eq("remetente", "contato")
            .gte("created_at", dataInicio)
            .range(from, from + PAGE_SIZE_MSG - 1);
          
          if (error) break;
          allMensagensSDR.push(...(mensagens || []));
          if ((mensagens || []).length < PAGE_SIZE_MSG) break;
        }

        // Adicionar respostas da tabela mensagens (SDR Zap)
        allMensagensSDR.forEach(m => {
          const phone = (m.conversas as any)?.numero_contato?.replace(/\D/g, "") || "";
          if (phone) {
            respostasRecebidas.push({
              phone,
              phoneNormalizado: normalizarTelefone(phone),
              created_at: m.created_at
            });
          }
        });

        // 3. Buscar também conversas que tiveram interação após o disparo
        // Isso pega casos onde a mensagem pode não estar na tabela mensagens
        let allConversas: any[] = [];
        
        for (let from = 0; from < 100000; from += PAGE_SIZE_MSG) {
          const { data: conversas, error } = await supabase
            .from("conversas")
            .select("numero_contato, ultima_interacao")
            .gte("ultima_interacao", dataInicio)
            .range(from, from + PAGE_SIZE_MSG - 1);
          
          if (error) break;
          allConversas.push(...(conversas || []));
          if ((conversas || []).length < PAGE_SIZE_MSG) break;
        }

        // Adicionar conversas como potenciais respostas
        allConversas.forEach(c => {
          const phone = c.numero_contato?.replace(/\D/g, "") || "";
          if (phone && c.ultima_interacao) {
            respostasRecebidas.push({
              phone,
              phoneNormalizado: normalizarTelefone(phone),
              created_at: c.ultima_interacao
            });
          }
        });
      }

      // Mapear quais telefones responderam usando comparação normalizada
      const telefonesQueResponderam = new Set<string>();
      
      telefonesEnviados.forEach(envio => {
        const resposta = respostasRecebidas.find(r => 
          (r.phone === envio.telefone || r.phoneNormalizado === envio.telefoneNormalizado) && 
          new Date(r.created_at) > new Date(envio.enviadoEm)
        );
        if (resposta) {
          telefonesQueResponderam.add(envio.telefone);
        }
      });

      const totalResponderam = telefonesQueResponderam.size;
      const totalEnviadosUnicos = telefonesSet.size;
      const taxaConversaoGeral = totalEnviadosUnicos > 0 
        ? Math.round((totalResponderam / totalEnviadosUnicos) * 100) 
        : 0;

      setTotais(prev => ({
        ...prev,
        responderam: totalResponderam,
        taxaConversao: taxaConversaoGeral
      }));

      // Conversão por campanha
      const conversaoPorCampanha: { [key: string]: { enviados: Set<string>; responderam: Set<string> } } = {};
      
      telefonesEnviados.forEach(envio => {
        if (!conversaoPorCampanha[envio.campanha]) {
          conversaoPorCampanha[envio.campanha] = { enviados: new Set(), responderam: new Set() };
        }
        conversaoPorCampanha[envio.campanha].enviados.add(envio.telefone);
        
        const resposta = respostasRecebidas.find(r => 
          (r.phone === envio.telefone || r.phoneNormalizado === envio.telefoneNormalizado) && 
          new Date(r.created_at) > new Date(envio.enviadoEm)
        );
        if (resposta) {
          conversaoPorCampanha[envio.campanha].responderam.add(envio.telefone);
        }
      });

      const conversaoFormatted = Object.entries(conversaoPorCampanha)
        .map(([campanha, dados]) => ({
          campanha,
          enviados: dados.enviados.size,
          responderam: dados.responderam.size,
          taxaConversao: dados.enviados.size > 0 
            ? Math.round((dados.responderam.size / dados.enviados.size) * 100) 
            : 0
        }))
        .sort((a, b) => b.taxaConversao - a.taxaConversao);

      setConversaoData(conversaoFormatted);

    } catch (error) {
      console.error("Erro ao carregar relatórios:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTarefasRelatorio = async () => {
    try {
      const diasAtras = parseInt(selectedPeriodo);
      const dataInicio = subDays(new Date(), diasAtras).toISOString();

      // Buscar coluna Finalizada
      const { data: finCol } = await supabase
        .from("task_flow_columns")
        .select("id")
        .eq("nome", "Finalizada")
        .single();

      const finalizadaId = finCol?.id;

      // Buscar tarefas criadas no período
      const { data: tarefasCriadas } = await supabase
        .from("task_flow_tasks")
        .select("id, prazo, column_id, created_at, updated_at, responsavel_id, task_flow_profiles!task_flow_tasks_responsavel_id_fkey(nome, cor)")
        .is("deleted_at", null)
        .gte("created_at", dataInicio);

      // Buscar tarefas finalizadas no período
      const { data: tarefasFinalizadas } = await supabase
        .from("task_flow_tasks")
        .select("id, prazo, column_id, created_at, updated_at, responsavel_id, task_flow_profiles!task_flow_tasks_responsavel_id_fkey(nome, cor)")
        .is("deleted_at", null)
        .eq("column_id", finalizadaId || "")
        .gte("updated_at", dataInicio);

      const criadas = tarefasCriadas || [];
      const finalizadas = tarefasFinalizadas || [];

      // Tarefas atrasadas (prazo passado, não finalizadas)
      const { data: tarefasAtrasadas } = await supabase
        .from("task_flow_tasks")
        .select("id, prazo, column_id, responsavel_id, task_flow_profiles!task_flow_tasks_responsavel_id_fkey(nome, cor)")
        .is("deleted_at", null)
        .not("column_id", "eq", finalizadaId || "")
        .not("prazo", "is", null)
        .lt("prazo", new Date().toISOString());

      const atrasadas = tarefasAtrasadas || [];

      // Em andamento
      const { count: emAndamentoCount } = await supabase
        .from("task_flow_tasks")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .not("column_id", "eq", finalizadaId || "");

      setTotaisTarefas({
        criadas: criadas.length,
        finalizadas: finalizadas.length,
        atrasadas: atrasadas.length,
        emAndamento: emAndamentoCount || 0,
      });

      // Tarefas por dia
      const criadasPorDiaMap: { [key: string]: number } = {};
      criadas.forEach(t => {
        const dia = format(parseISO(t.created_at), "yyyy-MM-dd");
        criadasPorDiaMap[dia] = (criadasPorDiaMap[dia] || 0) + 1;
      });

      const finalizadasPorDiaMap: { [key: string]: number } = {};
      finalizadas.forEach(t => {
        const dia = format(parseISO(t.updated_at), "yyyy-MM-dd");
        finalizadasPorDiaMap[dia] = (finalizadasPorDiaMap[dia] || 0) + 1;
      });

      const todosDias = new Set([...Object.keys(criadasPorDiaMap), ...Object.keys(finalizadasPorDiaMap)]);
      const tarefasDia: TarefasPorDia[] = Array.from(todosDias)
        .sort()
        .map(dia => ({
          data: format(parseISO(dia), "dd/MM", { locale: ptBR }),
          criadas: criadasPorDiaMap[dia] || 0,
          finalizadas: finalizadasPorDiaMap[dia] || 0,
          atrasadas: 0,
        }));

      setTarefasPorDia(tarefasDia);

      // Por perfil
      const perfilMap: { [key: string]: TarefasPorPerfil } = {};

      const getPerfilInfo = (t: any) => {
        const perfil = t.task_flow_profiles;
        return { nome: perfil?.nome || "Sem responsável", cor: perfil?.cor || "#6B7280" };
      };

      criadas.forEach(t => {
        const { nome, cor } = getPerfilInfo(t);
        if (!perfilMap[nome]) perfilMap[nome] = { perfil: nome, cor, criadas: 0, finalizadas: 0, atrasadas: 0 };
        perfilMap[nome].criadas++;
      });

      finalizadas.forEach(t => {
        const { nome, cor } = getPerfilInfo(t);
        if (!perfilMap[nome]) perfilMap[nome] = { perfil: nome, cor, criadas: 0, finalizadas: 0, atrasadas: 0 };
        perfilMap[nome].finalizadas++;
      });

      atrasadas.forEach(t => {
        const { nome, cor } = getPerfilInfo(t);
        if (!perfilMap[nome]) perfilMap[nome] = { perfil: nome, cor, criadas: 0, finalizadas: 0, atrasadas: 0 };
        perfilMap[nome].atrasadas++;
      });

      setTarefasPorPerfil(Object.values(perfilMap).sort((a, b) => b.finalizadas - a.finalizadas));
    } catch (error) {
      console.error("Erro ao carregar relatório de tarefas:", error);
    }
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold text-foreground">Relatórios de Disparos</h1>
            <p className="text-muted-foreground">Métricas e análises de campanhas</p>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs mb-1 block">Campanha</Label>
              <Select value={selectedCampanha} onValueChange={setSelectedCampanha}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas as campanhas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todas as campanhas</SelectItem>
                  {campanhas.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-[180px]">
              <Label className="text-xs mb-1 block">Período</Label>
              <Select value={selectedPeriodo} onValueChange={setSelectedPeriodo}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Últimos 7 dias</SelectItem>
                  <SelectItem value="30">Últimos 30 dias</SelectItem>
                  <SelectItem value="60">Últimos 60 dias</SelectItem>
                  <SelectItem value="90">Últimos 90 dias</SelectItem>
                  <SelectItem value="180">Últimos 6 meses</SelectItem>
                  <SelectItem value="365">Último ano</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total para Disparo</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totais.totalEnvios.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Leads selecionados</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Enviados</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{totais.enviados.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Mensagens entregues</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pendentes</CardTitle>
            <Send className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{totais.pendentes.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Aguardando envio</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Falhas</CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{totais.falhas.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Números inválidos</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Taxa de Sucesso</CardTitle>
            <TrendingUp className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totais.taxaSucesso}%</div>
            <p className="text-xs text-muted-foreground">Enviados / Total</p>
          </CardContent>
        </Card>

        <Card className="md:col-span-2 lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Taxa de Resposta</CardTitle>
            <MessageCircle className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{totais.taxaConversao}%</div>
            <p className="text-xs text-muted-foreground">{totais.responderam} responderam</p>
          </CardContent>
        </Card>
      </div>

      {/* Gráficos em Tabs */}
      <Tabs defaultValue="diario" className="space-y-4">
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          <TabsList className="inline-flex w-auto min-w-max md:grid md:w-full md:grid-cols-7 gap-1">
            <TabsTrigger value="diario" className="whitespace-nowrap">Por Dia</TabsTrigger>
            <TabsTrigger value="campanha" className="whitespace-nowrap">Por Campanha</TabsTrigger>
            <TabsTrigger value="tipo" className="whitespace-nowrap">Por Tipo</TabsTrigger>
            <TabsTrigger value="especialidade" className="whitespace-nowrap">Especialidade</TabsTrigger>
            <TabsTrigger value="mensal" className="whitespace-nowrap">Por Mês</TabsTrigger>
            <TabsTrigger value="conversao" className="whitespace-nowrap">Respondidos</TabsTrigger>
            <TabsTrigger value="tarefas" className="whitespace-nowrap flex items-center gap-1">
              <ListTodo className="h-3.5 w-3.5" />
              Tarefas
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Envios por Dia */}
        <TabsContent value="diario">
          <Card>
            <CardHeader>
              <CardTitle>Envios por Dia</CardTitle>
              <CardDescription>Volume diário de disparos no período selecionado</CardDescription>
            </CardHeader>
            <CardContent className="px-2 md:px-6">
              {enviosPorDia.length > 0 ? (
                <div className="overflow-x-auto -mx-2 md:mx-0">
                  <div className="min-w-[400px] md:min-w-0">
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={enviosPorDia}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="data" className="text-xs" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} width={35} />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: "hsl(var(--popover))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "var(--radius)"
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="enviados" name="Enviados" fill="#10B981" stackId="a" />
                        <Bar dataKey="pendentes" name="Pendentes" fill="#F59E0B" stackId="a" />
                        <Bar dataKey="falhas" name="Falhas" fill="#EF4444" stackId="a" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                  Sem dados disponíveis para o período
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Envios por Campanha */}
        <TabsContent value="campanha">
          <Card>
            <CardHeader>
              <CardTitle>Envios por Campanha</CardTitle>
              <CardDescription>Distribuição de disparos por campanha</CardDescription>
            </CardHeader>
            <CardContent>
              {enviosPorCampanha.length > 0 ? (
                <div className="grid md:grid-cols-2 gap-6">
                  <ResponsiveContainer width="100%" height={400}>
                    <BarChart data={enviosPorCampanha} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" />
                      <YAxis dataKey="campanha" type="category" width={150} className="text-xs" />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "var(--radius)"
                        }}
                      />
                      <Legend />
                      <Bar dataKey="enviados" name="Enviados" fill="#10B981" stackId="a" />
                      <Bar dataKey="pendentes" name="Pendentes" fill="#F59E0B" stackId="a" />
                      <Bar dataKey="falhas" name="Falhas" fill="#EF4444" stackId="a" />
                    </BarChart>
                  </ResponsiveContainer>
                  
                  <div className="space-y-2">
                    <h4 className="font-medium mb-4">Detalhamento por Campanha</h4>
                    <div className="space-y-3 max-h-[360px] overflow-y-auto">
                      {enviosPorCampanha.map((camp, idx) => (
                        <div key={idx} className="p-3 bg-muted/50 rounded-lg">
                          <div className="font-medium text-sm mb-2">{camp.campanha}</div>
                          <div className="grid grid-cols-4 gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">Total:</span>
                              <span className="font-medium ml-1">{camp.total}</span>
                            </div>
                            <div>
                              <span className="text-green-600">Enviados:</span>
                              <span className="font-medium ml-1">{camp.enviados}</span>
                            </div>
                            <div>
                              <span className="text-yellow-600">Pendentes:</span>
                              <span className="font-medium ml-1">{camp.pendentes}</span>
                            </div>
                            <div>
                              <span className="text-red-600">Falhas:</span>
                              <span className="font-medium ml-1">{camp.falhas}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-[400px] text-muted-foreground">
                  Sem dados disponíveis para o período
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Envios por Tipo de Lead */}
        <TabsContent value="tipo">
          <Card>
            <CardHeader>
              <CardTitle>Envios por Tipo de Lead</CardTitle>
              <CardDescription>Distribuição de disparos por tipo (médico, paciente, etc.)</CardDescription>
            </CardHeader>
            <CardContent>
              {enviosPorTipo.length > 0 ? (
                <div className="grid md:grid-cols-2 gap-6">
                  <ResponsiveContainer width="100%" height={400}>
                    <BarChart data={enviosPorTipo} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" />
                      <YAxis dataKey="tipo" type="category" width={120} className="text-xs" />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "var(--radius)"
                        }}
                      />
                      <Legend />
                      <Bar dataKey="enviados" name="Enviados" fill="#10B981" stackId="a" />
                      <Bar dataKey="pendentes" name="Pendentes" fill="#F59E0B" stackId="a" />
                      <Bar dataKey="falhas" name="Falhas" fill="#EF4444" stackId="a" />
                    </BarChart>
                  </ResponsiveContainer>
                  
                  <div className="space-y-2">
                    <h4 className="font-medium mb-4">Detalhamento por Tipo</h4>
                    <div className="space-y-3 max-h-[360px] overflow-y-auto">
                      {enviosPorTipo.map((tipo, idx) => (
                        <div key={idx} className="p-3 bg-muted/50 rounded-lg">
                          <div className="flex items-center gap-2 mb-2">
                            <div 
                              className="w-3 h-3 rounded-full" 
                              style={{ backgroundColor: tipo.cor }}
                            />
                            <span className="font-medium text-sm">{tipo.tipo}</span>
                          </div>
                          <div className="grid grid-cols-4 gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">Total:</span>
                              <span className="font-medium ml-1">{tipo.total}</span>
                            </div>
                            <div>
                              <span className="text-green-600">Enviados:</span>
                              <span className="font-medium ml-1">{tipo.enviados}</span>
                            </div>
                            <div>
                              <span className="text-yellow-600">Pendentes:</span>
                              <span className="font-medium ml-1">{tipo.pendentes}</span>
                            </div>
                            <div>
                              <span className="text-red-600">Falhas:</span>
                              <span className="font-medium ml-1">{tipo.falhas}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-[400px] text-muted-foreground">
                  Sem dados disponíveis para o período
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Envios por Especialidade */}
        <TabsContent value="especialidade">
          <Card>
            <CardHeader>
              <CardTitle>Envios por Especialidade</CardTitle>
              <CardDescription>Distribuição de disparos por especialidade médica</CardDescription>
            </CardHeader>
            <CardContent>
              {enviosPorEspecialidade.length > 0 ? (
                <div className="grid md:grid-cols-2 gap-6">
                  <ResponsiveContainer width="100%" height={400}>
                    <PieChart>
                      <Pie
                        data={enviosPorEspecialidade}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ especialidade, percent }) =>
                          percent > 0.05 ? `${especialidade}: ${(percent * 100).toFixed(0)}%` : ""
                        }
                        outerRadius={150}
                        fill="#8884d8"
                        dataKey="total"
                      >
                        {enviosPorEspecialidade.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "var(--radius)"
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  
                  <div className="space-y-2">
                    <h4 className="font-medium mb-4">Detalhamento por Especialidade</h4>
                    <div className="space-y-2 max-h-[360px] overflow-y-auto">
                      {enviosPorEspecialidade.map((esp, idx) => (
                        <div key={idx} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                          <div className="flex items-center gap-2">
                            <div 
                              className="w-3 h-3 rounded-full" 
                              style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                            />
                            <span className="text-sm">{esp.especialidade}</span>
                          </div>
                          <div className="text-sm">
                            <span className="font-medium">{esp.total}</span>
                            <span className="text-muted-foreground ml-2">
                              ({esp.enviados} enviados)
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-[400px] text-muted-foreground">
                  Sem dados disponíveis para o período
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Resumo Mensal */}
        <TabsContent value="mensal">
          <Card>
            <CardHeader>
              <CardTitle>Evolução Mensal</CardTitle>
              <CardDescription>Total de envios por mês</CardDescription>
            </CardHeader>
            <CardContent>
              {resumoMensal.length > 0 ? (
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart data={resumoMensal}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="mes" className="text-xs" />
                    <YAxis />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "var(--radius)"
                      }}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="total" name="Total" stroke="hsl(var(--primary))" strokeWidth={2} />
                    <Line type="monotone" dataKey="enviados" name="Enviados" stroke="#10B981" strokeWidth={2} />
                    <Line type="monotone" dataKey="pendentes" name="Pendentes" stroke="#F59E0B" strokeWidth={2} />
                    <Line type="monotone" dataKey="falhas" name="Falhas" stroke="#EF4444" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[400px] text-muted-foreground">
                  Sem dados disponíveis para o período
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Taxa de Resposta */}
        <TabsContent value="conversao">
          <Card>
            <CardHeader>
              <CardTitle>Taxa de Resposta por Campanha</CardTitle>
              <CardDescription>Percentual de contatos que responderam após receberem o disparo</CardDescription>
            </CardHeader>
            <CardContent className="px-2 md:px-6">
              {conversaoData.length > 0 ? (
                <div className="flex flex-col gap-6">
                  {/* Mobile: apenas lista de cards */}
                  <div className="md:hidden space-y-2">
                    <h4 className="font-medium mb-3 px-1">Detalhamento por Campanha</h4>
                    <div className="space-y-3 max-h-[500px] overflow-y-auto">
                      {conversaoData.map((conv, idx) => (
                        <div key={idx} className="p-3 bg-muted/50 rounded-lg">
                          <div className="font-medium text-sm mb-2 break-words">{conv.campanha}</div>
                          <div className="grid grid-cols-3 gap-1 text-xs">
                            <div className="flex flex-col">
                              <span className="text-muted-foreground">Enviados</span>
                              <span className="font-medium">{conv.enviados}</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-blue-600">Responderam</span>
                              <span className="font-medium">{conv.responderam}</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-green-600">Taxa</span>
                              <span className="font-medium">{conv.taxaConversao}%</span>
                            </div>
                          </div>
                          <div className="mt-2 w-full bg-muted rounded-full h-2">
                            <div 
                              className="bg-blue-500 h-2 rounded-full transition-all" 
                              style={{ width: `${conv.taxaConversao}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  {/* Desktop: Grid com gráfico e lista */}
                  <div className="hidden md:grid md:grid-cols-2 gap-6">
                    <ResponsiveContainer width="100%" height={400}>
                      <BarChart data={conversaoData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                        <YAxis dataKey="campanha" type="category" width={150} className="text-xs" />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: "hsl(var(--popover))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "var(--radius)"
                          }}
                          formatter={(value: number) => [`${value}%`, "Taxa de Resposta"]}
                        />
                        <Bar dataKey="taxaConversao" name="Taxa de Resposta" fill="#3B82F6" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                    
                    <div className="space-y-2">
                      <h4 className="font-medium mb-4">Detalhamento por Campanha</h4>
                      <div className="space-y-3 max-h-[360px] overflow-y-auto">
                        {conversaoData.map((conv, idx) => (
                          <div key={idx} className="p-3 bg-muted/50 rounded-lg">
                            <div className="font-medium text-sm mb-2">{conv.campanha}</div>
                            <div className="grid grid-cols-3 gap-2 text-xs">
                              <div>
                                <span className="text-muted-foreground">Enviados:</span>
                                <span className="font-medium ml-1">{conv.enviados}</span>
                              </div>
                              <div>
                                <span className="text-blue-600">Responderam:</span>
                                <span className="font-medium ml-1">{conv.responderam}</span>
                              </div>
                              <div>
                                <span className="text-green-600">Resposta:</span>
                                <span className="font-medium ml-1">{conv.taxaConversao}%</span>
                              </div>
                            </div>
                            <div className="mt-2 w-full bg-muted rounded-full h-2">
                              <div 
                                className="bg-blue-500 h-2 rounded-full transition-all" 
                                style={{ width: `${conv.taxaConversao}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                  Sem dados de resposta disponíveis para o período
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tarefas */}
        <TabsContent value="tarefas">
          {/* KPIs de Tarefas */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Criadas</CardTitle>
                <PlusCircle className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600">{totaisTarefas.criadas}</div>
                <p className="text-xs text-muted-foreground">no período</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Realizadas</CardTitle>
                <CheckCircle className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{totaisTarefas.finalizadas}</div>
                <p className="text-xs text-muted-foreground">no período</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Atrasadas</CardTitle>
                <AlertCircle className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">{totaisTarefas.atrasadas}</div>
                <p className="text-xs text-muted-foreground">com prazo vencido</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Em Andamento</CardTitle>
                <ListTodo className="h-4 w-4 text-amber-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-600">{totaisTarefas.emAndamento}</div>
                <p className="text-xs text-muted-foreground">não finalizadas</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Gráfico por dia */}
            <Card>
              <CardHeader>
                <CardTitle>Tarefas por Dia</CardTitle>
                <CardDescription>Criadas vs Realizadas no período</CardDescription>
              </CardHeader>
              <CardContent className="px-2 md:px-6">
                {tarefasPorDia.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={tarefasPorDia}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="data" className="text-xs" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} width={30} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "var(--radius)"
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="criadas" name="Criadas" fill="#3B82F6" />
                      <Bar dataKey="finalizadas" name="Realizadas" fill="#10B981" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                    Sem dados de tarefas no período
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Por responsável */}
            <Card>
              <CardHeader>
                <CardTitle>Por Responsável</CardTitle>
                <CardDescription>Desempenho por secretária</CardDescription>
              </CardHeader>
              <CardContent>
                {tarefasPorPerfil.length > 0 ? (
                  <div className="space-y-4 max-h-[340px] overflow-y-auto">
                    {tarefasPorPerfil.map((perfil, idx) => (
                      <div key={idx} className="p-3 bg-muted/50 rounded-lg">
                        <div className="flex items-center gap-2 mb-3">
                          <div
                            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                            style={{ backgroundColor: perfil.cor }}
                          >
                            {perfil.perfil.charAt(0)}
                          </div>
                          <span className="font-medium text-sm">{perfil.perfil}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div className="text-center">
                            <div className="text-blue-600 font-semibold text-lg">{perfil.criadas}</div>
                            <span className="text-muted-foreground">Criadas</span>
                          </div>
                          <div className="text-center">
                            <div className="text-green-600 font-semibold text-lg">{perfil.finalizadas}</div>
                            <span className="text-muted-foreground">Realizadas</span>
                          </div>
                          <div className="text-center">
                            <div className="text-red-600 font-semibold text-lg">{perfil.atrasadas}</div>
                            <span className="text-muted-foreground">Atrasadas</span>
                          </div>
                        </div>
                        {/* Barra de progresso */}
                        {perfil.criadas > 0 && (
                          <div className="mt-2 w-full bg-muted rounded-full h-2">
                            <div
                              className="bg-green-500 h-2 rounded-full transition-all"
                              style={{ width: `${Math.min(100, Math.round((perfil.finalizadas / perfil.criadas) * 100))}%` }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                    Sem dados de tarefas no período
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
