import { describe, it, expect } from "vitest";
import {
  cleanPhoneDigits,
  formatBrazilianPhone,
  isValidBrazilianPhone,
  getFormattedPhoneOrNull,
  formatPhoneForDisplay,
} from "./brazilianPhoneUtils";

describe("cleanPhoneDigits", () => {
  it("remove caracteres não numéricos", () => {
    expect(cleanPhoneDigits("+55 (47) 99999-8888")).toBe("5547999998888");
    expect(cleanPhoneDigits("55-47-999998888")).toBe("5547999998888");
    expect(cleanPhoneDigits("5547999998888")).toBe("5547999998888");
  });

  it("retorna vazio para string vazia", () => {
    expect(cleanPhoneDigits("")).toBe("");
  });
});

describe("formatBrazilianPhone", () => {
  it("valida número correto com 13 dígitos", () => {
    const result = formatBrazilianPhone("5547999998888");
    expect(result.isValid).toBe(true);
    expect(result.formatted).toBe("5547999998888");
  });

  it("valida número com formatação", () => {
    const result = formatBrazilianPhone("+55 (47) 99999-8888");
    expect(result.isValid).toBe(true);
    expect(result.formatted).toBe("5547999998888");
  });

  it("rejeita número vazio", () => {
    const result = formatBrazilianPhone("");
    expect(result.isValid).toBe(false);
    expect(result.error).toBe("Número vazio");
  });

  it("rejeita número sem DDI 55", () => {
    const result = formatBrazilianPhone("4747999998888");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("55");
  });

  it("rejeita número com DDD inválido", () => {
    const result = formatBrazilianPhone("5500999998888");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("DDD inválido");
  });

  it("rejeita número fixo (não começa com 9)", () => {
    const result = formatBrazilianPhone("5547333338888");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("celular");
  });

  it("rejeita número com menos de 13 dígitos", () => {
    const result = formatBrazilianPhone("554799999888");
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("13 dígitos");
  });

  it("rejeita número com mais de 13 dígitos", () => {
    const result = formatBrazilianPhone("55479999988881");
    expect(result.isValid).toBe(false);
  });

  it("aceita DDDs de todas as regiões", () => {
    // SP
    expect(formatBrazilianPhone("5511999998888").isValid).toBe(true);
    // RJ
    expect(formatBrazilianPhone("5521999998888").isValid).toBe(true);
    // SC (Itajaí)
    expect(formatBrazilianPhone("5547999998888").isValid).toBe(true);
    // BA
    expect(formatBrazilianPhone("5571999998888").isValid).toBe(true);
    // AM
    expect(formatBrazilianPhone("5592999998888").isValid).toBe(true);
  });
});

describe("isValidBrazilianPhone", () => {
  it("retorna true para número válido", () => {
    expect(isValidBrazilianPhone("5547999998888")).toBe(true);
  });

  it("retorna false para número inválido", () => {
    expect(isValidBrazilianPhone("123")).toBe(false);
    expect(isValidBrazilianPhone("")).toBe(false);
  });
});

describe("getFormattedPhoneOrNull", () => {
  it("retorna formatado para número válido", () => {
    expect(getFormattedPhoneOrNull("+55 47 99999-8888")).toBe("5547999998888");
  });

  it("retorna null para número inválido", () => {
    expect(getFormattedPhoneOrNull("123")).toBeNull();
  });
});

describe("formatPhoneForDisplay", () => {
  it("formata para exibição legível", () => {
    expect(formatPhoneForDisplay("5547999998888")).toBe("+55 (47) 99999-8888");
  });

  it("retorna original se inválido", () => {
    expect(formatPhoneForDisplay("123")).toBe("123");
  });
});
