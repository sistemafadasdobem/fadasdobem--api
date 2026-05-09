'use strict';

/**
 * Campos adicionais para Checkout Transparente MP (espelho bruto/líquido + contexto do pacote).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE payment_orders
        ADD COLUMN IF NOT EXISTS mp_transaction_amount DECIMAL(14, 4) NULL;
    `);
    await queryInterface.sequelize.query(`
      COMMENT ON COLUMN payment_orders.mp_transaction_amount IS
        'Valor bruto reportado pelo MP em transaction_amount (conciliação).';
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE payment_orders
        ADD COLUMN IF NOT EXISTS checkout_context JSONB NULL;
    `);
    await queryInterface.sequelize.query(`
      COMMENT ON COLUMN payment_orders.checkout_context IS
        'Metadados do checkout (package_id, credit_type, etc.) — não confundir com raw_webhook_payload.';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE payment_orders DROP COLUMN IF EXISTS mp_transaction_amount;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE payment_orders DROP COLUMN IF EXISTS checkout_context;
    `);
  },
};
