'use strict';

/**
 * Trilhos PACOTE vs carteira: conta `CLIENT_PACOTE_ESCROW`, vínculo sessão↔lote, modalidades por lote.
 */
module.exports = {
  async up({ sequelize }) {
    await sequelize.query(`
      DO $$
      BEGIN
        ALTER TYPE "enum_ledger_accounts_account_type" ADD VALUE 'CLIENT_PACOTE_ESCROW';
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `);

    await sequelize.query(`
      ALTER TABLE sessions
        ADD COLUMN IF NOT EXISTS billing_track VARCHAR(36),
        ADD COLUMN IF NOT EXISTS consumption_credit_lot_id UUID,
        ADD COLUMN IF NOT EXISTS pacote_opening_remaining_snapshot DECIMAL(14, 4);
    `);

    await sequelize.query(`
      ALTER TABLE client_credit_lots
        ADD COLUMN IF NOT EXISTS consumption_modalities JSONB,
        ADD COLUMN IF NOT EXISTS binding_session_id UUID,
        ADD COLUMN IF NOT EXISTS pacote_closure_session_id UUID;
    `);

    await sequelize.query(`
      ALTER TABLE client_credit_lots
        DROP CONSTRAINT IF EXISTS client_credit_lots_binding_session_id_fkey;
    `);
    await sequelize.query(`
      ALTER TABLE client_credit_lots
        ADD CONSTRAINT client_credit_lots_binding_session_id_fkey
        FOREIGN KEY (binding_session_id) REFERENCES sessions (id)
        ON DELETE SET NULL ON UPDATE CASCADE;
    `);

    await sequelize.query(`
      ALTER TABLE sessions
        DROP CONSTRAINT IF EXISTS sessions_consumption_credit_lot_id_fkey;
    `);
    await sequelize.query(`
      ALTER TABLE sessions
        ADD CONSTRAINT sessions_consumption_credit_lot_id_fkey
        FOREIGN KEY (consumption_credit_lot_id) REFERENCES client_credit_lots (id)
        ON DELETE SET NULL ON UPDATE CASCADE;
    `);

    await sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS client_credit_lots_one_live_binding_uidx
        ON client_credit_lots (binding_session_id)
        WHERE deleted_at IS NULL AND binding_session_id IS NOT NULL;
    `);
  },

  async down() {
    /* No-op — ENUM / dados tornam downgrade arriscado. */
  },
};
