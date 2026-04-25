// processar-campanha-v2
// Engine de disparo genérico (prospecção / evento / reativação / divulgação / pós-op).
// Baseado no campanha-disparo-processor do sigma-new, adaptado pras tabelas
// do Maikonect e simplificado pro caso-de-uso do Dr. Maikon.
//
// Fluxo:
//  1. Recebe { campanha_id } ou varre campanhas ativas (modo cron)
//  2. Lock atômico via proximo_envio_em
//  3. Valida horário comercial + dia da semana + limite diário
//  4. Pega N leads pendentes da campanha
//  5. Pra cada lead: resolve spintax, normaliza fone, envia via Evolution
//     com rotação de chips + fallback
//  6. Registra em campanha_envios + atualiza contadores
//  7. Se sobrou lead, agenda próximo lote e self-invoke
//
// Tabelas: campanhas_disparo, campanha_envios, leads, instancias_whatsapp, config_global
// Status campanha_envios: 'pendente' → 'enviado' | 'erro' | 'NoZap'

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_EXECUTION_MS = 50_000;
const SEND_TIMEOUT_MS = 15_000;
const LOCK_DURATION_S = 90;

interface Instancia {
  id: string;
  nome_instancia: string;
  numero_chip: string | null;
  status: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json().catch(() => ({}));
    const campanha_id: string | undefined = body.campanha_id;
    const modoCron = !campanha_id;

    if (modoCron) {
      // Varre campanhas elegíveis agora
      const now = new Date().toISOString();
      const { data: candidatas } = await supabase
        .from("campanhas_disparo")
        .select("id")
        .eq("ativo", true)
        .in("status", ["ativa", "em_andamento"])
        .or(`proximo_envio_em.is.null,proximo_envio_em.lte.${now}`)
        .limit(5);

      const results: Record<string, unknown>[] = [];
      for (const c of candidatas || []) {
        const r = await processarCampanha(supabase, c.id);
        results.push({ campanha: c.id, ...r });
      }
      return json({ ok: true, modo: "cron", processadas: results.length, results });
    }

