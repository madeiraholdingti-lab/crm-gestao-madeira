# Módulo Contatos — Manual Operacional

> **Rota:** `/contatos`  
> **Componente principal:** `src/pages/Contatos.tsx`  
> **Tabelas:** `contacts`, `contact_attachments`, `messages`, `conversas`  
> **Edge Functions:** `sincronizar-contato-individual`, `sincronizar-fotos-contatos`, `sincronizar-nomes-contatos`, `evolution-webhook`

---

## 1. Como os Contatos Chegam ao Sistema

### 1.1 Via Webhook da Evolution API (automático)

A principal fonte de contatos é o webhook `evolution-messages-webhook`. Quando uma mensagem chega via WhatsApp:

1. O webhook recebe o payload da Evolution API
2. Extrai o JID do remetente (ex: `5547999999999@s.whatsapp.net`)
3. Converte JID em número de telefone limpo
4. Busca contato existente pelo JID na tabela `contacts`
5. Se não existe, cria automaticamente com:
   - `jid`: JID do WhatsApp
   - `phone`: número formatado
   - `name`: `pushName` da mensagem (se não estiver na blocklist)
   - `tipo_contato`: `'Outros'` (default)
   - `tipo_jid`: `'user'` ou `'group'` conforme o JID
6. Simultaneamente, cria/atualiza um registro em `conversas` vinculando ao `contact_id`

**Proteção de nomes (Blocklist):** Nomes como "RUBI", "Dr. Maikon Madeira", "Isadora", "Disparos3367", "Maikon GSS" e todos os nomes de instância cadastrados são bloqueados para evitar que nomes técnicos sobrescrevam dados reais de contatos.

### 1.2 Via Importação (manual)

Através do botão **"Importar Contatos"** no header da página:

- **Formatos aceitos:** `.vcf` (vCard), `.vcard`, `.csv`
- Fluxo em 4 etapas: Upload → Preview → Importing → Complete
- Detalhes na seção 4

### 1.3 Criação Manual

Não existe formulário de criação manual de contato na interface atual. Contatos são criados indiretamente ao:
- Receber mensagem via WhatsApp (webhook)
- Importar arquivo VCF/CSV
- Enviar mensagem para um número novo (via página de Contatos, cria conversa + contato implicitamente se não existir)

---

## 2. Diferença entre Contacts e Leads

| Aspecto | `contacts` | `leads` |
|---------|-----------|---------|
| **Propósito** | Contatos reais do WhatsApp com histórico de mensagens | Base de prospecção para disparos em massa |
| **Origem** | Webhook Evolution, importação, sincronização | Importação CSV/XLSX, cadastro manual |
| **JID** | Sempre tem (identificador WhatsApp) | Não tem JID |
| **Mensagens** | Vinculado a `messages` via `contact_id` | Não tem mensagens diretas |
| **Conversas** | Vinculado a `conversas` via `contact_id` | Não tem conversas |
| **Classificação** | `tipo_contato` (Paciente, Médico, etc.) | `tipo_lead` + `especialidade_id` |
| **Foto** | `profile_picture_url` (sincronizada da Evolution) | Não tem foto |
| **Uso** | Comunicação direta, SDR Zap, Contatos | Campanhas de disparo em massa |
| **Blacklist** | Não tem blacklist própria | `lead_blacklist` para disparos |
| **Tabela** | `contacts` | `leads` |

**Não há vínculo direto** entre `contacts` e `leads`. São entidades independentes. Um mesmo número pode existir em ambas as tabelas.

---

## 3. Campos de um Contato

### Tabela `contacts`

| Campo | Tipo | Editável na UI | Descrição |
|-------|------|----------------|-----------|
| `id` | UUID | ❌ | Chave primária |
| `phone` | text | ❌ | Número de telefone (unique implícito por JID) |
| `name` | text | ✅ | Nome do contato |
| `jid` | text | ❌ | Identificador WhatsApp (ex: `5547999@s.whatsapp.net`) |
| `tipo_contato` | text | ✅ | Classificação do contato (ver seção 8) |
| `observacoes` | text | ✅ | Anotações livres |
| `profile_picture_url` | text | ❌ | URL da foto do perfil (sincronizada da Evolution) |
| `tipo_jid` | text | ❌ | Tipo do JID: `user`, `group`, `broadcast`, etc. |
| `created_at` | timestamp | ❌ | Data de criação |
| `updated_at` | timestamp | ❌ | Última atualização |

