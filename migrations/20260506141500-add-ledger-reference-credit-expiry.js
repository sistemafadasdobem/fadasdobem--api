'use strict';

/**
 * Ledger: queima/remanescente de pacotes usa `reference_type = CREDIT_EXPIRY` (Session economics).
 */
module.exports = {
  async up({ sequelize }) {
    await sequelize.query(`
      DO $$
      BEGIN
        ALTER TYPE "enum_transaction_ledger_reference_type" ADD VALUE 'CREDIT_EXPIRY';
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `);
  },

  async down() {},
};
