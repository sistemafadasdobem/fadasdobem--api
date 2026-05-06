-- Remediação Postgres: Sequelize sync({ alter: true }) pode falhar em colunas nullable com unique: true,
-- gerando sintaxe ALTER ... TYPE VARCHAR UNIQUE (inválida). O modelo usa índice único parcial.
-- Rode na base onde ocorreu o erro 42601, antes de subir nova versão com TransactionLedger.js corrigido.

ALTER TABLE transaction_ledger
  DROP CONSTRAINT IF EXISTS transaction_ledger_idempotency_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS transaction_ledger_idempotency_key_not_null_uidx
  ON transaction_ledger (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
