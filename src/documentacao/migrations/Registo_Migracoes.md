# Registo — `migrations/*.js`

Ordem **lexicográfica** do nome do ficheiro = ordem de execução. Estado em `_schema_migrations(name)`.

| Ficheiro | Resumo |
|----------|--------|
| `20260208150000-baseline-create-missing-tables.js` | Se `sessions` já existir, acrescenta colunas telecom/RTC mínimas com `IF NOT EXISTS`; depois `sequelize.sync({ alter: false })` para criar o que falta face aos modelos. |
| `20260208150100-patch-users-email-pending-review.js` | Coluna `users.email_pending_review` (R7). |
| `20260208150200-patch-transaction-ledger-idempotency-index.js` | Remove unique global em `idempotency_key`; índice único parcial onde `idempotency_key IS NOT NULL`. |
| `20260306120000-create-bot-conversation-flow-states.js` | Tabela `bot_conversation_flow_states` (estado do motor Anthropic por conversa). |
| `20260307180000-session-live-agora-fields.js` | Colunas live Agora em `sessions` (`provider`, `channel_name`, UIDs, `rtc_live_status`, índice em `channel_name`). |
| `20260308140000-session-telecom-unified.js` | Unificação telecom: `telecom_provider`, `provider_channel_id`, renomeações/migração de dados a partir de colunas antigas, minutos cronômetro em `INTEGER`. |
| `20260506120000-payment-order-mp-checkout-fields.js` | `payment_orders`: `mp_transaction_amount`, `checkout_context` (JSONB) para MP transparente. |
| `20260509120000-audit-logs-admin-id-nullable.js` | `audit_logs.admin_id` passa a permitir NULL (eventos iniciados pelo cliente). |
| `20260510120000-phase3-specialist-profile-schedule-status-log.js` | Fase 3 vitrine/agenda/perfil de taróloga: colunas públicas (`greeting_audio_url`, `presentation_video_url`, `experience_years`, `timezone`) em `specialists`; tabelas `specialist_schedules` e `specialist_status_logs`; renomeação `years_experience` → `experience_years` quando existir. |

**SQL auxiliar** (execução manual): `scripts/sql/*.sql` — ver `documentacao/scripts/Registo_Scripts.md`.
