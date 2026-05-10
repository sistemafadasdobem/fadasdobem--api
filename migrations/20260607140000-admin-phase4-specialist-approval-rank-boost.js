'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE specialists
        ADD COLUMN IF NOT EXISTS registration_approval_status VARCHAR(16) NOT NULL DEFAULT 'APPROVED',
        ADD COLUMN IF NOT EXISTS registration_reviewed_at TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS rank_boost_multiplier DECIMAL(10, 4) NOT NULL DEFAULT 1.0000;
      UPDATE specialists SET registration_approval_status = 'APPROVED' WHERE registration_approval_status IS NULL OR registration_approval_status = '';
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE specialists
        DROP CONSTRAINT IF EXISTS specialists_registration_approval_status_chk;
      ALTER TABLE specialists
        ADD CONSTRAINT specialists_registration_approval_status_chk
        CHECK (registration_approval_status IN ('PENDING', 'APPROVED', 'REJECTED'));
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE specialists
        DROP CONSTRAINT IF EXISTS specialists_registration_approval_status_chk;
      ALTER TABLE specialists
        DROP COLUMN IF EXISTS rank_boost_multiplier,
        DROP COLUMN IF EXISTS registration_reviewed_at,
        DROP COLUMN IF EXISTS registration_approval_status;
    `);
  },
};