### Campos editáveis no frontend

Na Coluna 2 (Ficha do Contato), o usuário pode editar:
1. **Nome Completo** — Input de texto
2. **Tipo de Contato** — Dropdown (Select)
3. **Observações** — Textarea

O **telefone** é exibido mas **não editável** (campo disabled).

Ao clicar "Salvar Alterações", apenas `name`, `tipo_contato` e `observacoes` são atualizados via `supabase.update()`.

---

## 4. Importação de Contatos (CSV, VCF)

### Fluxo de Importação

**Componente:** `ImportContactsModal` → 4 etapas:

#### Etapa 1: Upload
- Aceita arquivos `.vcf`, `.vcard`, `.csv`
- Input file com validação de extensão

#### Etapa 2: Preview
- Exibe lista de contatos parseados com nome e telefone
- Mostra badges: total de contatos, erros, duplicados ignorados
- Checkbox individual para selecionar/deselecionar contatos
- Botão "Selecionar todos" / "Desmarcar todos"

#### Etapa 3: Importing
- Barra de progresso visual (Progress component)
- Antes de inserir, busca telefones já existentes na tabela `contacts`
- Se o telefone já existe → incrementa contador `skipped`
- Cada contato novo é inserido com:
  - `phone`: número limpo
  - `name`: nome do vCard/CSV
  - `jid`: `{telefone_limpo}@s.whatsapp.net`
  - `tipo_contato`: `'importado'`
  - `tipo_jid`: `'user'`
  - `observacoes`: empresa/organização se disponível
- Inserção sequencial (1 por 1) para controle de erros

#### Etapa 4: Complete
- Resumo: X importados, Y já existentes, Z falharam
- Botão "Concluir" → fecha modal e recarrega lista

### Parsing de VCF

**Arquivo:** `src/utils/vcfParser.ts`

- Regex para encontrar blocos `BEGIN:VCARD ... END:VCARD`
- Extrai: `FN` (nome formatado), `N` (nome estruturado), `TEL` (telefones), `EMAIL`, `ORG`
- Suporta decodificação quoted-printable e UTF-8
- Usa primeiro telefone válido (≥ 8 dígitos)
- Normaliza telefones brasileiros via `formatBrazilianPhone`
- Deduplicação interna (mesmo telefone no arquivo)

### Parsing de CSV

**Arquivo:** `src/utils/parseLeadImport.ts`

- Reutiliza o mesmo parser usado na importação de leads
- Espera colunas: nome, telefone (mapeamento flexível por header)

---

## 5. Sincronização com a Evolution API

### 5.1 Sincronização de Fotos (`sincronizar-fotos-contatos`)

**Tipo:** Chamada direta (manual ou via automação)

**Lógica:**
1. Busca contatos com `profile_picture_url IS NULL` ou vazio (limit configurável, default 50)
2. Exclui grupos (`@g.us`) e broadcasts
3. Busca instâncias conectadas na Evolution API (`connectionStatus === 'open'`)
4. Para cada contato sem foto, tenta cada instância:
   - `POST /chat/fetchProfilePictureUrl/{instancia}` com `{ number: phone }`
   - Se retorna URL, atualiza `contacts.profile_picture_url` e `conversas.foto_contato`
5. Se nenhuma instância retornou foto, marca como `'NO_PICTURE'` (para não tentar novamente imediatamente)
6. Delay de 100ms entre chamadas e 50ms entre contatos (anti-rate-limit)

### 5.2 Sincronização de Nomes (`sincronizar-nomes-contatos`)

**Tipo:** Chamada direta (manual ou via automação)

**Lógica em 2 passos:**

