# Módulo SDR Zap — Manual de Uso

> Última atualização: 22/03/2026

## Visão Geral

O SDR Zap (`/sdr-zap`) é a central de atendimento WhatsApp do Maikonect. Ele permite gerenciar conversas de múltiplas instâncias WhatsApp (números) em uma única tela, com chat inline completo, drag-and-drop entre instâncias e integração com Google Calendar.

---

## 1. Fluxo Completo de uma Conversa

```
Mensagem chega no WhatsApp
  ↓
Evolution API recebe e dispara webhook
  ↓
Edge function `evolution-messages-webhook` processa:
  - Cria/atualiza contato na tabela `contacts`
  - Cria/atualiza conversa na tabela `conversas`
  - Salva mensagem na tabela `messages`
  - Incrementa `unread_count` se mensagem recebida
  ↓
Supabase Realtime notifica o frontend (canal `messages-changes` e `conversas-changes`)
  ↓
SDR Zap atualiza a lista de conversas automaticamente
  ↓
Usuário clica na conversa → abre chat inline (Coluna 3)
  ↓
Sistema sincroniza histórico via Evolution API (`sincronizar-historico-mensagens`)
  ↓
Mensagens são exibidas com scroll automático para o final
  ↓
Usuário responde → mensagem enviada via `enviar-mensagem-evolution`
  ↓
Conversa pode ser:
  - Transferida para outro responsável/instância (drag-and-drop ou menu)
  - Fixada no topo da lista
  - Adicionada à blacklist
  - Excluída
  - Usada para agendar no Google Calendar (drag no ícone de calendário)
```

---

## 2. Status Possíveis de uma Conversa

| Status | Significado |
|--------|------------|
| `novo` | Conversa recém-criada, ainda não houve interação do atendente |
| `em_atendimento` | Atendente está respondendo ativamente |
| `aguardando` | Esperando resposta do contato ou ação futura |
| `finalizado` | Conversa encerrada, atendimento concluído |

### Qualificação (`status_qualificacao`)

Campo adicional para classificar a qualidade/tipo do lead na conversa. Valores livres definidos pelo atendente.

### Contagem de Não Lidas (`unread_count`)

- Incrementada automaticamente quando chega mensagem recebida (`from_me = false`)
- Zerada quando o usuário abre a conversa (via edge function `marcar-mensagens-lidas`)
- Exibida como badge numérico no card da conversa

---

## 3. Transferência de Conversa entre Responsáveis

### Via Menu de Contexto
1. Clique nos três pontos (`⋮`) no card da conversa
2. Selecione "Transferir"
3. Abre o modal `ModalAnotacaoTransferencia`
4. Escolha o novo responsável e escreva uma anotação (opcional)
5. Confirme → sistema atualiza `conversas.responsavel_atual` e `conversas.current_instance_id`
6. Notificação é enviada ao novo responsável via edge function `notificar-transferencia`

### O que acontece no banco:
```sql
-- Tabela conversas é atualizada:
UPDATE conversas SET
  current_instance_id = <nova_instancia>,
  responsavel_atual = <novo_responsavel>,
  anotacao_transferencia = <texto>,
  updated_at = now()
WHERE id = <conversa_id>;
```

**Importante:** A conversa NÃO é duplicada. O registro permanece único com o mesmo `id`. Apenas o `current_instance_id` muda. Todo o histórico de mensagens é preservado.

---

## 4. Drag-and-Drop entre Instâncias

### Como funciona:
1. Ao iniciar o arrasto de um card de conversa, aparece um overlay na parte inferior da tela
2. O overlay mostra todas as instâncias ativas como "drop zones" coloridas
3. Soltar o card sobre uma instância executa a transferência automática

### Implementação técnica:
- Usa `@dnd-kit/core` com `PointerSensor` (distância mínima de 8px para ativar)
- Colisão detectada via `pointerWithin`
- IDs dos drop zones: `instance-<uuid>` para instâncias, `action-app-<id>` para apps do círculo de ações
- Componente `DragDropInstanceOverlay` renderiza as zonas de drop
- Componente `DraggableCard` torna cada card arrastável
- Componente `DroppableColumn` define áreas que aceitam drops

### Fluxo no `handleDragEnd`:
1. Identifica o card arrastado e onde foi solto
2. Se solto em `action-app-*` → executa ação do app (ex: calendar)
3. Se solto em `instance-*` → transfere conversa para a nova instância
4. Busca o responsável vinculado à nova instância (`profiles.instancia_padrao_id`)
5. Chama `transferirConversa()` do utils
6. Recarrega lista de conversas

---

## 5. Chat Inline (Coluna 3)

### Enviar Mensagem de Texto
1. Digite no campo de texto na parte inferior
2. Pressione `Enter` para enviar (ou `Shift+Enter` para quebra de linha)
3. **Envio otimista:** a mensagem aparece imediatamente com status "PENDING"
4. Após confirmação do servidor, status muda para "SENT"
5. Se falhar, aparece ícone de erro com opção de reenviar

