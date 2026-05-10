# Documentação do pacote (`src/documentacao`)

Este diretório acompanha o **contrato de dados**, o **histórico de entregas** e o referencial normativo ao lado da implementação. O contrato campo a campo do esquema persistido permanece fragmentado em **`models/*.md`** e **`models/Relacionamentos_FKs.md`**.

Para execução, stack e diagrama ER consolidado da Fase 1, pode consultar‑se igualmente o [README na raiz do pacote](../../README.md).

---

## Estado de entrega

### Fase 1 (fundamento técnico) — **[CONCLUÍDA]**

Implementação estável dos pilares seguintes:

- Infra‑estrutura de execução (Node/Express em ambiente Easypanel, variáveis e health checks).
- Persistência PostgreSQL com Sequelize e modelo relacional conforme **`models/`**.
- Integrações **Chatwoot** e **Evolution API** expostas via *features* dedicadas e *providers* HTTP.
- Orquestração da camada **IA** (Anthropic/Claude) com histórico via Chatwoot quando aplicável.

### Fase 2 (autenticação e vitrine) — **[CONCLUÍDA]**

Funcionalidades em produção e homologação concluída:

- Autenticação **JWT / refresh token**, registo inicial e fluxos de recuperação/redefinição de senha, verificação de e‑mail em janelas definidas pela configuração, e marcação tardia de conta sem confirmação (regra operacional «e‑mail pendente»).
- **Segurança:** *rate limiting* combinado por IP e e‑mail, **audit logs** sobre ações sensíveis de Auth, política de palavra‑passe, bloqueios de domínios descartáveis e registos derivados para **sessão Web** (**UserDevices** onde aplicável).
- **Cadastro progressivo:** o modelo de dados comporta onboarding progressivo; a **actualização opcional dos campos de perfil de cliente expostos pela API** realiza‑se mediante **`PATCH /api/v1/auth/me`**, sempre com **JWT válido**. Quando a regra de produto obriga ao **completar o perfil só após pagamento/checkout**, garante‑se apenas que essa chamada permanece disponível **na mesma sessão autenticada** após o checkout — comportamento já suportado (rota registada atrás do *middleware* de autenticação).
- **Vitrine de especialistas:** listagem **`GET /api/v1/specialists`** com filtros de consulta, ordenações e inclusão eager de modalidades e oráculos para consumo pelo *front‑end*.

---

## Organização da entrega

A arquitectura **separa integrações externas** (`providers`) das **capacidades de negócio orquestradas** (`features`), sempre com **`models`** como espelho do esquema e **`utils`/`middlewares`/`config`** como camada sistémica transversal.

Esse modo de organização **mantém‑se válido para as próximas fases** — pagamentos (**Mercado Pago** / fluxos de compra), **fila inteligente**, **voz e vídeo**, e relatórios operacionais — seguindo o padrão **Controller → Service → Provider** onde o *controller* apenas transporta HTTP, o *service* concentra regras e transacções locais ao domínio, e o *provider* isola cada sistema externo.

### Camada de *Leads* e conversão para cliente

Prospectos oriundos do **Chatwoot** (sem `User`) são persistidos como **`leads`** (*paranoid*, índice único em `chatwoot_contact_id`). O webhook de mensagem faz *upsert* por contacto, actualiza `chatwoot_conversation_id`, `last_interaction_at`, `source` / `utm_data` e deixa de criar linha provisória só em `users`. A conversão transaccional **`convertLeadToClient`** em **`src/features/auth/auth.service.js`** materializa `User` + `Client`, copia campos Chatwoot/OpenAI, define `leads.status = CONVERTED` e reconcilia **`sessions`** quando o `chatwoot_conversation_id` coincide. Contrato de dados: **[`models/Lead.md`](./models/Lead.md)**.

### Provedores de IA — padrão Strategy (Chatwoot webhook)

O webhook em **`src/features/chatwoot/chatwoot.service.js`** mantém o fluxo de histórico Chatwoot → turnos em **`src/features/chatwoot/chatwoot.aiHistory.js`**. O motor é escolhido por **`ACTIVE_AI_PROVIDER`**.

