-- Corrige: column "email_pending_review" does not exist
-- Executar na base de produção/staging (PostgreSQL), uma vez.
-- Alinhado com src/models/User.js (R7 — contas sem confirmar e-mail ≥ 7 dias)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_pending_review BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.email_pending_review IS 'R7 — mais de 7 dias sem confirmar email; alerta operações';
