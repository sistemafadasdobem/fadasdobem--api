# 🌌 Plataforma Fadas do Bem — Core Engine v1.0

**Pacote técnico:** `fadasdobem--api` · Node.js **≥ 18** · Express · Sequelize · PostgreSQL · Redis · BullMQ  

Este repositório é o **motor de backend** da operação Nice: pré-atendimento, consultas ao vivo com cobrança minuto‑a‑minuto, finanças de dupla entrada, integrações de telecomunicação e IA conversacional atrás dos canais WhatsApp/App.

---

## Resumo Executivo

A Plataforma Fadas do Bem é uma **infraestrutura completa de atendimento consultivo** orientada ao tempo real:

- Clientes integram‑se através de **autenticação forte**, níveis dinâmicos de preço, **saldo carteira**, **consultas multimodais** (texto · voz · vídeo na web ou telefonia) e **reviews** formais ligadas ao ciclo de sessão.
- O **cronômetro comercial “2+X+2”**, o **consumo económico** e o **bloqueio duro quando o saldo esgota** são enforced no servidor — não apenas no cliente.
- **Mercado Pago**, **Mercado Ledger** (`transaction_ledger`) e webhooks garantem trilhos de pagamento auditáveis, com extensibilidade para repasses PIX e relatórios de gestão.

O Core Engine está desenhado para correr atrás do **Easypanel** ou qualquer hospedeiro compatível (`npm run start`), com migrações automáticas na subida opcional pelo `app.js`, filas assimétricas e workers dedicados onde necessário.

---

## Destaques de Inteligência (Claude / Anthropic)

- **Skill de intervenção em crise (`trigger_crisis_intervention`)** — ferramentas no modelo Claude que, quando acionadas, disparam alerta contextual ao Chatwoot (nota privada à equipa Nice) antes de responder à utilizadora final, preservando segurança e escalação humana.
- **Histórico e memória de contexto** — enriquece respostas com histórico de conversa recuperado através do pipeline Chatwoot + motor Anthropic, mantendo coerência no diálogo e reduzindo repetições.
- **Agente comercial estruturado (WhatsApp / Lead FSM)** — fluxos guiados por estados máquina (menus, botões Evolution, PIX real, webhook Mercado Pago e transição automática quando o pagamento é captado), combinando prompts centralizados e armazenamento de estado onde aplicável (`bot_conversation_flow_states`).

---

## Destaques de Confiabilidade (Arquitetura)

| Pilar | Papel técnico |
|--------|----------------|
| **Redis** | Mutex efémero **`SET specialist_mutex:{id} … NX EX`** na liquidação pós‑pagamento **e no `POST /api/v1/queues`**: corrida distribuída evitada tanto em reservas económicas como na entrada/atribuição de fila · TTL curto garante recuperação após falhas. |
| **BullMQ · mensageria** | **Fault‑Tolerant com Transactional Outbox e Auto‑Reconciliation** — fila **`delivery-queue`**. O registo **`pending_deliveries`** é escrito na **mesma transação** Postgres do pagamento; o enqueue só ocorre **após commit** · jobs `deliver-chatwoot` com **retry exponencial**. **Shutdown gracioso** (`SIGTERM`/`SIGINT`): fecha HTTP → **`worker.close()`** → **`queue.close()`**. **Scheduler BullMQ (`upsertJobScheduler`)**: job **`outbox-sweep` a cada 30 min** re‑enfileira entradas **`PENDING` com `created_at` > 10 min** (o **`jobId` = UUID** evita duplicidade se o job ainda estiver no Redis). Falhas terminais → nota privada Chatwoot. |
| **Ledger (razão)** | Todas as movimentações monetárias materializadas em **`transaction_ledger`** com **`debit_account_id`** e **`credit_account_id`** sempre preenchidos, montantes positivos, metadados e chaves **`idempotency_key`** onde importa reconciliar webhooks Mercado Pago. |

Cofre bruto **`payment_orders.raw_webhook_payload`** permite reconstruir qualquer notificação de gateway já recebida.

---

## Veredito de integridade (CTO — core engine)

Declarado **[100% READY]** para este backend quanto aos pilares fechados em ciclo CTO:

| Pilar | Estado |
|--------|--------|
| **Consumo PACOTE × carteira** | Trilhos fixados ao **`POST /sessions`** (`billing_track`); PACOTE debita apenas **`CLIENT_PACOTE_ESCROW`** + encerra lote (**`remaining_amount = 0`**, **`consumed_at`**) ao **`telecom COMPLETED`**. |
| **Piso 15 min (automático estrito)** | Após **`COMPLETED`**, só se **`ended_reason_code ∈ SESSION_TECH_FLOOR_ELIGIBLE_END_REASONS`** e **`paid_minutes_used < SESSION_MINIMUM_FLOOR_MINUTES`** (`business.config`; override env `SESSION_TECH_FLOOR_ELIGIBLE_END_REASONS`). |
| **Mutex anti-atropelo fila** | **`POST /api/v1/queues`** protegido com o mesmo **`specialist_mutex`** Redis (TTL 45s). |
| **Webhook Mercado Pago** | **`validateMercadoPagoWebhook`** (`x-signature` HMAC **`MP_WEBHOOK_SECRET`**) — assinatura inválida → **401**. |

