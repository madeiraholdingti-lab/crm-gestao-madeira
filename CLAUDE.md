# Maikonect CRM — Contexto do Projeto

## Visão Geral

CRM médico personalizado para o Dr. Maikon Madeira (cirurgião cardíaco, Itajaí/SC).
Plataforma chamada **Maikonect** — centraliza comunicação WhatsApp, disparos em massa,
gestão de tarefas internas e agenda médica em uma interface única.

Desenvolvedor responsável: **Raul Seixas** (consultor técnico).
Desenvolvedor anterior: Everton (travou o desenvolvimento — carta branca para Raul mexer).
Secretárias da clínica: **Iza** e **Mariana** (usuárias ativas do sistema).

---

## Stack Técnica

**Frontend**
- React 18.3 + TypeScript 5.8, build com Vite
- Roteamento: react-router-dom v6
- UI: shadcn/ui + Radix UI + Tailwind CSS 3
- Estado servidor: TanStack Query v5
- Formulários: react-hook-form + zod
- Drag & Drop: @dnd-kit/core + sortable
- Charts: recharts
- Datas: date-fns + date-fns-tz (fuso: America/Sao_Paulo)
- Toasts: sempre usar `sonner` (import de `sonner`, não do shadcn)
- Plataforma: Lovable Cloud (frontend deploy)

**Backend**
- Supabase: Postgres + Auth + Edge Functions (Deno) + Realtime
- WhatsApp: Evolution API (multi-instância)
- Automação: n8n (webhooks bidirecionais)
- Calendário: Google Calendar (OAuth2)
- Deploy edge functions: Supabase Cloud

---

## Estrutura de Pastas

```
src/
  pages/          # Páginas principais (uma por rota)
  pages/disparos/ # Sub-páginas do módulo de disparos
  components/     # Componentes reutilizáveis
  components/taskflow/  # Componentes do board de tarefas
  components/ui/  # Componentes shadcn/ui (NÃO editar diretamente)
  hooks/          # Custom hooks React
  contexts/       # Context providers
  utils/          # Funções utilitárias
  integrations/supabase/  # Client e tipos gerados do Supabase
    client.ts     # SEMPRE importar daqui: import { supabase } from "@/integrations/supabase/client"
    types.ts      # Tipos gerados automaticamente — NÃO editar manualmente

supabase/
  functions/      # Edge Functions (Deno/TypeScript)
  migrations/     # Migrações SQL em ordem cronológica
```

---

## Convenções Obrigatórias

**Imports**
- Supabase client: sempre `import { supabase } from "@/integrations/supabase/client"`
- Sempre usar alias `@/` para imports internos
- Tipos do banco: sempre de `@/integrations/supabase/types`

**Componentes**
- Seguir padrão shadcn/ui existente no projeto
- Toasts de feedback: `import { toast } from "sonner"` — nunca o toast do shadcn
- Ícones: `lucide-react` (já instalado)

**Edge Functions (Deno)**
- Sempre incluir CORS headers:
```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
// Handler para OPTIONS (preflight)
if (req.method === 'OPTIONS') {
  return new Response('ok', { headers: corsHeaders })
}
```
- Usar `Deno.env.get('SUPABASE_URL')` e `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` para acesso admin

**Banco de dados**
- Nunca editar `types.ts` manualmente — é gerado pelo Supabase
- Migrações: criar arquivo em `supabase/migrations/` com timestamp no nome
- RLS (Row Level Security) está ativo — considerar policies ao criar tabelas novas

---

## Roles de Usuário

| Role | Acesso |
|------|--------|
| `admin_geral` | Tudo, incluindo gestão de usuários |
| `medico` | SDR Zap, Contatos, TaskFlow, Disparos, Relatórios, IA |
| `secretaria_medica` | SDR Zap, Contatos, TaskFlow, Disparos, Relatórios, IA |
| `administrativo` | SDR Zap, Contatos, TaskFlow, Disparos, Relatórios, IA |
| `disparador` | Apenas: Home, SDR Zap, Disparos em Massa, Config Zaps, Perfil |

Roles ficam na tabela `user_roles`. Verificar com `get_user_role()` SQL function.
`NON_DISPARADOR_ROLES = ["admin_geral", "medico", "secretaria_medica", "administrativo"]`

---

## Módulos Existentes (não quebrar)

- **SDR Zap** (`/sdr-zap`): Caixa de conversas WhatsApp Kanban, chat inline completo, drag-and-drop entre instâncias, integração Google Calendar
- **Task Flow** (`/task-flow`): Board Kanban de tarefas internas com perfis, checklists, anexos, comentários
- **Disparos em Massa** (`/disparos-em-massa`): Leads, Campanhas, Envios, Blacklist + n8n
- **Disparos Agendados** (`/disparos-automaticos`): Cron via edge function
- **Contatos** (`/contatos`): CRUD + importação CSV/VCF + sync Evolution API
- **Contexto IA** (`/contexto-ia`): Scripts de IA vinculados a campanhas
- **Configurações Zaps** (`/zaps`): Gestão de instâncias Evolution API + QR Code
- **Relatórios** (`/relatorios`): CRM + exportação de leads
- **Usuários** (`/usuarios`): Gestão com aprovação e roles