    const result = await processarCampanha(supabase, campanha_id!);
    return json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[campanha-v2] ERRO:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function processarCampanha(supabase: any, campanha_id: string): Promise<Record<string, unknown>> {
  // ── Buscar campanha ──
  const { data: camp, error: campErr } = await supabase
    .from("campanhas_disparo")
    .select("*")
    .eq("id", campanha_id)
    .single();

  if (campErr || !camp) return { ok: false, error: "Campanha não encontrada" };
  if (!camp.ativo) return { ok: true, msg: "Campanha desativada (ativo=false)" };
  if (["pausada", "finalizada", "arquivada", "cancelada"].includes(camp.status)) {
    return { ok: true, msg: `Campanha ${camp.status}` };
  }
  if (!["ativa", "em_andamento", "rascunho"].includes(camp.status)) {
    return { ok: true, msg: `Status incompatível: ${camp.status}` };
  }

  // ── Janela horário + dia da semana ──
  if (!dentroDaJanela(camp)) {
    return { ok: true, msg: "Fora da janela horário/dia", dentro: false };
  }

  // ── Lock atômico via proximo_envio_em ──
  if (camp.proximo_envio_em) {
    const nextTime = new Date(camp.proximo_envio_em).getTime();
    if (nextTime > Date.now()) {
      return { ok: true, msg: "Aguardando próximo lote", agendado: camp.proximo_envio_em };
    }
  }

  const lockUntil = new Date(Date.now() + LOCK_DURATION_S * 1000).toISOString();
  // Try lock: se proximo_envio_em é null OU está no passado
  const { data: lockResult } = await supabase
    .from("campanhas_disparo")
    .update({ proximo_envio_em: lockUntil })
    .eq("id", campanha_id)
    .or(`proximo_envio_em.is.null,proximo_envio_em.lte.${new Date().toISOString()}`)
    .select("id");

  if (!lockResult || lockResult.length === 0) {
    return { ok: true, msg: "Outro processo rodando" };
  }

  // ── Config ──
  const batchSize = 10; // leads por execução
  const delayMinMs = ((camp.intervalo_min_minutos || 1) * 60 * 1000) / 10; // converte min → sec (dividido por 10 pra ser mais agressivo)
  const delayMaxMs = ((camp.intervalo_max_minutos || 2) * 60 * 1000) / 10;
  const delayBatchMinMs = 5 * 60 * 1000;
  const delayBatchMaxMs = 10 * 60 * 1000;
  const limiteDiario = camp.envios_por_dia || 120;

  // ── Chips disponíveis ──
  const chipIds: string[] = camp.chip_ids || (camp.instancia_id ? [camp.instancia_id] : []);
  if (chipIds.length === 0) {
    await limparLock(supabase, campanha_id);
    return { ok: false, error: "Nenhum chip configurado na campanha" };
  }

  const { data: chipsRaw } = await supabase
    .from("instancias_whatsapp")
    .select("id, nome_instancia, numero_chip, status")
    .in("id", chipIds)
    .in("status", ["conectada", "ativa", "open"]);

  const chipsDisponiveis = (chipsRaw || []) as Instancia[];
  if (chipsDisponiveis.length === 0) {
    await limparLock(supabase, campanha_id);
    return { ok: false, error: "Nenhum chip conectado" };
  }

  // ── Evolution API config ──
  const { data: evoConfig } = await supabase
    .from("config_global")
    .select("evolution_base_url, evolution_api_key")
    .limit(1)
    .single();

  const evoUrl = (evoConfig?.evolution_base_url as string | undefined)?.replace(/\/+$/, "");
  const evoKey = evoConfig?.evolution_api_key as string | undefined;
  if (!evoUrl || !evoKey) {
    await limparLock(supabase, campanha_id);
    return { ok: false, error: "Evolution API não configurada" };
  }

  // ── Limite diário ──
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const { count: enviadosHoje } = await supabase
    .from("campanha_envios")
    .select("id", { count: "exact", head: true })
    .eq("campanha_id", campanha_id)
    .eq("status", "enviado")
    .gte("enviado_em", hoje.toISOString());

  if ((enviadosHoje || 0) >= limiteDiario) {
    await limparLock(supabase, campanha_id);
    console.log(`[campanha-v2] Limite diário atingido: ${enviadosHoje}/${limiteDiario}`);
    return { ok: true, msg: "Limite diário atingido", enviados: enviadosHoje };
  }

  const restante = limiteDiario - (enviadosHoje || 0);
  const lote = Math.min(batchSize, restante);

  // ── Buscar envios pendentes ──
  const { data: pendentes, error: pendErr } = await supabase
    .from("campanha_envios")
    .select("id, lead_id, telefone, lead:lead_id(nome, telefone, tipo_lead, especialidade_id)")
    .eq("campanha_id", campanha_id)
    .eq("status", "pendente")
    .order("created_at", { ascending: true })
    .limit(lote);

  if (pendErr) throw new Error("Erro ao buscar pendentes: " + pendErr.message);

  if (!pendentes || pendentes.length === 0) {
    await limparLock(supabase, campanha_id);
    console.log("[campanha-v2] Sem pendentes");
    return { ok: true, msg: "Sem leads pendentes", enviados: 0 };
  }

  // ── Processar lote ──
  const startTime = Date.now();
  let sent = 0, failed = 0, nozap = 0, chipIndex = 0;
  const chipMetrics: Record<string, { ok: number; err: number }> = {};

  for (let i = 0; i < pendentes.length; i++) {
    const envio = pendentes[i];
    const lead = envio.lead as { nome?: string; telefone?: string } | null;
    const phoneRaw = envio.telefone || lead?.telefone;

    if (!phoneRaw) {
      failed++;
      await supabase.from("campanha_envios")
        .update({ status: "erro", erro: "Sem telefone" })
        .eq("id", envio.id);
      continue;
    }

    if (Date.now() - startTime + SEND_TIMEOUT_MS + 2000 > MAX_EXECUTION_MS) {
      console.log("[campanha-v2] Timeout de execução atingido, deixa pro próximo");
      break;
    }

    // Pause check a cada 5
    if (i > 0 && i % 5 === 0) {
      const { data: curr } = await supabase
        .from("campanhas_disparo")
        .select("status, ativo")
        .eq("id", campanha_id)
        .single();
      if (!curr?.ativo || ["pausada", "finalizada", "cancelada"].includes(curr?.status)) {
        console.log("[campanha-v2] Pausa detectada");
        break;
      }
    }

    // Rotação de chips
    const chipPrimario = chipsDisponiveis[chipIndex % chipsDisponiveis.length];
    chipIndex++;
    const chipsParaTentar = [
      chipPrimario,
      ...chipsDisponiveis.filter((c) => c.id !== chipPrimario.id),
    ];

    // Spintax + template
    // stripDoctorPrefix evita "Olá Dr. Dr. Maikon" quando lead.nome já vem
    // com "Dr./Dra./Dr(a)." salvo (comum em listas de cardiologistas).
    const tplRaw = camp.mensagem || "Olá, {{nome}}!";
    const tplSpintaxed = camp.spintax_ativo !== false ? resolveSpintax(tplRaw) : tplRaw;
    const msgFinal = applyTemplate(tplSpintaxed, {
      nome: stripDoctorPrefix(lead?.nome) || "Dr(a)",
    });

    const phone = normalizeBrazilianPhone(phoneRaw);
    if (!phone) {
      failed++;
      await supabase.from("campanha_envios")
        .update({ status: "erro", erro: "Telefone inválido" })
        .eq("id", envio.id);
      continue;
    }

    // Envio com fallback + log por tentativa
    let success = false;
    let chipUsado: Instancia | null = null;
    let lastError = "";
    let tentativas = 0;
    let isNoZap = false;
    let lastHttpStatus: number | null = null;

    for (const chipTry of chipsParaTentar) {
      tentativas++;
      const t0 = Date.now();
      let tryResult: 'enviado' | 'erro' | 'nozap' = 'erro';
      let tryHttpStatus: number | null = null;
      let tryErro: string | null = null;

      try {
        const endpoint = `${evoUrl}/message/sendText/${encodeURIComponent(chipTry.nome_instancia)}`;
        const resp = await fetchWithTimeout(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: evoKey },
          body: JSON.stringify({ number: phone, text: msgFinal }),
        }, SEND_TIMEOUT_MS);

        tryHttpStatus = resp.status;
        lastHttpStatus = resp.status;

        if (!resp.ok) {
          const errText = await resp.text();
          tryErro = errText.slice(0, 500);
          // Detecta NoZap (número sem WhatsApp)
          if (errText.includes("exists\":false") || errText.includes("not-whatsapp") || resp.status === 400) {
            isNoZap = true;
            tryResult = 'nozap';
            lastError = `NoZap: ${errText.slice(0, 150)}`;
            bumpChip(chipMetrics, chipTry.id, false);
            await logDisparo(supabase, {
              campanha_id, envio_id: envio.id, lead_id: envio.lead_id,
              instancia_id: chipTry.id, telefone: phone, mensagem: msgFinal,
              resultado: tryResult, http_status: tryHttpStatus, erro: tryErro,
              duracao_ms: Date.now() - t0, tentativa: tentativas,
            });
            break;
          }
          throw new Error(`Evolution ${resp.status}: ${errText.slice(0, 200)}`);
        }

        success = true;
        chipUsado = chipTry;
        tryResult = 'enviado';
        bumpChip(chipMetrics, chipTry.id, true);
        await logDisparo(supabase, {
          campanha_id, envio_id: envio.id, lead_id: envio.lead_id,
          instancia_id: chipTry.id, telefone: phone, mensagem: msgFinal,
          resultado: tryResult, http_status: tryHttpStatus, erro: null,
          duracao_ms: Date.now() - t0, tentativa: tentativas,
        });
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        tryErro = lastError.slice(0, 500);
        bumpChip(chipMetrics, chipTry.id, false);
        await logDisparo(supabase, {
          campanha_id, envio_id: envio.id, lead_id: envio.lead_id,
          instancia_id: chipTry.id, telefone: phone, mensagem: msgFinal,
          resultado: 'erro', http_status: tryHttpStatus, erro: tryErro,
          duracao_ms: Date.now() - t0, tentativa: tentativas,
        });
      }
    }
    void lastHttpStatus;