- **Anthropic (produção recomendada neste pacote):** **Motor de Fluxo** persistido por conversa — `getCurrentFlowState` (log) + `generateReplyForChatwoot(historico, ultima, { accountId, conversationId })`, com estados e ferramentas declarados em **`src/features/anthropic/anthropic.workflow.config.js`** e textos estáveis em **`anthropic.messages.js`**. Ver **[`ANTHROPIC_FLOW_ENGINE.md`](./ANTHROPIC_FLOW_ENGINE.md)**.

- **OpenAI:** continua a expor **`generateReply(historico, mensagemUsuario)`** (*Chat Completions* + *tools*); o fluxo Assistants/Threads (`replyForUserPlainText` + `identity` + `openai_thread_id`) permanece para outros casos de uso.

Assim, Claude (*Messages API* + *Tool Use*) no Chatwoot acopla **estado de conversa** configurável em ficheiro sem reescrever o serviço de orquestração.

---

## Módulos principais entregues (Fase 1 + Fase 2)

| Módulo | Localização típica | Notas |
|--------|-------------------|--------|
| **Auth** | `src/features/auth/` | Registo, login, *refresh*, *logout*, recuperação/redefinição de palavra‑passe, verificação de e‑mail, `GET/PATCH /me`, constantes e utilitário de auditoria. |
| **Anthropic** | `src/features/anthropic/`, `src/providers/anthropic/` | Ciclo Claude, *prompts*, **Flow Engine** (`workflow.config`, `messages`, Redis/PG), *tools*. |
| **Evolution** | `src/features/evolution/`, `src/providers/evolution/` | Administração de instâncias Evolution API onde aplicável. |
| **Chatwoot** | `src/features/chatwoot/`, `src/providers/chatwoot/` | Webhook e cliente da API Chatwoot. |
| **Database** | `src/models/`, `src/config/database.js` | Sequelize / PostgreSQL. |
| **System** | `src/config/`, `src/middlewares/`, `app.js`, `src/routes/` | Configuração, *rate limit* de Auth, tratamento de erros, montagem Express. |
| **Utils** | `src/utils/` | `AppError`, respostas HTTP, *catchAsync*, entre outros. |

A **vitrine de especialistas** (Fase 2) está materializada na *feature* `src/features/specialists/` (`GET /api/v1/specialists`). **Provedores** adicionais (ex.: OpenAI opcional, e‑mail via Resend em `src/providers/mail/`) coexistem no repositório e suportam os fluxos dos módulos listados.

---

## Espelhos de código (além de `models/` e `features/`)

| Área | Pasta em `documentacao/` | Código correspondente |
|------|-------------------------|------------------------|
| **Features HTTP / domínio** | [`features/README.md`](./features/README.md) | `src/features/` |
| **Providers externos** | [`providers/README.md`](./providers/README.md) | `src/providers/` |
| **Middlewares Express** | [`middlewares/README.md`](./middlewares/README.md) | `src/middlewares/` |
| **Utils transversais** | [`utils/README.md`](./utils/README.md) | `src/utils/` |
| **Scripts operacionais** | [`scripts/README.md`](./scripts/README.md) | `scripts/` (raiz do pacote) |
| **Migrations** | [`migrations/README.md`](./migrations/README.md) + [`migrations/Registo_Migracoes.md`](./migrations/Registo_Migracoes.md) | `migrations/*.js`; guia operacional na raiz: [`../../migrations/README.md`](../../migrations/README.md) |

---

## Referência campo a campo e ER

Alterações físicas ao esquema devem estar reflectidas primeiro na base ou migrações, e seguidamente em **`src/documentacao/models/`** e **`models/Relacionamentos_FKs.md`**. O ER e dicionário de alto nível estão preservados no [README](../../README.md) da raiz do pacote.

---

## Backlog e próximos passos de produto

- **Fase 3 / Fase 5 (planeamento):** evoluções previstas ligadas ao **Mercado Pago**, **fluxo de compra ponta‑a‑ponta** e à **fila inteligente** de atendimento, assentes no modelo de dados já entregue (consultas em fila/sessões, *ledger*, etc.).
- Refinamentos pendentes de Auth e segurança (ex.: reCAPTCHA, quotas adicionais) encontram‑se registados formalmente em **[`BACKLOG_FASE_2.md`](./BACKLOG_FASE_2.md)**.

---

*Última actualização contextual: Fases 1 e 2 declaradas homologadas e em operação (Easypanel).*