### Enviar Mídia (Imagem, Vídeo, Documento)
1. Clique no ícone 📎 (clipe) ao lado do campo de texto
2. Selecione o tipo: Imagem, Vídeo ou Documento
3. Escolha o(s) arquivo(s) — aceita múltiplos
4. Preview aparece acima do campo de texto com opção de legenda
5. Pressione `Enter` ou clique em enviar
6. **Limite:** 20MB por arquivo
7. Formatos aceitos:
   - Imagens: qualquer `image/*`
   - Vídeos: qualquer `video/*`
   - Documentos: `.pdf, .doc, .docx, .xls, .xlsx, .ppt, .pptx, .txt, .csv`

### Enviar Áudio
1. Clique no ícone 🎤 (microfone)
2. Conceda permissão de acesso ao microfone
3. Cronômetro aparece mostrando duração
4. Clique no ícone ⬛ para parar e enviar
5. Formato: `audio/ogg; codecs=opus`

### Arrastar e Soltar Arquivos
- Arraste arquivos diretamente para a área do chat (Coluna 3)
- Arquivos são interceptados e enviados ao `ChatInput` via `externalFiles`
- Também suporta `Ctrl+V` para colar imagens da área de transferência

### Componente `ChatInput`
- Gerencia todo o fluxo de envio (texto, mídia, áudio)
- Suporta preview multi-arquivo com legendas individuais
- Gravação de áudio nativa via `MediaRecorder`
- Drag-and-drop com contador para evitar flickering (`dragCounter`)

---

## 6. Ações Disponíveis no Menu de Cada Conversa

### Menu de Contexto (⋮) no Card da Conversa

| Ação | Descrição |
|------|-----------|
| 📌 **Fixar / Desafixar** | Fixa a conversa no topo da lista. Conversas fixadas sempre aparecem primeiro |
| 🚫 **Enviar para Blacklist** | Adiciona o contato à lista negra de disparos. Cria lead se não existir |
| 🗑️ **Excluir Conversa** | Remove a conversa do sistema (requer confirmação) |

### Ações por Mensagem (hover no balão)

| Ação | Descrição |
|------|-----------|
| 😀 **Reagir** | Envia reação com emoji (👍 ❤️ 😂 😮 😢 🙏). Botão flutuante + picker inline |
| ↩️ **Responder** | Resposta citada estilo WhatsApp. Preview aparece acima do campo de texto |
| 📋 **Copiar** | Copia o texto da mensagem para área de transferência |
| ✏️ **Editar** | Edita mensagem própria de texto. Marca como "(editada)" |
| 🗑️ **Apagar para mim** | Remove mensagem apenas da sua visualização (delete local no banco) |
| 🗑️ **Apagar para todos** | Apaga mensagem no WhatsApp para todos (apenas mensagens próprias) |

### Ações na Barra Superior do Chat

| Ação | Descrição |
|------|-----------|
| ✏️ **Editar nome** | Altera o nome do contato (salvo na tabela `contacts`) |
| 🔄 **Trocar instância de envio** | Dropdown para selecionar qual instância usar para responder |

---

## 7. Integração com Google Calendar

### Como acessar:
1. Arraste um card de conversa para o ícone do calendário no overlay de ações
2. OU clique no app "calendar" no círculo de ações (se habilitado)

### Fluxo completo:

```
1. Usuário arrasta conversa → ícone Calendar
   ↓
2. Sistema busca as últimas 10 mensagens da conversa
   ↓
3. Envia payload "verify" para o webhook do n8n:
   {
     tipo: "calendar",
     subtipo: "verify",
     messages: [...],    // últimas 10 mensagens com timestamps
     contato: "Nome",
     origem: "whatsapp",
     timezone: "America/Sao_Paulo",
     id_conversa: "uuid"
   }
   ↓
4. n8n processa com IA e retorna sugestão de agendamento
   ↓
5. Modal `CalendarConfirmModal` abre com:
   - Data/hora de início sugerida
   - Data/hora de fim sugerida
   - Título e descrição do evento
   ↓
6. Usuário confirma ou ajusta → envia payload "confirmed"
   ↓
7. n8n cria/atualiza evento no Google Calendar
   ↓
8. Toast de sucesso + modal fecha
```

### Edge functions envolvidas:
- `calendar-verify-callback`: Recebe resposta do n8n após verificação
- `calendar-confirmed-callback`: Recebe resposta do n8n após confirmação
- `calendar-webhook`: Webhook genérico para eventos de calendário

### Pré-requisitos:
- App "calendar" habilitado nas configurações (`ConfigAppsSection`)
- Webhook URL configurado em `config_global`
- n8n configurado com workflow de calendário + Google Calendar OAuth

---

## 8. View Kanban vs View de Lista

### Layout atual: Painel com 3 colunas redimensionáveis

O SDR Zap usa `ResizablePanelGroup` com 3 painéis:

| Coluna | Conteúdo | Comportamento |
|--------|----------|---------------|
| **Coluna 1 (esquerda)** | Todas as conversas filtradas por instância | Filtrável por dropdown de instâncias. Nome editável (admin). Pode ser minimizada (ícone `◀`) |
| **Coluna 2 (centro)** | "Minhas conversas" — conversas da instância padrão do usuário + atribuídas a ele | Auto-filtrada por `instancia_padrao_id` e `responsavel_atual` |
| **Coluna 3 (direita)** | Chat inline da conversa selecionada | Exibe histórico, input de mensagem, seletor de instância de envio |

