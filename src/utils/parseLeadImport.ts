import { formatBrazilianPhone } from "./brazilianPhoneUtils";
import * as XLSX from "xlsx";

// Palavras-chave para identificar tipos de lead
const TIPO_KEYWORDS: Record<string, string[]> = {
  medico: ["dr.", "dra.", "dr ", "dra ", "doutor", "doutora", "médico", "medico"],
  paciente: ["paciente", "pac.", "pac "],
  fornecedor: ["fornecedor", "fornec."],
  parceiro: ["parceiro", "parceria"],
  secretaria: ["secretária", "secretaria", "sec."],
};

// Especialidades médicas conhecidas
const ESPECIALIDADES = [
  "oftalmologista", "oftalmo", "oftalmologia",
  "cardiologista", "cardio", "cardiologia",
  "dermatologista", "dermato", "dermatologia",
  "ginecologista", "gineco", "ginecologia",
  "pediatra", "pediatria",
  "ortopedista", "orto", "ortopedia",
  "neurologista", "neuro", "neurologia",
  "psiquiatra", "psiquiatria",
  "urologista", "uro", "urologia",
  "oncologista", "onco", "oncologia",
  "radiologista", "radio", "radiologia",
  "anestesista", "anestesiologia",
  "cirurgião", "cirurgia", "cirurgiao",
  "gastroenterologista", "gastro", "gastroenterologia",
  "endocrinologista", "endocrino", "endocrinologia",
  "pneumologista", "pneumo", "pneumologia",
  "otorrinolaringologista", "otorrino", "orl",
  "nefrologista", "nefro", "nefrologia",
  "infectologista", "infecto", "infectologia",
  "geriatra", "geriatria",
  "hematologista", "hemato", "hematologia",
  "reumatologista", "reumato", "reumatologia",
  "proctologista", "procto", "proctologia",
  "mastologista", "masto", "mastologia",
  "nutrólogo", "nutrologo", "nutrologia",
  "clínico geral", "clinico geral", "clinica geral",
];

// Convênios/Planos de saúde conhecidos
const CONVENIOS = [
  "bradesco", "unimed", "amil", "sulamerica", "sulamérica",
  "porto seguro", "golden cross", "hapvida", "notredame",
  "intermédica", "intermedica", "cassi", "geap", "fusex",
  "particular", "sus", "ipsemg", "planserv", "capesaúde", "capesaude"
];

export interface ParsedLead {
  nome: string;
  telefone: string;
  telefone_formatado: string;
  telefone_valido: boolean;
  telefone_erro?: string;
  tipo_lead: string;
  especialidade?: string;
  convenio?: string;
  observacoes?: string;
  raw_original: string;
  email?: string;
  origem?: string;
  anotacoes_original?: string;
}

// Interface compatível com ImportContactsModal
export interface ParsedContact {
  name: string | null;
  phone: string;
  phoneFormatted: string;
  email?: string | null;
  organization?: string | null;
}

