'use strict';

/** Lead FSM WhatsApp — pedidos PIX sem `User`; créditos liquidados na conversão. */
module.exports = {
  async up({ sequelize }) {
    await sequelize.query(`
      ALTER TABLE payment_orders ALTER COLUMN client_id DROP NOT NULL;
    `);
    await sequelize.query(`
      ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS lead_id UUID NULL
        REFERENCES leads (id);
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS payment_orders_lead_id_idx ON payment_orders (lead_id)
        WHERE lead_id IS NOT NULL AND deleted_at IS NULL;
    `);
  },
};