**Atenção:** `src/pages/Equipe.tsx` existe mas não está roteada — não remover ainda.

---

## Tabelas Principais do Banco

```
conversas              — Conversas WA (status, qualificação, tags, responsável)
mensagens / messages   — Histórico de mensagens (dois modelos coexistindo)
contacts               — Contatos com JID, telefone, foto
instancias_whatsapp    — Instâncias Evolution API com credenciais
campanhas_disparo      — Campanhas com agendamento e configuração
campanha_envios        — Envios individuais por campanha/lead
leads                  — Base de leads para disparos
lead_blacklist         — Lista negra
task_flow_tasks        — Tarefas do board
task_flow_columns      — Colunas configuráveis do board
task_flow_profiles     — Perfis de usuário no TaskFlow
ia_scripts             — Scripts de IA com perguntas associadas
config_global          — Configurações globais (Evolution URL, webhooks)
profiles / user_roles  — Usuários e permissões
notificacoes           — Central de notificações in-app
eventos_agenda         — Eventos do Google Calendar
especialidades         — Catálogo de especialidades médicas
tipos_lead             — Tipos de lead cadastrados
```

---

## Objetivos Atuais — Sprint em Andamento

Contexto: reunião com Dr. Maikon em 18/03/2026. Dor principal: ele opera durante o dia,
sai da cirurgia sem saber quem foi respondido pelas secretárias. Faz trabalho manual
nos finais de semana para colocar tudo em ordem.

### 1. Lembrete por conversa (Follow-up) — ALTA PRIORIDADE
Dentro do SDR Zap, poder marcar uma conversa com lembrete futuro.
Ex: "me lembre de responder esse contato em 3 dias".
Notificação in-app + idealmente mensagem WhatsApp para o próprio Dr. Maikon.

### 2. Classificação de contato por perfil profissional — ALTA PRIORIDADE
Adicionar campo de classificação nos contatos: médico, diretor de hospital,
gestor, anestesista, cirurgião cardíaco, paciente, enfermeiro, etc.
Caso de uso imediato: disparar para todos os cirurgiões cardíacos sobre
evento de cirurgia cardíaca (novembro/2026).
Integrar com filtros na página de Leads/Disparos.

### 3. Filtro por categoria nos Disparos em Massa — ALTA PRIORIDADE
Na criação de campanha, poder filtrar leads por tipo/perfil profissional.
Hoje existe `filtro_tipo_lead` na tabela `campanhas_disparo` — expandir para
suportar filtro por especialidade/perfil.

### 4. Visibilidade das conversas das secretárias — ALTA PRIORIDADE
Dr. Maikon precisa ver em tempo real se Iza e Mariana estão respondendo.
Possível solução: painel de supervisão mostrando conversas abertas sem resposta
por responsável, com tempo de espera.

### 5. Tarefas integradas com atribuição para secretárias — MÉDIA PRIORIDADE
O Task Flow já existe mas o Maikon quer integração mais fluida: criar tarefa
direto de uma conversa no SDR Zap, atribuir para Iza ou Mariana, ver quem
assumiu. O Everton fez algo separado que precisa ser integrado.

### 6. Análise de sentimento / qualificação via IA — MÉDIA PRIORIDADE
IA avaliando conversas no SDR Zap: score de sentimento, sugestão de perfil do
contato, qualidade do atendimento. Base para classificação automática.

---

## Instâncias WhatsApp em Uso

- Número pessoal do Dr. Maikon (Madeira) — ~15k contatos
- Número da empresa
- Número do consultório (novo — vai ter IA)
- Número dos disparos
- Número da secretária Iza
- Número da secretária Mariana (recém contratada)

**Pendente validar:** quais dessas já estão conectadas na Evolution API no CRM.

---

## Integrações Externas

- **Evolution API**: base URL e API key em `config_global` no banco
- **n8n**: webhooks em `config_global.webhook_ia_disparos` e `webhook_ia_respondendo`
- **Google Calendar**: OAuth2, callbacks via edge functions `calendar-*`
- **Supabase Realtime**: usado para notificações e atualizações em tempo real

---

## Fluxo de Desenvolvimento

1. Para mudanças que tocam 3+ arquivos: usar plan mode antes de executar
2. Edge functions novas: sempre testar com `curl` local antes de deploy
3. Migrations: sempre criar arquivo novo, nunca editar migration existente
4. Após mudança de banco: rodar `supabase gen types` para atualizar `types.ts`
5. Commits: mensagens em português descrevendo o que foi feito

## Avisos Importantes

- Há dois modelos de mensagens coexistindo: `mensagens` e `messages` — verificar qual usar antes de implementar algo novo no chat
- `.env` tem Supabase anon key — não commitar chaves secretas/service role
- RLS ativo em todas as tabelas — ao criar tabela nova, criar policies correspondentes
- O `Equipe.tsx` existe sem rota — manter por enquanto