export function parseLeadName(rawName: string): {
  nome: string;
  tipo_lead: string;
  especialidade?: string;
  convenio?: string;
  observacoes?: string;
} {
  // Limpar o nome de caracteres estranhos como ;; e números de telefone
  let cleanName = rawName
    .replace(/;;/g, " ")
    .replace(/;/g, " ")
    .replace(/\d{10,}/g, "") // Remove números de telefone longos
    .replace(/\s+/g, " ")
    .trim();

  let tipo_lead = "novo";
  let especialidade: string | undefined;
  let convenio: string | undefined;
  const observacoesList: string[] = [];
  const lowerName = cleanName.toLowerCase();

  // Detectar tipo pelo prefixo Dr./Dra. ou palavra-chave
  for (const [tipo, keywords] of Object.entries(TIPO_KEYWORDS)) {
    for (const kw of keywords) {
      if (lowerName.includes(kw)) {
        tipo_lead = tipo;
        break;
      }
    }
    if (tipo_lead !== "novo") break;
  }

  // Detectar especialidade
  for (const esp of ESPECIALIDADES) {
    if (lowerName.includes(esp.toLowerCase())) {
      especialidade = esp.charAt(0).toUpperCase() + esp.slice(1);
      // Remover a especialidade do nome
      const espRegex = new RegExp(`\\b${esp}\\b`, "gi");
      cleanName = cleanName.replace(espRegex, "").trim();
      break;
    }
  }

  // Detectar convênio
  for (const conv of CONVENIOS) {
    if (lowerName.includes(conv.toLowerCase())) {
      convenio = conv.charAt(0).toUpperCase() + conv.slice(1);
      break;
    }
  }

  // Detectar palavras que devem ir para observações (nomes de clínicas, empresas, etc)
  const palavrasObservacao = [
    "clinimagem", "clinica", "clínica", "hospital", "lab", "laboratório", "laboratorio",
    "centro", "instituto", "consultório", "consultorio", "saúde", "saude", "medical",
    "med", "care", "life", "plus", "prime", "premium", "gold", "silver"
  ];

  for (const palavra of palavrasObservacao) {
    const regex = new RegExp(`\\b\\w*${palavra}\\w*\\b`, "gi");
    const matches = cleanName.match(regex);
    if (matches) {
      for (const match of matches) {
        if (match.length > 3 && !observacoesList.includes(match)) {
          observacoesList.push(match);
          cleanName = cleanName.replace(match, "").trim();
        }
      }
    }
  }

  // Remover tipo (Paciente, etc) do nome
  cleanName = cleanName
    .replace(/\bpaciente\b/gi, "")
    .replace(/\bpac\.\b/gi, "")
    .replace(/\bfornecedor\b/gi, "")
    .replace(/\bparceiro\b/gi, "")
    .replace(/\bsecretária?\b/gi, "")
    .replace(/\bsec\.\b/gi, "")
    .trim();

  // Remover convênio do nome
  if (convenio) {
    const convRegex = new RegExp(`\\b${convenio}\\b`, "gi");
    cleanName = cleanName.replace(convRegex, "").trim();
  }

  // Limpar espaços múltiplos e caracteres especiais restantes
  cleanName = cleanName
    .replace(/\s+/g, " ")
    .replace(/^[\s\-;,]+/, "")
    .replace(/[\s\-;,]+$/, "")
    .trim();

  // Gerar observações finais
  const observacoes = [
    especialidade ? `Especialidade: ${especialidade}` : null,
    convenio ? `Convênio: ${convenio}` : null,
    ...observacoesList
  ].filter(Boolean).join("; ");

  return {
    nome: cleanName || rawName.split(";")[0].trim(),
    tipo_lead,
    especialidade,
    convenio,
    observacoes: observacoes || undefined
  };
}

export function parseLine(line: string, separator: string = ";"): ParsedLead | null {
  const parts = line.split(separator).map(p => p.trim());
  
  // Tentar encontrar o telefone (maior sequência de números)
  let telefone = "";
  let rawName = "";
  
  for (const part of parts) {
    const onlyDigits = part.replace(/\D/g, "");
    if (onlyDigits.length >= 10 && onlyDigits.length <= 15) {
      if (!telefone || onlyDigits.length > telefone.length) {
        telefone = onlyDigits;
      }
    } else if (part && !telefone) {
      rawName = part;
    }
  }

  // Se não encontrou telefone no split, tentar extrair do nome
  if (!telefone) {
    const phoneMatch = line.match(/[\d\s\-\(\)]{10,20}/);
    if (phoneMatch) {
      telefone = phoneMatch[0].replace(/\D/g, "");
    }
  }

  if (!telefone || telefone.length < 8) {
    return null;
  }

  // Se não achou nome no split, usar a parte antes do telefone
  if (!rawName) {
    const phoneIdx = line.indexOf(telefone.slice(0, 4));
    if (phoneIdx > 0) {
      rawName = line.substring(0, phoneIdx).replace(/[;,\s]+$/, "").trim();
    }
  }

  const parsed = parseLeadName(rawName || "");
  const phoneResult = cleanPhoneNumber(telefone);

  return {
    ...parsed,
    telefone: telefone,
    telefone_formatado: phoneResult.formatted,
    telefone_valido: phoneResult.isValid,
    telefone_erro: phoneResult.error,
    raw_original: line
  };
}

export function cleanPhoneNumber(phone: string): { formatted: string; isValid: boolean; error?: string } {
  const result = formatBrazilianPhone(phone);
  return {
    formatted: result.formatted,
    isValid: result.isValid,
    error: result.error
  };
}