**Passo 1 — Limpeza:**
- Remove nomes inválidos de contatos: nomes de instância, "Dr. Maikon Madeira", "RUBI", etc.
- Match exato via `IN` e match parcial via `ILIKE` para variações
- Limpa tanto em `contacts.name` quanto em `conversas.nome_contato`

**Passo 2 — Atualização:**
- Busca contatos que precisam de nome: `name IS NULL`, nome = telefone, nome na blocklist
- Para cada contato, tenta `POST /chat/findContacts/{instancia}` com múltiplos formatos de JID
- Extrai `pushName`, `name` ou `notify` do resultado
- Valida contra blocklist antes de salvar
- Atualiza `contacts.name` e `conversas.nome_contato`

### 5.3 Sincronização Individual (`sincronizar-contato-individual`)

**Tipo:** Chamada direta do frontend (ao selecionar conversa no SDR Zap)

**Lógica:**
- Recebe `contact_id` ou `phone`
- Tenta buscar foto E nome simultaneamente
- Mesma blocklist hardcoded: Isadora, Maikon, RUBI, Disparos, etc.
- Tenta múltiplos formatos de JID: `@s.whatsapp.net`, `@lid`, número puro
- Atualiza `contacts` + `conversas` (foto e nome)
- Usado para manter dados frescos quando o usuário abre uma conversa

### Blocklist de Nomes (comum a todas as funções)

```
isadoravolek, isadora volek, isadora, dr. maikon madeira, 
maikon madeira, maikon madeira gss, dr maikon, helen, iza,
dr. paulo pucci azambuja, rubi, disparos cardiologista, 
disparos3367, maikon gss, pacientesrafaela
+ todos os nomes de instância cadastrados no banco
```

---

## 6. Busca e Filtros na Página

### Layout da Página

A página usa `ResizablePanelGroup` com 3 colunas redimensionáveis:

| Coluna | Default | Conteúdo |
|--------|---------|----------|
| 1 | 20% | Lista de contatos + busca |
| 2 | 35% | Ficha do contato (edição) |
| 3 | 45% | Histórico de mensagens + chat |

A Coluna 1 pode ser **minimizada** (7%) clicando no botão de seta, expandindo as outras colunas.

### Busca

- Campo de texto com ícone de lupa
- Validação via Zod: max 100 caracteres
- Filtra em tempo real (client-side) por:
  - `name` (case insensitive, `toLowerCase().includes()`)
  - `phone` (match parcial, `includes()`)
- Sem filtro por `tipo_contato` na interface atual (diferente dos Leads)

### Ordenação

- Contatos ordenados por `created_at DESC` (mais recentes primeiro)
- Sem opção de reordenação na UI

### Realtime

- Canal Supabase Realtime `contacts-realtime` escuta INSERT, UPDATE e DELETE
- Novos contatos aparecem automaticamente no topo da lista
- Contatos editados são atualizados em tempo real (inclusive se selecionado)
- Contatos deletados são removidos da lista

---

## 7. Relação com Conversas e Mensagens

### contacts → messages (1:N)

```
contacts.id ← messages.contact_id
```

- Todas as mensagens de todas as instâncias para um contato ficam linkadas pelo `contact_id`
- Na Coluna 3 da página de Contatos, mensagens são buscadas: `messages WHERE contact_id = ?`
- Ordenadas por `created_at ASC` (cronológica)

### contacts → conversas (1:N)

```
contacts.id ← conversas.contact_id
```

- Um contato pode ter múltiplas conversas (uma por instância)
- `conversas.nome_contato` e `conversas.foto_contato` são espelhos de `contacts.name` e `contacts.profile_picture_url`
- Sincronização de foto/nome atualiza ambas as tabelas

### Envio de Mensagens pela Página de Contatos

1. Usuário seleciona contato na Coluna 1
2. Seleciona instância WhatsApp no dropdown da Coluna 3
3. O sistema busca conversa existente: `conversas WHERE contact_id = ? AND current_instance_id = ?`
4. Se não existe, cria uma nova conversa vinculando `contact_id`, `numero_contato`, `current_instance_id`
5. Envia via edge function `enviar-mensagem-evolution` ou `enviar-midia-evolution`
6. Suporta: texto, imagem, vídeo, documento e áudio (via `ChatInput` + `handleSendMedia`)