> Executar migrações **`20260506141500-add-ledger-reference-credit-expiry.js`** (enum ledger `CREDIT_EXPIRY`) e **`20260617120000-billing-pacote-escrow-and-session-track.js`** antes do deploy (`npm run migrate`).

---

## Módulos Ativos


### [Financeiro]

- Checkout **Mercado Pago Transparente**: **PIX** e **cartão** (Bricks), `external_reference` como âncora de idempotência.
- Webhook HTTP **processado antes da resposta 2xx**, para que cenários recuperáveis (mutex ocupado · Redis transitório · pressão Postgres) regressam **`503`** e o gateway repete oficialmente.
- Após autorização registos **`PAYMENT_ACCREDITED`**, reserva física Postgres da especialista (quando há `checkout_context.specialist_id`) e **`PendingDelivery`** (payload T8) na mesma transação.
- Reversões e chargebacks atualizam lotes **`client_credit_lots`** quando aplicável (`REFUND`, `CHARGEBACK` no Ledger).
- **Piso económico de 15 minutos** configurável (`SESSION_MINIMUM_FLOOR_MINUTES`): créditos **`FLOOR_COMPENSATION`** proporcionais a `MAX(0, floor − minutos_pagos_consumidos_snapshot)` quando a sessão fecha com motivos elegíveis (`business.config`).
- **Liquidações manuais** via API interna (ex.: comandos Chatwoot) usando `approveManualAttendancePayment`.
- **Liquidação comercial pós‑telecom COMPLETED (`economics_settled_at`):** carteira **`CLIENT_WALLET`** **ou** conta segregada **`CLIENT_PACOTE_ESCROW`** (consumo primeiro por lote PACOTE na sessão, depois avulso) · débitos **`SESSION_CONSUMPTION`** até o tarifável da sessão; em pacotes, remanescente da reserva económica da sessão segue **`CREDIT_EXPIRY`** → **`PLATFORM_REVENUE`** (queima pós-consulta) · splits **`COMMISSION_SPLIT`** conforme **`specialist_commission_pct_snapshot`**.
- **`POST /api/v1/payouts/request`** · **`GET /api/v1/payouts/me`** — pedidos PIX da taróloga com validação prévia no ledger (`SPECIALIST_EARNINGS` menos reserva de pedidos abertos legíveis pelo serviço).
- **`PATCH /api/v1/sessions/:id/ritual`** — mensagem **`post_session_message`** (≤ 1500) pela tarólogo titular quando a sessão está encerrada à luz telecom/lifecycle · **`POST …/review`** com middleware **`CLIENTE`** explícito.
- **Nova rota Gestora Nice:** **`GET /api/v1/admin/finance/transactions`** — extrato global do razão paginável (filtros `reference_type`, `occurred_from` / `occurred_to`).
- **`GET /api/v1/admin/finance/dashboard`** — agregações rápidas de pedidos pagos versus soma carteiras cache.

### [Telecom]

- **Agora.io RTC** (`/sessions/:id/token`) — vídeo · voz web (canal determinístico por sessão · UID BIGINT · token publisher 1‑a‑1 · webhooks **NCS 103 / 104** para join/leave e durações).
- **Intelbras Wide Voice REST** (`/sessions/intelbras-webhook`) — normalização opcional aos mesmos enums de sessão onde integrado por telefone.
- **Cronômetro 2+X+2** — zona grátis apresentada antes/depois do bloco cobrado, **WARNING** antes do zero, **`BillingEngine`** incremental com **hard‑cut ao esgotamento** e motivos estruturais (`BALANCE_ZERO`, `HARD_CUT_BALANCE_ZERO`, etc.).

### [Segurança]

- **JWT access + refresh** com rotação e revogação de dispositivo (`OTP` onde aplicável).
- **Step‑up JWT** opcional (**janela de cinco minutos** para dados sensíveis / alterações de cadastro forte).
- **Identidade oficial em quatro níveis nomeados** durante registo cliente (Nome legal completo · Nome público oficial · tratamento público opcional · apelido carinhoso) + **DOB obrigatório** com verificação de elegibilidade 18+/formato.
- Papéis: **CLIENTE · TARÓLOGA · GESTORA (+ atendente técnico Chatwoot)** segregados pelo middleware JWT e validações intra‑serviço.

### [Operacional]

- **Filas Inteligentes** (`/api/v1/queues`) · **promoção ao encerramento de sessão telecom** quando `COMPLETED` · **salas Socket.io** nomeadas (`subscribed_specialist_queue`).
- **Leads Agenda** — tabela **`leads`**, `interested_specialist_id`, notificações e **AuditLog** em retomadas automáticas quando a especialista regressa ONLINE.
- **Chatwoot** — Slash commands escritos apenas por agente humano (**não são encaminhados à IA**) — lista completa mais abaixo no *Manual da Atendente*.
- **Evolution Admin** auxiliar ao painel (instâncias Evolution API / infra WhatsApp onde aplicável).
- **Reviews** estruturais (**`POST /api/v1/sessions/:id/review`**) apenas pela titular cliente com `audit_logs.action = SESSION_CLIENT_REVIEW_SUBMIT`.

