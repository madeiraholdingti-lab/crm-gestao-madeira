import { describe, it, expect } from "vitest";
import { PERFIS_PROFISSIONAIS, RELEVANCIAS } from "./constants";

describe("PERFIS_PROFISSIONAIS", () => {
  it("contém 13 perfis profissionais", () => {
    expect(PERFIS_PROFISSIONAIS).toHaveLength(13);
  });

  it("cada perfil tem value e label", () => {
    for (const perfil of PERFIS_PROFISSIONAIS) {
      expect(perfil.value).toBeTruthy();
      expect(perfil.label).toBeTruthy();
    }
  });

  it("não tem values duplicados", () => {
    const values = PERFIS_PROFISSIONAIS.map(p => p.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("contém os perfis essenciais do Dr. Maikon", () => {
    const values = PERFIS_PROFISSIONAIS.map(p => p.value);
    expect(values).toContain("medico");
    expect(values).toContain("cirurgiao_cardiaco");
    expect(values).toContain("paciente");
    expect(values).toContain("paciente_pos_op");
    expect(values).toContain("diretor_hospital");
    expect(values).toContain("anestesista");
  });
});

describe("RELEVANCIAS", () => {
  it("contém alta, media, baixa", () => {
    const values = RELEVANCIAS.map(r => r.value);
    expect(values).toContain("alta");
    expect(values).toContain("media");
    expect(values).toContain("baixa");
  });
});