export function detectSeparator(content: string): string {
  const lines = content.split("\n").slice(0, 5);
  
  const separators = [",", ";", "\t", "|"];
  let bestSeparator = ";";
  let maxCount = 0;
  
  for (const sep of separators) {
    let count = 0;
    for (const line of lines) {
      count += (line.match(new RegExp(`\\${sep}`, "g")) || []).length;
    }
    if (count > maxCount) {
      maxCount = count;
      bestSeparator = sep;
    }
  }
  
  return bestSeparator;
}

export function parseCSVContent(content: string): {
  leads: ParsedLead[];
  errors: string[];
  duplicates: string[];
} {
  const separator = detectSeparator(content);
  const lines = content.split("\n").filter(l => l.trim());
  
  const leads: ParsedLead[] = [];
  const errors: string[] = [];
  const duplicates: string[] = [];
  const seenPhones = new Set<string>();
  
  if (lines.length === 0) {
    return { leads, errors, duplicates };
  }
  
  // Parse header to find column indexes
  const headerLine = lines[0];
  const headers = headerLine.split(separator).map(h => h.trim().toLowerCase().replace(/^\ufeff/, ''));
  
  // Find column indexes
  const nomeIdx = headers.findIndex(h => h === 'nome' || h.includes('name'));
  const telefoneIdx = headers.findIndex(h => h === 'telefone' || h.includes('phone') || h.includes('celular'));
  const emailIdx = headers.findIndex(h => h === 'email' || h.includes('e-mail'));
  const anotacoesIdx = headers.findIndex(h => h === 'anotacoes' || h === 'anotações' || h === 'observacoes' || h === 'observações');

  // Detectar se primeira linha é cabeçalho
  const hasHeader = nomeIdx !== -1 || telefoneIdx !== -1;
  
  const startIdx = hasHeader ? 1 : 0;
  
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const values = line.split(separator).map(v => v.trim());
    
    // Extract fields from known columns
    const nome = nomeIdx !== -1 ? values[nomeIdx] || "" : "";
    const telefoneRaw = telefoneIdx !== -1 ? values[telefoneIdx] || "" : "";
    const email = emailIdx !== -1 ? values[emailIdx] || "" : "";
    const anotacoes = anotacoesIdx !== -1 ? values[anotacoesIdx] || "" : "";
    
    // Clean phone number
    const telefone = telefoneRaw.replace(/\D/g, "");
    
    // Build observacoes
    const observacoesParts = [];
    if (anotacoes) observacoesParts.push(anotacoes);
    
    // Se telefone inválido ou ausente, ainda assim cria o lead para exportação de erros
    if (!telefone || telefone.length < 8) {
      leads.push({
        nome: nome || "Sem nome",
        telefone: telefoneRaw,
        telefone_formatado: "",
        telefone_valido: false,
        telefone_erro: "Telefone inválido ou ausente",
        tipo_lead: "novo",
        observacoes: observacoesParts.length > 0 ? observacoesParts.join("; ") : undefined,
        raw_original: line,
        email: email || undefined,
      });
      continue;
    }
    
    if (seenPhones.has(telefone)) {
      duplicates.push(telefone);
      continue;
    }
    
    seenPhones.add(telefone);
    
    const phoneResult = cleanPhoneNumber(telefone);
    
    leads.push({
      nome: nome || "Sem nome",
      telefone: telefone,
      telefone_formatado: phoneResult.formatted,
      telefone_valido: phoneResult.isValid,
      telefone_erro: phoneResult.error,
      tipo_lead: "novo",
      observacoes: observacoesParts.length > 0 ? observacoesParts.join("; ") : undefined,
      raw_original: line,
      email: email || undefined,
    });
  }
  
  return { leads, errors, duplicates };
}

// ==========================================
// CSV PARSER FOR CONTACTS IMPORT (Outlook/Google format)
// ==========================================

interface ContactParseResult {
  contacts: ParsedContact[];
  errors: string[];
  duplicates: string[];
}

/**
 * Parse a single CSV line handling quoted values
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result;
}

/**
 * Find column index by possible header names
 */