---

## Manual da Atendente (Slash Commands Chatwoot)

| Comando | Efeito operacional conciso |
|---------|----------------------------|
| **`/buscar_cliente`** | Resolve o contacto da conversa em **User + Client**, mostra nível de preço atual, carteira (**saldo líquido**), lotes disponíveis, histórico de sessões relevantes por nota privada. |
| **`/gerar_link`** **ou** **`/gerar_link <uuid>`** | Cria **`Session`** com status **READY**, modalidade **VIDEO**, especialista (**UUID explícito** ou inferida pela taróloga **assignee** no Chatwoot), gera **token Agora RTC** e leave private note com link **`FRONTEND_URL/sala`** e parâmetros de canal/token. |
| **`/lancar_pagamento …`** | Lançamento manual económico usando `paymentsService.approveManualAttendancePayment` (**carteira cliente** + Ledger + **`ClientCreditLot`**) segundo catálogo de pacotes (**`payments.constants`**) ou valor avulso. |
| **`/ver_tarologas`** | Lista **tarólogas ≠ OFFLINE** com estado público atual e primeira sessão telecom ainda **`PENDING`/`ACTIVE`/`WARNING`** se existente (útil antes de distribuir clientes VIP). |

> Nota técnica: qualquer comando desconhecido devolve sugestões automáticas (string `SLASH_HELP` em `chatwoot.commands.js`).

---

## Novos endpoints (fechaamento técnico)

| Verbo · Path | Segurança | Descrição |
|--------------|-----------|-----------|
| **`POST /api/v1/sessions/:id/review`** | JWT Bearer + **`requireClienteRole`** (**CLIENTE** titular) | **`rating`** 1‑5 inteiro · **`comment`** opcional até 4 000 chars · **`is_public`** default `true`. Uma avaliação por sessão. Só após encerramento elegível (critérios em código). |
| **`PATCH /api/v1/sessions/:id/ritual`** | JWT **TAROLOGA** + titular **`session.specialist_id`** | **`post_session_message`** (body) até **1500** caracteres → coluna **`sessions.post_session_message`**. |
| **`POST /api/v1/payouts/request`** · **`GET /api/v1/payouts/me`** | JWT **TAROLOGA** | Saque solicitado apenas com saldo **disponível** no ledger (**`SPECIALIST_EARNINGS`** menos pedidos já reservados). Histórico com `pix_key`, `processed_at`, estados. |
| **`GET /api/v1/admin/finance/transactions`** | JWT **GESTORA** apenas | Lista paginação estável (**`limit` 1‑200**, **`offset`**) com filtros **`reference_type`**, **`occurred_from`/`occurred_to` (ISO‑8601)**. Cada item expande lado **debitante** vs **credor** (**tipos conta**, cliente/taróloga associadas quando disponíveis nos `ledger_accounts`). |

---

## Executar rapidamente · dependências infra

```bash
cp .env.example .env   # Postgres · JWT · MP · Agora · Chatwoot · Redis obrigatório para filas Redis/Mutex quando pagamentos com especialista são usados …
npm install
npm run migrate        # modo CLI que fecha Sequelize no fim
npm run dev            # desenvolvimento (node --watch)
```

Probes rápidos: **`GET /ping`**, **`GET /health`** (ou **`/api/v1/health`**) · Coleções exemplo em **`src/postman/`** · modelo relacional granular em **`src/documentacao/`**.

Workers BullMQ (processo com **`DELIVERY_QUEUE_WORKER=true`**): consome `delivery-queue`, regista **scheduler idempotente** `pending-deliveries-outbox-sweep` (sweep 30 min / “velhos” 10 min) e partilha o **shutdown gracioso** com o HTTP. Variáveis: **`GRACEFUL_SHUTDOWN_MS`** (default lógico 28 s, tecto 120 s) — deadline antes de `exit(1)` se o dreno não concluir. Em cluster, **uma réplica** worker; restantes só produtores HTTP.

---

## Status das Fases (Backend apenas)

Declarado oficialmente pela equipa CTO:

| Marco | Estado |
|------|--------|
| **Fase 1 · Fundamentos de dados · LGPD‑ready modeling** | **100% BACKEND READY** |
| **Fase 2 · Autenticação · vitrine económica** | **100% BACKEND READY** |
| **Fase 3 · Telecom unificado · filas vivo** | **100% BACKEND READY** |
| **Fase 5 · Canal WhatsApp FSM IA · pagamentos assimétricos confiáveis** | **100% BACKEND READY** |

> A **camada cliente web/app** será construída a montante destas APIs já congeladas e versionadas (**`/api/v1/*`** como fronteira oficial).

---

*Documentação de campos físicos modelo persistidos continua dispersa sob **`src/documentacao/models`** — sempre actualizar aquele dossier sempre que migrações ampliarem o esquema.*
