import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Transfere uma conversa para uma nova instância e/ou novo responsável
 * @param conversaId - ID da conversa a ser transferida
 * @param novaInstanciaId - ID da nova instância (opcional)
 * @param novoResponsavelId - ID do novo responsável (opcional)
 * @param anotacao - Anotação sobre a transferência (opcional)
 */
export async function transferirConversa(
  conversaId: string,
  novaInstanciaId?: string | null,
  novoResponsavelId?: string | null,
  anotacao?: string | null
): Promise<boolean> {
  try {
    const updateData: any = {};

    if (novaInstanciaId !== undefined) {
      updateData.current_instance_id = novaInstanciaId;
    }

    if (novoResponsavelId !== undefined) {
      updateData.responsavel_atual = novoResponsavelId;
    }

    if (anotacao !== undefined) {
      updateData.anotacao_transferencia = anotacao;
    }

    // Atualizar o timestamp de atualização
    updateData.updated_at = new Date().toISOString();

    const { error } = await supabase
      .from("conversas")
      .update(updateData)
      .eq("id", conversaId);

    if (error) {
      console.error("Erro ao transferir conversa:", error);
      toast.error("Erro ao transferir conversa");
      return false;
    }

    toast.success("Conversa transferida com sucesso");
    return true;
  } catch (error) {
    console.error("Erro ao transferir conversa:", error);
    toast.error("Erro inesperado ao transferir conversa");
    return false;
  }
}
