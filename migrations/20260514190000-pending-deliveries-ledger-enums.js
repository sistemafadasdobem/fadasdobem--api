'use strict';

/**
 * Ledger: PAYMENT_ACCREDITED (webhook/créditos de pagamento canônicos), FLOOR_COMPENSATION (piso mín.).
 * Outbox: pending_deliveries — mensagens pós-pagamento processadas pela fila BullMQ.
 */

module.exports = {
  async up({ sequelize }) {
    await sequelize.query(`
      DO $$
      BEGIN
        ALTER TYPE "enum_transaction_ledger_reference_type" ADD VALUE 'PAYMENT_ACCREDITED';
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `);

    await sequelize.query(`
      DO $$
      BEGIN
        ALTER TYPE "enum_transaction_ledger_reference_type" ADD VALUE 'FLOOR_COMPENSATION';
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `);

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS pending_deliveries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
        order_id UUID NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE ON UPDATE CASCADE,
        payload JSONB NOT NULL DEFAULT '{}'::JSONB,
        status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT pending_deliveries_status_chk CHECK (status IN ('PENDING', 'SENT', 'FAILED'))
      );
      CREATE INDEX IF NOT EXISTS pending_deliveries_status_idx ON pending_deliveries (status);
      CREATE INDEX IF NOT EXISTS pending_deliveries_order_id_idx ON pending_deliveries (order_id);
    `);
  },
};
