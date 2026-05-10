'use strict';

module.exports = {
  async up({ sequelize }) {
    await sequelize.query(`
      ALTER TABLE sessions
        ADD COLUMN IF NOT EXISTS economics_settled_at TIMESTAMPTZ NULL;
      CREATE INDEX IF NOT EXISTS sessions_economics_settled_at_idx ON sessions (economics_settled_at);
    `);

    await sequelize.query(`
      ALTER TABLE payout_requests
        ADD COLUMN IF NOT EXISTS pix_key VARCHAR(256) NULL;
      ALTER TABLE payout_requests
        ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ NULL;
      UPDATE payout_requests SET processed_at = paid_at WHERE processed_at IS NULL AND paid_at IS NOT NULL;
    `);
  },
};