function findColumnIndex(headers: string[], possibleNames: string[]): number {
  for (const name of possibleNames) {
    const idx = headers.findIndex(h => h.includes(name));
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Parse CSV content for contact import (Outlook/Google format)
 */
export function parseCSVForContacts(content: string): ContactParseResult {
  const contacts: ParsedContact[] = [];
  const errors: string[] = [];
  const duplicates: string[] = [];
  const seenPhones = new Set<string>();

  const lines = content.split(/\r?\n/).filter(line => line.trim());
  
  if (lines.length < 2) {
    errors.push('Arquivo CSV vazio ou sem dados');
    return { contacts, errors, duplicates };
  }

  // Parse header to find column indexes
  const header = parseCSVLine(lines[0]);
  const headerLower = header.map(h => h.toLowerCase().trim());

  // Find relevant columns - support multiple formats
  const firstNameIdx = findColumnIndex(headerLower, ['first name', 'nome', 'primeiro nome']);
  const lastNameIdx = findColumnIndex(headerLower, ['last name', 'sobrenome', 'último nome']);
  const displayNameIdx = findColumnIndex(headerLower, ['display name', 'nome completo', 'nome de exibição']);
  const emailIdx = findColumnIndex(headerLower, ['e-mail address', 'email', 'e-mail', 'email address']);
  const mobilePhoneIdx = findColumnIndex(headerLower, ['mobile phone', 'celular', 'telefone celular']);
  const homePhoneIdx = findColumnIndex(headerLower, ['home phone', 'telefone residencial', 'telefone casa']);
  const businessPhoneIdx = findColumnIndex(headerLower, ['business phone', 'telefone comercial', 'telefone trabalho']);
  const organizationIdx = findColumnIndex(headerLower, ['organization', 'organização', 'empresa', 'company']);

  // Process data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    try {
      const values = parseCSVLine(line);
      
      // Get name - prefer display name, then combine first/last
      let name: string | null = null;
      if (displayNameIdx !== -1 && values[displayNameIdx]?.trim()) {
        name = values[displayNameIdx].trim();
      } else if (firstNameIdx !== -1 || lastNameIdx !== -1) {
        const firstName = firstNameIdx !== -1 ? values[firstNameIdx]?.trim() || '' : '';
        const lastName = lastNameIdx !== -1 ? values[lastNameIdx]?.trim() || '' : '';
        const combined = `${firstName} ${lastName}`.trim();
        if (combined) name = combined;
      }

      // Get phone - try mobile first, then home, then business
      let rawPhone: string | null = null;
      if (mobilePhoneIdx !== -1 && values[mobilePhoneIdx]?.trim()) {
        rawPhone = values[mobilePhoneIdx].trim();
      } else if (homePhoneIdx !== -1 && values[homePhoneIdx]?.trim()) {
        rawPhone = values[homePhoneIdx].trim();
      } else if (businessPhoneIdx !== -1 && values[businessPhoneIdx]?.trim()) {
        rawPhone = values[businessPhoneIdx].trim();
      }

      if (!rawPhone) {
        continue;
      }

      // Clean and format phone
      const cleanedPhone = rawPhone.replace(/[\s\-\(\)\.]/g, '');
      if (cleanedPhone.length < 8) {
        errors.push(`Linha ${i + 1}: Telefone inválido "${rawPhone}"`);
        continue;
      }

      const result = formatBrazilianPhone(cleanedPhone);
      const normalizedPhone = result.isValid ? result.formatted : cleanedPhone.replace(/\D/g, '');

      // Check for duplicates
      if (seenPhones.has(normalizedPhone)) {
        duplicates.push(normalizedPhone);
        continue;
      }

      seenPhones.add(normalizedPhone);

      // Get optional fields
      const email = emailIdx !== -1 ? values[emailIdx]?.trim() || null : null;
      const organization = organizationIdx !== -1 ? values[organizationIdx]?.trim() || null : null;

      contacts.push({
        name,
        phone: normalizedPhone,
        phoneFormatted: normalizedPhone,
        email,
        organization,
      });
    } catch (e) {
      errors.push(`Linha ${i + 1}: Erro ao processar`);
    }
  }

  return { contacts, errors, duplicates };
}

/**
 * Read and parse a CSV file for contacts import
 */
export async function parseCSVFile(file: File): Promise<ContactParseResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const result = parseCSVForContacts(content);
        resolve(result);
      } catch (error) {
        reject(new Error('Erro ao ler arquivo CSV'));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Erro ao ler arquivo'));
    };
    
    reader.readAsText(file, 'UTF-8');
  });
}

/**
 * Yield control back to the browser to prevent UI freeze
 */
