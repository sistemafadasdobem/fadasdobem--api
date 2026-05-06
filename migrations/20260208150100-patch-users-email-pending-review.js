'use strict';

module.exports = {
  async up({ sequelize }) {
    await sequelize.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS email_pending_review BOOLEAN NOT NULL DEFAULT false;
    `);

    await sequelize.query(`
      COMMENT ON COLUMN users.email_pending_review IS 'R7 — mais de 7 dias sem confirmar email; alerta operações';
    `);
  },
};