### Sobre a Coluna 1:
- Filtra conversas pelas instâncias selecionadas no dropdown
- Mostra contagem de conversas: `(N)`
- Persistência: filtros e nome da coluna salvos em `localStorage`
- Botões de sincronização: 🔄 nomes e 📷 fotos

### Sobre a Coluna 2:
- Mostra conversas onde:
  - `orig_instance_id` = instância padrão do usuário, OU
  - `current_instance_id` = instância padrão do usuário, OU
  - `responsavel_atual` = ID do usuário logado
- Tem campo de pesquisa próprio

### Redimensionamento:
- Padrão: Coluna 1 = 28%, Coluna 2 = 28%, Coluna 3 = 44%
- Coluna 1 pode ser minimizada (ícone ◀ na divisa)
- Tamanhos mínimos/máximos definidos para evitar colapso

> **Nota:** Não existe uma view Kanban separada. O layout é fixo em 3 colunas com painéis redimensionáveis. O aspecto "Kanban" vem do drag-and-drop de cards entre instâncias.

---

## 9. Filtros Disponíveis

### Coluna 1 — Filtro de Instâncias
- **Dropdown de Instâncias:** Seleciona quais instâncias mostrar
- Cada instância tem cor de identificação
- Inclui opção "Instâncias Deletadas" (conversas de instâncias removidas)
- Se nenhuma instância selecionada → coluna vazia
- Filtros persistem em `localStorage` entre sessões

### Pesquisa (ambas as colunas)
- Campo de busca no topo de cada coluna
- Busca por **nome** do contato (case-insensitive)
- Busca por **número** de telefone (apenas dígitos)
- Filtro aplicado em tempo real conforme digita

### Ordenação automática
1. **Conversas fixadas** sempre no topo
2. **Última interação** mais recente primeiro
3. Dentro do mesmo grupo, ordem cronológica decrescente

### Nova Conversa
- Botão ➕ abre modal para digitar número
- Sistema verifica se já existe conversa com aquele número
- Se existe: seleciona automaticamente
- Se não existe: cria contato + conversa vinculada à instância padrão

---

## 10. Como Funciona o Realtime

### Canais Supabase Realtime ativos:

| Canal | Tabela | Evento | O que faz |
|-------|--------|--------|-----------|
| `messages-changes` | `messages` | INSERT | Recarrega lista de conversas (nova mensagem chegou) |
| `conversas-changes` | `conversas` | * (todos) | Recarrega lista de conversas (status/transferência mudou) |
| `instancias-changes` | `instancias_whatsapp` | * (todos) | Recarrega instâncias (nova instância criada/atualizada) |
| `contacts-changes` | `contacts` | UPDATE | Recarrega conversas (nome/foto do contato atualizado) |
| `messages-{contactId}-{instanciaId}` | `messages` | INSERT + DELETE | Adiciona/remove mensagem no chat aberto em tempo real |
| `reactions-{contactId}` | `message_reactions` | * (todos) | Atualiza reações nas mensagens em tempo real |

### Lógica de deduplicação no chat:
Quando uma mensagem chega via realtime:
1. Verifica se já existe pelo `id` ou `wa_message_id`
2. Se é mensagem enviada (`from_me`), busca mensagem otimista pendente para substituir
3. Compara por tipo + instância + proximidade de timestamp (±2 min)
4. Se a mensagem nova tem `reply context` e a existente não, substitui

### Polling complementar:
- Status das instâncias de envio: polling a cada **5 segundos** via `fetchInstanciasEnvio()`
- Chama `listar-instancias-evolution` para obter `connectionStatus` real

### Sincronização ao abrir conversa:
Quando o usuário seleciona uma conversa:
1. Edge function `sincronizar-historico-mensagens` busca mensagens da Evolution API
2. Sincroniza nomes e fotos via `sincronizar-contato-individual`
3. Marca mensagens como lidas via `marcar-mensagens-lidas`
4. Suporta paginação (50 mensagens iniciais, botão "Carregar mais")

---

## Glossário

| Termo | Significado |
|-------|------------|
| **Instância** | Um número de WhatsApp conectado via Evolution API |
| **Instância padrão** | Instância principal atribuída ao usuário (`profiles.instancia_padrao_id`) |
| **current_instance_id** | Instância que está atendendo a conversa atualmente |
| **orig_instance_id** | Instância original onde a conversa começou |
| **JID** | Jabber ID — identificador do WhatsApp (ex: `5547999999999@s.whatsapp.net`) |
| **Envio otimista** | Mensagem aparece instantaneamente na UI antes da confirmação do servidor |
| **from_me** | Booleano que indica se a mensagem foi enviada (`true`) ou recebida (`false`) |
| **wa_message_id** | ID único da mensagem no WhatsApp, usado para deduplicação |
| **Blacklist** | Lista negra — contatos que não devem receber disparos em massa |
