import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Upload, FileText, Users, AlertTriangle, CheckCircle2, X, Phone, User } from "lucide-react";
import { toast } from "sonner";
import { parseVCFFile, ParsedVCFContact } from "@/utils/vcfParser";
import { parseCSVFile, ParsedContact } from "@/utils/parseLeadImport";
import { supabase } from "@/integrations/supabase/client";

type ImportedContact = ParsedVCFContact | ParsedContact;

interface ImportContactsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete: () => void;
}

type ImportStep = 'upload' | 'preview' | 'importing' | 'complete';

export function ImportContactsModal({ open, onOpenChange, onImportComplete }: ImportContactsModalProps) {
  const [step, setStep] = useState<ImportStep>('upload');
  const [parsedContacts, setParsedContacts] = useState<ImportedContact[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<Set<number>>(new Set());
  const [errors, setErrors] = useState<string[]>([]);
  const [duplicates, setDuplicates] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResult, setImportResult] = useState<{ success: number; failed: number; skipped: number }>({ success: 0, failed: 0, skipped: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = () => {
    setStep('upload');
    setParsedContacts([]);
    setSelectedContacts(new Set());
    setErrors([]);
    setDuplicates([]);
    setImporting(false);
    setImportProgress(0);
    setImportResult({ success: 0, failed: 0, skipped: 0 });
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file extension
    const fileName = file.name.toLowerCase();
    const isVCF = fileName.endsWith('.vcf') || fileName.endsWith('.vcard');
    const isCSV = fileName.endsWith('.csv');
    
    if (!isVCF && !isCSV) {
      toast.error('Por favor, selecione um arquivo VCF ou CSV válido');
      return;
    }

    try {
      let result: { contacts: ImportedContact[]; errors: string[]; duplicates: string[] };
      
      if (isVCF) {
        result = await parseVCFFile(file);
      } else {
        result = await parseCSVFile(file);
      }
      
      if (result.contacts.length === 0) {
        toast.error('Nenhum contato válido encontrado no arquivo');
        return;
      }

      setParsedContacts(result.contacts);
      setErrors(result.errors);
      setDuplicates(result.duplicates);
      setSelectedContacts(new Set(result.contacts.map((_, i) => i)));
      setStep('preview');
      
      toast.success(`${result.contacts.length} contatos encontrados`);
    } catch (error) {
      console.error('Erro ao processar arquivo:', error);
      toast.error('Erro ao processar arquivo');
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const toggleContact = (index: number) => {
    const newSelected = new Set(selectedContacts);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedContacts(newSelected);
  };

  const toggleAll = () => {
    if (selectedContacts.size === parsedContacts.length) {
      setSelectedContacts(new Set());
    } else {
      setSelectedContacts(new Set(parsedContacts.map((_, i) => i)));
    }
  };

  const handleImport = async () => {
    if (selectedContacts.size === 0) {
      toast.error('Selecione pelo menos um contato para importar');
      return;
    }

    setImporting(true);
    setStep('importing');

    const contactsToImport = parsedContacts.filter((_, i) => selectedContacts.has(i));
    let success = 0;
    let failed = 0;
    let skipped = 0;

    // Check for existing phones first
    const phones = contactsToImport.map(c => c.phone);
    const { data: existingContacts } = await supabase
      .from('contacts')
      .select('phone')
      .in('phone', phones);

    const existingPhones = new Set(existingContacts?.map(c => c.phone) || []);

    for (let i = 0; i < contactsToImport.length; i++) {
      const contact = contactsToImport[i];
      setImportProgress(Math.round(((i + 1) / contactsToImport.length) * 100));

      // Skip if already exists
      if (existingPhones.has(contact.phone)) {
        skipped++;
        continue;
      }

      try {
        // Create JID format for WhatsApp
        const cleanPhone = contact.phone.replace(/\D/g, '');
        const jid = `${cleanPhone}@s.whatsapp.net`;

        const { error } = await supabase
          .from('contacts')
          .insert({
            phone: contact.phone,
            name: contact.name,
            jid: jid,
            tipo_contato: 'importado',
            tipo_jid: 'user',
            observacoes: contact.organization ? `Empresa: ${contact.organization}` : null,
          });

        if (error) {
          console.error('Erro ao inserir contato:', error);
          failed++;
        } else {
          success++;
        }
      } catch (error) {
        console.error('Erro ao importar contato:', error);
        failed++;
      }
    }

    setImportResult({ success, failed, skipped });
    setImporting(false);
    setStep('complete');
  };

  const handleFinish = () => {
    onImportComplete();
    handleClose();
    toast.success(`${importResult.success} contatos importados com sucesso`);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Importar Contatos
          </DialogTitle>
        <DialogDescription>
            {step === 'upload' && 'Selecione um arquivo VCF ou CSV exportado do seu telefone'}
            {step === 'preview' && 'Revise os contatos antes de importar'}
            {step === 'importing' && 'Importando contatos...'}
            {step === 'complete' && 'Importação concluída'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          {/* Upload Step */}
          {step === 'upload' && (
            <div className="flex flex-col items-center justify-center py-12 gap-6">
              <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center">
                <FileText className="h-12 w-12 text-primary" />
              </div>
              
              <div className="text-center space-y-2">
                <p className="text-lg font-medium">Arraste um arquivo VCF ou CSV aqui</p>
                <p className="text-sm text-muted-foreground">ou clique para selecionar</p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".vcf,.vcard,.csv"
                onChange={handleFileSelect}
                className="hidden"
                id="contacts-input"
              />
              
              <Button onClick={() => fileInputRef.current?.click()} className="gap-2">
                <Upload className="h-4 w-4" />
                Selecionar Arquivo
              </Button>

              <div className="text-xs text-muted-foreground text-center max-w-sm">
                <p>Formatos suportados: .vcf, .vcard, .csv</p>
                <p className="mt-1">Exporte seus contatos do iPhone, Android, Outlook ou Google Contacts</p>
              </div>
            </div>
          )}

          {/* Preview Step */}
          {step === 'preview' && (
            <div className="flex flex-col h-full">
              {/* Summary */}
              <div className="flex items-center gap-4 pb-4 border-b">
                <Badge variant="outline" className="gap-1">
                  <Users className="h-3 w-3" />
                  {parsedContacts.length} contatos
                </Badge>
                
                {errors.length > 0 && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {errors.length} erros
                  </Badge>
                )}
                
                {duplicates.length > 0 && (
                  <Badge variant="secondary" className="gap-1">
                    {duplicates.length} duplicados ignorados
                  </Badge>
                )}

                <div className="ml-auto">
                  <Button variant="ghost" size="sm" onClick={toggleAll}>
                    {selectedContacts.size === parsedContacts.length ? 'Desmarcar todos' : 'Selecionar todos'}
                  </Button>
                </div>
              </div>

              {/* Contact List */}
              <ScrollArea className="flex-1 mt-4">
                <div className="space-y-2 pr-4">
                  {parsedContacts.map((contact, index) => (
                    <div
                      key={index}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedContacts.has(index) ? 'bg-primary/5 border-primary/30' : 'hover:bg-muted/50'
                      }`}
                      onClick={() => toggleContact(index)}
                    >
                      <Checkbox
                        checked={selectedContacts.has(index)}
                        onCheckedChange={() => toggleContact(index)}
                      />
                      
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <User className="h-5 w-5 text-primary" />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">
                          {contact.name || 'Sem nome'}
                        </p>
                        <p className="text-sm text-muted-foreground flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {contact.phoneFormatted}
                        </p>
                      </div>

                      {contact.organization && (
                        <Badge variant="outline" className="text-xs">
                          {contact.organization}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>

              {/* Errors */}
              {errors.length > 0 && (
                <div className="mt-4 p-3 bg-destructive/10 rounded-lg">
                  <p className="text-sm font-medium text-destructive mb-2">Erros encontrados:</p>
                  <div className="text-xs text-muted-foreground space-y-1">
                    {errors.slice(0, 5).map((error, i) => (
                      <p key={i}>{error}</p>
                    ))}
                    {errors.length > 5 && (
                      <p>...e mais {errors.length - 5} erros</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Importing Step */}
          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-12 gap-6">
              <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
              
              <div className="text-center space-y-2">
                <p className="text-lg font-medium">Importando contatos...</p>
                <p className="text-sm text-muted-foreground">Por favor, aguarde</p>
              </div>

              <div className="w-full max-w-xs">
                <Progress value={importProgress} className="h-2" />
                <p className="text-center text-sm text-muted-foreground mt-2">{importProgress}%</p>
              </div>
            </div>
          )}

          {/* Complete Step */}
          {step === 'complete' && (
            <div className="flex flex-col items-center justify-center py-12 gap-6">
              <div className="w-24 h-24 rounded-full bg-green-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-12 w-12 text-green-500" />
              </div>
              
              <div className="text-center space-y-2">
                <p className="text-lg font-medium">Importação concluída!</p>
              </div>

              <div className="flex gap-4">
                <Badge variant="default" className="gap-1 px-4 py-2">
                  <CheckCircle2 className="h-4 w-4" />
                  {importResult.success} importados
                </Badge>
                
                {importResult.skipped > 0 && (
                  <Badge variant="secondary" className="gap-1 px-4 py-2">
                    {importResult.skipped} já existentes
                  </Badge>
                )}
                
                {importResult.failed > 0 && (
                  <Badge variant="destructive" className="gap-1 px-4 py-2">
                    <X className="h-4 w-4" />
                    {importResult.failed} falharam
                  </Badge>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {step === 'upload' && (
            <Button variant="outline" onClick={handleClose}>
              Cancelar
            </Button>
          )}

          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={() => setStep('upload')}>
                Voltar
              </Button>
              <Button onClick={handleImport} disabled={selectedContacts.size === 0}>
                Importar {selectedContacts.size} contatos
              </Button>
            </>
          )}

          {step === 'complete' && (
            <Button onClick={handleFinish}>
              Concluir
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
