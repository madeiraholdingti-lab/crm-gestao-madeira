// DDDs válidos do Brasil
const VALID_DDDS = [
  11, 12, 13, 14, 15, 16, 17, 18, 19, // SP
  21, 22, 24, // RJ
  27, 28, // ES
  31, 32, 33, 34, 35, 37, 38, // MG
  41, 42, 43, 44, 45, 46, // PR
  47, 48, 49, // SC
  51, 53, 54, 55, // RS
  61, // DF
  62, 64, // GO
  63, // TO
  65, 66, // MT
  67, // MS
  68, // AC
  69, // RO
  71, 73, 74, 75, 77, // BA
  79, // SE
  81, 87, // PE
  82, // AL
  83, // PB
  84, // RN
  85, 88, // CE
  86, 89, // PI
  91, 93, 94, // PA
  92, 97, // AM
  95, // RR
  96, // AP
  98, 99, // MA
];

export interface PhoneValidationResult {
  isValid: boolean;
  formatted: string;
  error?: string;
}

/**
 * Limpa o número removendo caracteres não numéricos
 */
export function cleanPhoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Formata e valida número de celular brasileiro
 * Formato esperado final: 55DDDXXXXXXXXX (13 dígitos)
 * - DDI: 55
 * - DDD: 2 dígitos
 * - Número: 9 dígitos (começando com 9)
 */
export function formatBrazilianPhone(phone: string): PhoneValidationResult {
  const digits = cleanPhoneDigits(phone);
  
  if (!digits) {
    return { isValid: false, formatted: "", error: "Número vazio" };
  }

  // Aceitar APENAS 13 dígitos começando com 55
  if (digits.length !== 13) {
    return { isValid: false, formatted: digits, error: `Deve ter 13 dígitos, tem ${digits.length}` };
  }

  if (!digits.startsWith("55")) {
    return { isValid: false, formatted: digits, error: "Deve começar com 55" };
  }

  const ddd = digits.substring(2, 4);
  const numero = digits.substring(4);

  // Validar DDD
  const dddNum = parseInt(ddd, 10);
  if (!VALID_DDDS.includes(dddNum)) {
    return { isValid: false, formatted: digits, error: `DDD inválido: ${ddd}` };
  }
  
  // Validar que número começa com 9 (celular)
  if (!numero.startsWith("9")) {
    return { isValid: false, formatted: digits, error: "Número de celular deve começar com 9" };
  }
  
  return { isValid: true, formatted: digits };
}

/**
 * Valida se um número é brasileiro válido
 */
export function isValidBrazilianPhone(phone: string): boolean {
  return formatBrazilianPhone(phone).isValid;
}

/**
 * Retorna apenas o número formatado ou null se inválido
 */
export function getFormattedPhoneOrNull(phone: string): string | null {
  const result = formatBrazilianPhone(phone);
  return result.isValid ? result.formatted : null;
}

/**
 * Formata para exibição: +55 (11) 91234-5678
 */
export function formatPhoneForDisplay(phone: string): string {
  const result = formatBrazilianPhone(phone);
  if (!result.isValid) return phone;
  
  const digits = result.formatted;
  // 5511912345678 -> +55 (11) 91234-5678
  const ddd = digits.substring(2, 4);
  const parte1 = digits.substring(4, 9);
  const parte2 = digits.substring(9);
  
  return `+55 (${ddd}) ${parte1}-${parte2}`;
}
