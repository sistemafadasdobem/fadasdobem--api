'use strict';

/**
 * ISSUE-Audit-01: eventos de segurança iniciados pelo cliente (login/register)
 * usam admin_id NULL — o Sequelize já permite, mas instalações antigas podem
 * ter NOT NULL na coluna.
 */
module.exports = {
  async up({ sequelize }) {
    await sequelize.query(`
      ALTER TABLE "audit_logs" ALTER COLUMN "admin_id" DROP NOT NULL;
    `);
  },
};