function yieldToMain(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function getWorksheetRows(worksheet: XLSX.WorkSheet): string[][] {
  const rowMap = new Map<number, Map<number, string>>();

  for (const [address, cell] of Object.entries(worksheet)) {
    if (address.startsWith("!")) continue;

    const decoded = XLSX.utils.decode_cell(address);
    const value = String((cell as XLSX.CellObject).w ?? (cell as XLSX.CellObject).v ?? "").trim();

    if (!value) continue;

    if (!rowMap.has(decoded.r)) {
      rowMap.set(decoded.r, new Map<number, string>());
    }

    rowMap.get(decoded.r)!.set(decoded.c, value);
  }

  const sortedRows = Array.from(rowMap.entries()).sort((a, b) => a[0] - b[0]);

  return sortedRows.map(([, columns]) => {
    const sortedColumns = Array.from(columns.entries()).sort((a, b) => a[0] - b[0]);
    const maxColumn = sortedColumns[sortedColumns.length - 1]?.[0] ?? 0;
    const row = Array.from({ length: maxColumn + 1 }, () => "");

    for (const [columnIndex, value] of sortedColumns) {
      row[columnIndex] = value;
    }

    return row;
  });
}

/**
 * Parse XLSX file and return leads — async with chunked processing
 */
export async function parseXLSXContent(
  data: ArrayBuffer,
  onProgress?: (processed: number, total: number) => void
): Promise<{
  leads: ParsedLead[];
  errors: string[];
  duplicates: string[];
}> {
  const leads: ParsedLead[] = [];
  const errors: string[] = [];
  const duplicates: string[] = [];
  const seenPhones = new Set<string>();

  try {
    const workbook = XLSX.read(data, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = getWorksheetRows(worksheet).filter((row) => row.some((cell) => cell.trim() !== ""));

    if (rows.length <= 1) {
      errors.push("Planilha vazia ou sem dados válidos");
      return { leads, errors, duplicates };
    }

    const headers = rows[0].map((h) => h.toLowerCase().trim());
    const nomeIdx = headers.findIndex(h => h === 'nome' || h.includes('name'));
    const telefoneIdx = headers.findIndex(h => h === 'telefone' || h.includes('phone') || h.includes('celular'));
    const emailIdx = headers.findIndex(h => h === 'email' || h.includes('e-mail'));
    const anotacoesIdx = headers.findIndex(h => h === 'anotacoes' || h === 'anotações' || h === 'observacoes' || h === 'observações');

    const dataRows = rows.slice(1);
    const total = dataRows.length;
    const CHUNK_SIZE = 250;

    for (let i = 0; i < total; i++) {
      const row = dataRows[i];
      const nome = nomeIdx !== -1 ? String(row[nomeIdx] || "") : "";
      const telefoneRaw = telefoneIdx !== -1 ? String(row[telefoneIdx] || "") : "";
      const email = emailIdx !== -1 ? String(row[emailIdx] || "") : "";
      const anotacoes = anotacoesIdx !== -1 ? String(row[anotacoesIdx] || "") : "";
      const telefone = telefoneRaw.replace(/\D/g, "");
      const observacoesParts = anotacoes ? [anotacoes] : [];

      if (!telefone || telefone.length < 8) {
        leads.push({
          nome: nome || "Sem nome",
          telefone: telefoneRaw,
          telefone_formatado: "",
          telefone_valido: false,
          telefone_erro: "Telefone inválido ou ausente",
          tipo_lead: "novo",
          observacoes: observacoesParts.length > 0 ? observacoesParts.join("; ") : undefined,
          raw_original: JSON.stringify(row),
          email: email || undefined,
        });
      } else if (seenPhones.has(telefone)) {
        duplicates.push(telefone);
      } else {
        seenPhones.add(telefone);
        const phoneResult = cleanPhoneNumber(telefone);
        leads.push({
          nome: nome || "Sem nome",
          telefone,
          telefone_formatado: phoneResult.formatted,
          telefone_valido: phoneResult.isValid,
          telefone_erro: phoneResult.error,
          tipo_lead: "novo",
          observacoes: observacoesParts.length > 0 ? observacoesParts.join("; ") : undefined,
          raw_original: JSON.stringify(row),
          email: email || undefined,
        });
      }

      if ((i + 1) % CHUNK_SIZE === 0) {
        onProgress?.(i + 1, total);
        await yieldToMain();
      }
    }

    onProgress?.(total, total);
  } catch (error) {
    console.error("Erro ao processar XLSX:", error);
    errors.push("Erro ao processar arquivo XLSX");
  }

  return { leads, errors, duplicates };
}
