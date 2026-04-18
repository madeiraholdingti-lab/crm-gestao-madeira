import { describe, it, expect } from "vitest";

// Replicate the urgency logic from MonitorSecretarias to test independently
const KEYWORDS_URGENTE = ["receita", "dor", "urgente", "emergência", "emergencia", "cirurgia", "sangue", "febre"];

interface ConversaTest {
  ultima_mensagem: string | null;
  ultima_interacao: string | null;
}

function getUrgencia(conversa: ConversaTest): "normal" | "atencao" | "urgente" {
  if (conversa.ultima_mensagem) {
    const msgLower = conversa.ultima_mensagem.toLowerCase();
    if (KEYWORDS_URGENTE.some(kw => msgLower.includes(kw))) {
      return "urgente";
    }
  }

  if (!conversa.ultima_interacao) return "normal";

  const agora = new Date();
  const ultimaInteracao = new Date(conversa.ultima_interacao);
  const horasSemResposta = (agora.getTime() - ultimaInteracao.getTime()) / (1000 * 60 * 60);

  if (horasSemResposta >= 4) return "urgente";
  if (horasSemResposta >= 2) return "atencao";
  return "normal";
}

describe("Urgência de conversa (MonitorSecretarias)", () => {
  it("keyword 'receita' → urgente", () => {
    expect(getUrgencia({ ultima_mensagem: "Preciso de uma receita", ultima_interacao: new Date().toISOString() })).toBe("urgente");
  });

  it("keyword 'dor' → urgente", () => {
    expect(getUrgencia({ ultima_mensagem: "Estou com muita dor no peito", ultima_interacao: new Date().toISOString() })).toBe("urgente");
  });

  it("keyword 'emergência' → urgente", () => {
    expect(getUrgencia({ ultima_mensagem: "É emergência!", ultima_interacao: new Date().toISOString() })).toBe("urgente");
  });

  it("keyword 'cirurgia' → urgente", () => {
    expect(getUrgencia({ ultima_mensagem: "Quando vai ser a cirurgia?", ultima_interacao: new Date().toISOString() })).toBe("urgente");
  });

  it("mensagem normal recente → normal", () => {
    expect(getUrgencia({ ultima_mensagem: "Bom dia, tudo bem?", ultima_interacao: new Date().toISOString() })).toBe("normal");
  });

  it("sem resposta há 2h → atenção", () => {
    const doisHorasAtras = new Date(Date.now() - 2.5 * 60 * 60 * 1000).toISOString();
    expect(getUrgencia({ ultima_mensagem: "Olá", ultima_interacao: doisHorasAtras })).toBe("atencao");
  });

  it("sem resposta há 4h+ → urgente", () => {
    const quatroHorasAtras = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    expect(getUrgencia({ ultima_mensagem: "Olá", ultima_interacao: quatroHorasAtras })).toBe("urgente");
  });

  it("sem interação → normal", () => {
    expect(getUrgencia({ ultima_mensagem: null, ultima_interacao: null })).toBe("normal");
  });

  it("keyword tem prioridade sobre tempo", () => {
    // Mesmo com interação recente, keyword urgente prevalece
    expect(getUrgencia({ ultima_mensagem: "Preciso de receita urgente", ultima_interacao: new Date().toISOString() })).toBe("urgente");
  });
});
