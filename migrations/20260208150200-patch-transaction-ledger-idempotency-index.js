'use strict';

/**
 * UNIQUE em coluna nullable faz o Sequelize/sync(alter) emitir Postgres inválido.
 * Índice único parcial: várias linhas NULL, no máximo um valor repetido quando preenchido.
 */
module.exports = {
  async up({ sequelize }) {
    await sequelize.query(`
      ALTER TABLE transaction_ledger
        DROP CONSTRAINT IF EXISTS transaction_ledger_idempotency_key_key;
    `);

    await sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS transaction_ledger_idempotency_key_not_null_uidx
      ON transaction_ledger (idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    `);
  },
};
