import { formatBrazilianPhone, cleanPhoneDigits } from './brazilianPhoneUtils';

export interface ParsedVCFContact {
  name: string | null;
  phone: string;
  phoneFormatted: string;
  email?: string | null;
  organization?: string | null;
}

export interface VCFParseResult {
  contacts: ParsedVCFContact[];
  errors: string[];
  duplicates: string[];
}

/**
 * Parse a single vCard entry
 */
function parseVCard(vcardText: string): ParsedVCFContact | null {
  const lines = vcardText.split(/\r?\n/);
  
  let name: string | null = null;
  let phones: string[] = [];
  let email: string | null = null;
  let organization: string | null = null;
  
  for (const line of lines) {
    // Parse FN (Formatted Name)
    if (line.startsWith('FN:') || line.startsWith('FN;')) {
      const value = line.includes(':') ? line.split(':').slice(1).join(':').trim() : '';
      if (value) name = decodeVCardValue(value);
    }
    
    // Parse N (Name) as fallback
    if (!name && (line.startsWith('N:') || line.startsWith('N;'))) {
      const value = line.includes(':') ? line.split(':').slice(1).join(':').trim() : '';
      if (value) {
        const parts = value.split(';').filter(p => p.trim());
        name = decodeVCardValue(parts.reverse().join(' ').trim());
      }
    }
    
    // Parse TEL (Phone)
    if (line.startsWith('TEL') || line.toUpperCase().includes('TEL')) {
      const match = line.match(/TEL[^:]*:(.+)/i);
      if (match) {
        const phone = match[1].trim().replace(/[\s\-\(\)\.]/g, '');
        if (phone) phones.push(phone);
      }
    }
    
    // Parse EMAIL
    if (line.startsWith('EMAIL') || line.toUpperCase().includes('EMAIL')) {
      const match = line.match(/EMAIL[^:]*:(.+)/i);
      if (match) {
        email = match[1].trim();
      }
    }
    
    // Parse ORG (Organization)
    if (line.startsWith('ORG:') || line.startsWith('ORG;')) {
      const value = line.includes(':') ? line.split(':').slice(1).join(':').trim() : '';
      if (value) organization = decodeVCardValue(value.split(';')[0]);
    }
  }
  
  // Get the first valid phone
  const primaryPhone = phones.find(p => p.length >= 8);
  
  if (!primaryPhone) {
    return null;
  }
  
  // Format phone for database
  const result = formatBrazilianPhone(primaryPhone);
  const normalizedPhone = result.isValid ? result.formatted : cleanPhoneDigits(primaryPhone);
  const formattedPhone = result.isValid ? result.formatted : normalizedPhone;
  
  return {
    name: name || null,
    phone: normalizedPhone,
    phoneFormatted: formattedPhone,
    email,
    organization,
  };
}

/**
 * Decode vCard encoded values (quoted-printable, base64, etc)
 */
function decodeVCardValue(value: string): string {
  // Handle quoted-printable encoding
  if (value.includes('=')) {
    try {
      // Simple quoted-printable decode
      value = value.replace(/=([0-9A-F]{2})/gi, (_, hex) => 
        String.fromCharCode(parseInt(hex, 16))
      );
      // Handle soft line breaks
      value = value.replace(/=\r?\n/g, '');
    } catch (e) {
      // Keep original if decode fails
    }
  }
  
  // Handle UTF-8 encoded strings
  try {
    // Check if it's URI encoded
    if (value.includes('%')) {
      value = decodeURIComponent(value);
    }
  } catch (e) {
    // Keep original if decode fails
  }
  
  return value.trim();
}

/**
 * Parse VCF file content
 */
export function parseVCFContent(content: string): VCFParseResult {
  const contacts: ParsedVCFContact[] = [];
  const errors: string[] = [];
  const duplicates: string[] = [];
  const seenPhones = new Set<string>();
  
  // Split by vCard entries
  const vcardRegex = /BEGIN:VCARD[\s\S]*?END:VCARD/gi;
  const matches = content.match(vcardRegex);
  
  if (!matches || matches.length === 0) {
    errors.push('Nenhum contato válido encontrado no arquivo');
    return { contacts, errors, duplicates };
  }
  
  for (let i = 0; i < matches.length; i++) {
    const vcardText = matches[i];
    
    try {
      const parsed = parseVCard(vcardText);
      
      if (!parsed) {
        errors.push(`Contato ${i + 1}: Sem telefone válido`);
        continue;
      }
      
      // Check for duplicates
      if (seenPhones.has(parsed.phone)) {
        duplicates.push(parsed.phone);
        continue;
      }
      
      seenPhones.add(parsed.phone);
      contacts.push(parsed);
    } catch (e) {
      errors.push(`Contato ${i + 1}: Erro ao processar`);
    }
  }
  
  return { contacts, errors, duplicates };
}

/**
 * Read and parse a VCF file
 */
export async function parseVCFFile(file: File): Promise<VCFParseResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const result = parseVCFContent(content);
        resolve(result);
      } catch (error) {
        reject(new Error('Erro ao ler arquivo VCF'));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Erro ao ler arquivo'));
    };
    
    // Try to read as UTF-8 first
    reader.readAsText(file, 'UTF-8');
  });
}
