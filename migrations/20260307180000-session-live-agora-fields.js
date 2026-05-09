'use strict';

/**
 * Fase 5 — Sessões ao vivo (RTC / Agora NCS).
 * `provider`: AGORA | INTELBRAS | WHATSAPP
 * `rtc_live_status`: ciclo RTC (PENDING→ACTIVE→COMPLETED|ERROR), independente do `sessions.status`.
 */
module.exports = {
  async up({ sequelize }) {
    await sequelize.query(`
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS provider VARCHAR(24);
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS channel_name VARCHAR(128);
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS agora_uid_client BIGINT;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS agora_uid_specialist BIGINT;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS rtc_live_status VARCHAR(32);
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS rtc_end_reason VARCHAR(512);
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS rtc_duration_seconds INTEGER;
    `);

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS sessions_channel_name_live_idx
      ON sessions (channel_name)
      WHERE deleted_at IS NULL AND channel_name IS NOT NULL;
    `);
  },
};