### Exibição de Mensagens

- Tipos renderizados: texto, áudio (player HTML5), imagem, vídeo, documento (com download)
- Bolha verde (from_me) à direita, bolha cinza (recebida) à esquerda
- Timestamp via `wa_timestamp` (preferencial) ou `created_at`
- Media URL extraída de `media_url` ou do `raw_payload` (fallback)

---

## 8. Tipo de Contato (`tipo_contato`)

### Valores Disponíveis na UI

| Valor | Descrição |
|-------|-----------|
| `Paciente` | Paciente do Dr. Maikon |
| `Fornecedor` | Fornecedor de materiais/serviços |
| `Parceiro` | Parceiro comercial |
| `Negociador` | Contato comercial/negociação |
| `Médico` | Outro médico |
| `Outros` | Classificação padrão |

### Valores Adicionais (gerados automaticamente)

| Valor | Origem |
|-------|--------|
| `importado` | Contatos criados via importação VCF/CSV |
| `Outros` | Default do banco (`DEFAULT 'Outros'`) |

### Uso

- Editável via dropdown na Ficha do Contato (Coluna 2)
- **Não é usado como filtro** na página de Contatos (diferente da página de Leads que filtra por especialidade)
- Não há integração com o módulo de Disparos — leads têm seu próprio campo `tipo_lead` + `especialidade_id`

---

## 9. Anexos de Contato (`contact_attachments`)

### Schema da Tabela

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | UUID | Chave primária |
| `contact_id` | UUID | FK → `contacts.id` |
| `file_name` | text | Nome original do arquivo |
| `file_url` | text | URL pública do arquivo no storage |
| `file_type` | text | MIME type (nullable) |
| `file_size` | bigint | Tamanho em bytes (nullable) |
| `uploaded_by` | UUID | Quem fez o upload (nullable) |
| `created_at` | timestamp | Data de criação |

### Comportamento no Frontend

- Exibidos na Coluna 2 (Ficha do Contato), abaixo das observações
- Lista com nome do arquivo e data formatada
- Botão "Adicionar" existe na UI mas **não tem handler implementado** — é apenas visual
- Botão de exclusão (X) existe nos cards mas **não tem handler implementado**
- Busca via `contact_attachments WHERE contact_id = ? ORDER BY created_at DESC`

### RLS

- **SELECT:** Usuários autenticados podem ver
- **INSERT:** Usuários autenticados podem inserir
- **DELETE:** Usuários autenticados podem deletar
- **UPDATE:** ❌ Não permitido

### Storage

- Bucket utilizado: `lead-attachments` (público) — compartilhado com anexos de leads
- Upload não está implementado na interface de contatos (apenas na de leads e TaskFlow)

---

## Apêndice A: Fluxo Completo de Dados de um Contato

```
WhatsApp → Evolution API → evolution-messages-webhook
    ↓
contacts (INSERT/UPDATE jid, phone, name)
    ↓
messages (INSERT mensagem com contact_id)
    ↓
conversas (INSERT/UPDATE com contact_id, nome_contato, foto_contato)
    ↓
Frontend: Realtime detecta INSERT em contacts → atualiza lista
```

## Apêndice B: Limitações Conhecidas

1. **Sem criação manual de contatos** — não existe formulário "Novo Contato"
2. **Upload de anexos não implementado** — botão "Adicionar" é visual, sem handler
3. **Sem filtro por tipo_contato** — apenas busca textual por nome/telefone
4. **Sem paginação** — carrega todos os contatos de uma vez (pode ser lento com muitos registros)
5. **Sem exclusão de contatos** — RLS não permite DELETE para usuários comuns (apenas policy inexistente)
6. **Duas tabelas de mensagens** — a página de Contatos usa `messages` (tabela nova), enquanto o SDR Zap pode usar `mensagens` (tabela legada) em alguns fluxos
7. **Sem vínculo contacts ↔ leads** — são entidades independentes, mesmo número pode existir em ambas
