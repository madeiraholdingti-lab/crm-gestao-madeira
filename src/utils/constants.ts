export const PERFIS_PROFISSIONAIS = [
  { value: "medico", label: "Médico" },
  { value: "cirurgiao_cardiaco", label: "Cirurgião Cardíaco" },
  { value: "anestesista", label: "Anestesista" },
  { value: "enfermeiro", label: "Enfermeiro" },
  { value: "tecnico_enfermagem", label: "Técnico de Enfermagem" },
  { value: "diretor_hospital", label: "Diretor de Hospital" },
  { value: "gestor_saude", label: "Gestor de Saúde" },
  { value: "administrativo_saude", label: "Administrativo de Saúde" },
  { value: "patrocinador", label: "Patrocinador" },
  { value: "paciente", label: "Paciente" },
  { value: "paciente_pos_op", label: "Paciente Pós-op" },
  { value: "fornecedor", label: "Fornecedor" },
  { value: "outro", label: "Outro" },
] as const;

export const RELEVANCIAS = [
  { value: "alta", label: "Alta" },
  { value: "media", label: "Média" },
  { value: "baixa", label: "Baixa" },
] as const;

export const PERIODOS_ATIVIDADE = [
  { value: "30", label: "Últimos 30 dias" },
  { value: "60", label: "Últimos 60 dias" },
  { value: "90", label: "Últimos 90 dias" },
  { value: "all", label: "Todos" },
] as const;
