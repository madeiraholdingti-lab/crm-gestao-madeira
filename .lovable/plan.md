

## Plano: Normalizar payload do disparo n8n

### O que muda

Reorganizar o JSON enviado ao webhook n8n para separar dados fixos (campanha, instancia) do lote de leads. O `script_ia_id` vai no top-level para que o n8n use como variavel em um HTTP request a um endpoint futuro de scripts.

### Nova estrutura do payload

```text
{
  campanha: {
    id: "uuid",
    nome: "anestesista-são-miguel",
    tipo: "captacao",
    mensagem: "Olá...",
    script_ia_id: "uuid"        // <-- ID para buscar script via endpoint
  },
  instancia: {
    nome: "PacientesRafaela",
    id: "09f87a04-..."
  },
  envio_id: "uuid",
  callback_url: "https://...",
  total: 5,
  lote: [
    {
      campanha_envio_id: "uuid",
      lead_id: "uuid",
      nome: "ewerton rubi",
      numero: "5547999758708",
      telefone_original: "5547999758708",
      tipo_lead: "novo",
      especialidade: null,
      status_anterior: "reenviar"
    }
  ]
}
```

### Alteracao

**Arquivo:** `supabase/functions/processar-envios-massa/index.ts`

1. Apos validar os leads, extrair do primeiro item valido os dados fixos: `campanha` (id, nome, tipo, mensagem, script_ia_id) e `instancia` (nome, id)
2. Remover esses campos repetidos de cada item do `lote` -- cada item fica apenas com: `campanha_envio_id`, `lead_id`, `nome`, `numero`, `telefone_original`, `tipo_lead`, `especialidade`, `status_anterior`
3. Adicionar join para buscar `script_ia_id` da `campanhas_disparo` na query existente (campo ja existe na tabela)
4. Montar o payload final com a nova estrutura antes de enviar ao webhook
5. Atualizar tambem o retorno do `test_mode` para refletir a nova estrutura

**Sem alteracao de banco** -- `campanhas_disparo.script_ia_id` ja existe.