    if (success && chipUsado) {
      sent++;
      await supabase.from("campanha_envios").update({
        status: "enviado",
        enviado_em: new Date().toISOString(),
        tentativas,
        erro: null,
      }).eq("id", envio.id);
      console.log(`[campanha-v2] ✅ ${lead?.nome || phone} via ${chipUsado.nome_instancia}`);
    } else if (isNoZap) {
      nozap++;
      await supabase.from("campanha_envios").update({
        status: "NoZap",
        erro: lastError.slice(0, 400),
        tentativas,
      }).eq("id", envio.id);
    } else {
      failed++;
      await supabase.from("campanha_envios").update({
        status: "erro",
        erro: `Todos ${tentativas} chip(s) falharam: ${lastError.slice(0, 400)}`,
        tentativas,
      }).eq("id", envio.id);
    }

    // Delay entre msgs
    if (i < pendentes.length - 1) {
      await sleep(randomDelay(delayMinMs, delayMaxMs));
    }
  }

  // ── Atualiza contadores da campanha ──
  await supabase.from("campanhas_disparo").update({
    sucesso: (camp.sucesso || 0) + sent,
    falhas: (camp.falhas || 0) + failed,
    enviados: (camp.enviados || 0) + sent + nozap + failed,
  }).eq("id", campanha_id);

  // ── Diagnóstico chips + auto-pause ──
  // Checa taxa de erro global nas últimas 20 msgs do chip (não só essa execução).
  // Se >30% → marca status='suspeito' no DB, tira da rotação automaticamente.
  for (const chipId of Object.keys(chipMetrics)) {
    const { data: ultimas20 } = await supabase
      .from("disparos_logs")
      .select("resultado")
      .eq("instancia_id", chipId)
      .order("created_at", { ascending: false })
      .limit(20);

    const total = ultimas20?.length ?? 0;
    const erros = (ultimas20 || []).filter((l: { resultado: string }) => l.resultado === 'erro').length;
    const taxa = total > 0 ? erros / total : 0;

    if (total >= 10 && taxa >= 0.3) {
      // Atualiza e detecta se mudança ocorreu (pra não notificar 2x o mesmo chip)
      const { data: atualizado } = await supabase
        .from("instancias_whatsapp")
        .update({ status: 'suspeito' })
        .eq("id", chipId)
        .neq("status", 'suspeito')
        .select('id, nome_instancia, numero_chip')
        .maybeSingle();

      if (atualizado) {
        console.warn(`[campanha-v2] 🚨 Chip ${chipId} auto-pausado: ${erros}/${total} erros (${Math.round(taxa*100)}%)`);

        // Cria notificação in-app pros admins
        try {
          const { data: admins } = await supabase
            .from('user_roles')
            .select('user_id')
            .eq('role', 'admin_geral');
          if (admins && admins.length > 0) {
            const nots = admins.map((a: { user_id: string }) => ({
              user_id: a.user_id,
              tipo: 'chip_pausado',
              titulo: `⚠️ Chip ${atualizado.nome_instancia || 'sem nome'} auto-pausado`,
              mensagem: `Taxa de erro de ${Math.round(taxa*100)}% nas últimas ${total} msgs (${erros} erros). Chip ${atualizado.numero_chip || ''} marcado como suspeito. Verifique se não foi banido.`,
              dados: { instancia_id: atualizado.id, taxa_erro: taxa, erros, total },
              lida: false,
            }));
            await supabase.from('notificacoes').insert(nots);
          }
        } catch (notErr) {
          console.warn('[campanha-v2] erro notificação:', notErr);
        }

        // Alerta via WhatsApp pra quem for configurado em config_global.webhook_alerta_chip
        try {
          const { data: conf } = await supabase
            .from('config_global')
            .select('chave, valor')
            .eq('chave', 'telefone_alerta_chip')
            .maybeSingle();
          const alertaPhone = conf?.valor;
          if (alertaPhone) {
            // Usa primeiro chip saudável (não o que caiu) pra mandar
            const { data: chipVivo } = await supabase
              .from('instancias_whatsapp')
              .select('nome_instancia')
              .in('status', ['conectada', 'ativa', 'open'])
              .neq('id', chipId)
              .limit(1)
              .maybeSingle();
            if (chipVivo?.nome_instancia) {
              const evoUrl = Deno.env.get('EVOLUTION_API_URL') || 'https://sdsd-evolution-api.r65ocn.easypanel.host';
              const evoKey = Deno.env.get('EVOLUTION_API_KEY');
              if (evoKey) {
                fetch(`${evoUrl}/message/sendText/${encodeURIComponent(chipVivo.nome_instancia)}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'apikey': evoKey },
                  body: JSON.stringify({
                    number: alertaPhone,
                    text: `🚨 Chip ${atualizado.nome_instancia || 'sem nome'} (${atualizado.numero_chip || ''}) foi auto-pausado.\n\nTaxa de erro: ${Math.round(taxa*100)}% (${erros}/${total} últimas msgs).\n\nVerifica no CRM se foi banido.`
                  })
                }).catch(() => {});
              }
            }
          }
        } catch (waErr) {
          console.warn('[campanha-v2] erro WA alert:', waErr);
        }
      }
    }
  }

  // ── Resta lead? ──
  const { count: remaining } = await supabase
    .from("campanha_envios")
    .select("id", { count: "exact", head: true })
    .eq("campanha_id", campanha_id)
    .eq("status", "pendente");

  if ((remaining || 0) > 0) {
    const { data: latestCamp } = await supabase
      .from("campanhas_disparo")
      .select("status, ativo")
      .eq("id", campanha_id)
      .single();

    if (latestCamp?.ativo && latestCamp.status !== "pausada") {
      const pause = randomDelay(delayBatchMinMs, delayBatchMaxMs);
      const nextAt = new Date(Date.now() + pause).toISOString();
      await supabase.from("campanhas_disparo")
        .update({ proximo_envio_em: nextAt })
        .eq("id", campanha_id);
      console.log(`[campanha-v2] Próximo lote em ${Math.round(pause / 1000)}s`);
    } else {
      await limparLock(supabase, campanha_id);
    }
  } else {
    await limparLock(supabase, campanha_id);
    // Marca como concluída se tinha rodado (foi ativa em algum momento)
    await supabase.from("campanhas_disparo").update({
      status: "finalizada",
      concluido_em: new Date().toISOString(),
    }).eq("id", campanha_id).eq("status", "ativa");
    console.log(`[campanha-v2] Campanha ${campanha_id} concluída`);
  }

  return { ok: true, sent, failed, nozap, remaining: remaining || 0 };
}

// ── Helpers ──

async function limparLock(supabase: any, campanha_id: string) {
  await supabase.from("campanhas_disparo")
    .update({ proximo_envio_em: null })
    .eq("id", campanha_id);
}

function dentroDaJanela(camp: Record<string, unknown>): boolean {
  const hIni = camp.horario_inicio as string | null;
  const hFim = camp.horario_fim as string | null;
  const dias = (camp.dias_semana as number[] | null) || null;

  const now = new Date();
  // Converte pra BRT (UTC-3)
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const diaSemana = brt.getUTCDay(); // 0=domingo
  const horaAgora = brt.getUTCHours() * 60 + brt.getUTCMinutes();

  if (dias && dias.length > 0 && !dias.includes(diaSemana)) return false;

  if (hIni && hFim) {
    const [hi, mi] = hIni.split(":").map(Number);
    const [hf, mf] = hFim.split(":").map(Number);
    const ini = hi * 60 + (mi || 0);
    const fim = hf * 60 + (mf || 0);
    if (horaAgora < ini || horaAgora > fim) return false;
  }
  return true;
}

function json(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function fetchWithTimeout(url: string, opts: RequestInit, timeout: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function bumpChip(m: Record<string, { ok: number; err: number }>, id: string, ok: boolean) {
  if (!m[id]) m[id] = { ok: 0, err: 0 };
  if (ok) m[id].ok++;
  else m[id].err++;
}

function normalizeBrazilianPhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length > 11) digits = digits.slice(2);
  if (digits.length < 10 || digits.length > 11) return null;
  if (digits.length === 10) {
    const d = parseInt(digits[2], 10);
    if (d >= 6) digits = digits.slice(0, 2) + "9" + digits.slice(2);
  }
  return "55" + digits;
}

function resolveSpintax(text: string): string {
  let result = text;
  // Preserva placeholders {{var}}
  const placeholders: string[] = [];
  result = result.replace(/\{\{([^}]+)\}\}/g, (_, name) => {
    const idx = placeholders.length;
    placeholders.push(`{{${name}}}`);
    return `\x00VAR${idx}\x00`;
  });

  // Expande {a|b|c}
  let iter = 0;
  while (result.includes("{") && iter < 50) {
    result = result.replace(/\{([^{}]+)\}/g, (_, group: string) => {
      const options = group.split("|");
      const pick = Math.floor(Math.random() * options.length);
      return options[pick].trim();
    });
    iter++;
  }

  // Restaura placeholders
  result = result.replace(/\x00VAR(\d+)\x00/g, (_, idx) => placeholders[parseInt(idx)]);
  return result.replace(/\n{3,}/g, "\n\n").replace(/ {2,}/g, " ").trim();
}

function applyTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => vars[key] ?? match);
}

// Remove "Dr.", "Dra.", "Dr(a).", "Doutor", etc no início do nome.
// Lista de leads médicos vem com prefixo salvo no campo nome ("Dr. Maikon Madeira"),
// e o template já costuma ter "Olá Dr. {{nome}}" — sem strip dá "Dr. Dr. Maikon".
function stripDoctorPrefix(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .replace(/^\s*(dr\.?\s*\(\s*a\s*\)\.?|dra?\.?|doutor[ae]?)\s+/i, "")
    .trim();
}

async function logDisparo(supabase: any, entry: {
  campanha_id: string; envio_id: string; lead_id: string | null;
  instancia_id: string; telefone: string; mensagem: string;
  resultado: 'enviado' | 'erro' | 'nozap' | 'skip';
  http_status: number | null; erro: string | null;
  duracao_ms: number; tentativa: number;
}) {
  try {
    await supabase.from("disparos_logs").insert({
      campanha_id: entry.campanha_id,
      campanha_envio_id: entry.envio_id,
      lead_id: entry.lead_id,
      instancia_id: entry.instancia_id,
      telefone: entry.telefone,
      mensagem_enviada: entry.mensagem.slice(0, 1000),
      resultado: entry.resultado,
      http_status: entry.http_status,
      erro_texto: entry.erro,
      duracao_ms: entry.duracao_ms,
      tentativa: entry.tentativa,
    });
  } catch (err) {
    // log falhar não pode quebrar envio
    console.warn("[logDisparo] falhou:", err);
  }
}
