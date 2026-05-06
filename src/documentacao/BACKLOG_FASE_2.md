# Backlog — Fase 2 (Auth / segurança)

Este ficheiro regista **refinamentos e hardening** que ficam fora do pacote mínimo já homologado (JWT/refresh, cadastro, limites compostos sobre *login/register/forgot-password*, auditoria dos eventos de Auth principais, *UserDevice* WEB, verificação e reenvio de e-mail, perfil cliente vía `GET/PATCH /me`, vitrine em `GET /v1/specialists`).

Para o **estado de entrega** consolidado das Fases 1 e 2, consultar também [`README.md`](./README.md) na mesma pasta.

---

## Estado face ao código atual (Maio 2026)

| ID | Estado | Observação breve |
|----|--------|-------------------|
| **ISSUE-Auth-01** (R11 reCAPTCHA) | Pendente | Não há validação Google no repositório. |
| **ISSUE-Auth-02** (R14 lista descartáveis) | Parcial | Lista estática em `src/config/disposableEmails.config.js`; sem *pipeline* automatizado nem `DISPOSABLE_LIST_URL`. |
| **ISSUE-Auth-03** (R6 quotas *forgot*) | Parcial | Implementado: **3/h** por e-mail + **10/dia** por IP (`forgotPasswordEmailHourLimiter`, `forgotPasswordIpDayLimiter`). Em falta: *cooldown* **60 s** entre pedidos pelo mesmo e-mail (persistente) e eventual chave por «origem» se for distinta do IP. |
| **ISSUE-Auth-04** (R10 `check-email`) | Pendente | Não existe `GET …/auth/check-email`; apenas limiters nos fluxos já expostos. |
| **ISSUE-Auth-05** (R8 cookies / *idle*) | Pendente | Mantém-se JWT *stateless* (access + refresh em corpo); sem cookie `httpOnly` nem *idle timeout* no servidor. |
| **ISSUE-Auth-06** (R8 e-mail novo dispositivo) | Pendente | `recordWebLoginDevice` faz `findOrCreate` e actualiza `last_seen_at`, mas **não** dispara correio quando o registo é criado pela primeira vez. |
| **ISSUE-Auth-07** (R12 re-aceite termos) | Parcial | **Registo:** `accepted_terms_version` / `accepted_terms_at` obrigatórios. **Falta:** fluxo de **nova versão** (banner obrigatório / bloqueio de compra até nova aceitação). |
| **ISSUE-Auth-08** (R15 retenção 12 m / UI Gestora) | Pendente | Sem política de purga/partição automatizada nem painel só-leitura. `correlation_id` já existe no modelo `audit_logs` para uso futuro em *tracing*. |
| **ISSUE-Audit-01** (FK `audit_logs.admin_id`) | Resolvido no modelo | Sequelize define `admin_id` **nullable**; índices em `occurred_at` e `action` presentes. Bases já criadas com `NOT NULL` antigo podem ainda precisar de `ALTER` manual. |
| **ISSUE-Device-01** (`push_token` legado) | Resolvido no modelo | Campo **`allowNull: true`** com comentário para token sintético `web:+hash`. Eventual *backfill* em dados antigos mantém‑se apenas se existirem linhas inconsistentes criadas antes da alteração. |

---

## Detalhe por tema (mantido para especificação)

### ISSUE-Auth-01 · R11 — Integrar reCAPTCHA v3 (Google)

- Validar score ≥ 0,5 nos endpoints públicos (`/login`, `/register`, `/forgot-password`, eventualmente `/reset-password`).
- *Fallback* para desafio explícito se `RECAPTCHA_BYPASS=false` em produção.

### ISSUE-Auth-02 · R14 — Actualização mensal dos domínios descartáveis

- *Pipeline* (cron ou GitHub Action) que faça *merge* de lista actualizada ou ingestão externa (`DISPOSABLE_LIST_URL`).
- *Smoke test* automatizado contra amostras conhecidas.

### ISSUE-Auth-03 · R6 — Quotas finas de «esqueci senha»

- **Feito:** 3 pedidos/hora por e‑mail e 10/dia por IP (`src/middlewares/rateLimit.middleware.js`).
- **Falta:** limite complementar conforme especificação (ex.: cooldown 60 s entre reenvios por e‑mail persistido em Redis ou tabela; distinção de «origem» ≠ IP se a especificação o exigir).

### ISSUE-Auth-04 · R10 — Limite «30 verificações/min por origem» (lookup e‑mail)

- Endpoint dedicado `GET /auth/check-email` (debounce no *front*) com *limiter* específico — ainda não implementado.

### ISSUE-Auth-05 · R8 — Sessão e cookies

- Avaliar BFF com cookies `httpOnly`, expiração por inactividade e excepção durante consulta ativa; ou rotação de *refresh* mais agressiva + *idle timeout* no cliente.

### ISSUE-Auth-06 · R8 — E-mail «novo dispositivo»

- Após `AUTH_LOGIN_SUCCESS`, quando `UserDevice.findOrCreate` criar registo novo (`created === true`), enviar template de alerta (com *link* de revogação se previsto na especificação).

### ISSUE-Auth-07 · R12 — Re-aceite de termos após nova versão

- Flag ou tabela de histórico de aceitações; bloquear compras até a versão corrente estar aceite (além do aceite inicial no registo).

### ISSUE-Auth-08 · R15 — Retenção 12 meses e visualização Gestora

- Política de purga/partição em `audit_logs`; UI do painel administrativo só leitura; *correlation_id* propagado em serviços quando existir *gateway* / *BFF*.

### ISSUE-Audit-01 · FK opcional em `audit_logs.admin_id`

- **Modelo alinhado.** Verificar apenas instalações PostgreSQL antigas que ainda tenham constrangimento `NOT NULL` na coluna.

### ISSUE-Device-01 · `push_token` obrigatório em bases legadas

- **Modelo alinhado.** Executar *backfill* `web:*` apenas onde dados legados falhem migrações ou *constraints* antigas.

---

*Última revisão: alinhamento com o código em `src/features/auth`, `src/middlewares/rateLimit.middleware.js` e modelos Sequelize.*
