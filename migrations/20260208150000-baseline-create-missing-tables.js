'use strict';

/**
 * Cria tabelas e tipos em falta conforme `src/models` — sem `alter` (evita SQL inválido no Postgres).
 *
 * Em bases antigas onde `sessions` já existia sem colunas telecom, `sequelize.sync()` tentava
 * criar índices (ex.: `telecom_provider`) **antes** das migrações `20260307*` — falhava com 42703.
 * Por isso, se `sessions` já existe, garantimos com `ADD COLUMN IF NOT EXISTS` o mínimo para o modelo atual.
 */
module.exports = {
  async up({ sequelize }) {
    const [[row]] = await sequelize.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'sessions'
      ) AS exists;
    `);

    if (row?.exists) {
      await sequelize.query(`
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS agora_channel_id VARCHAR(128);
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS telecom_provider VARCHAR(24);
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS provider_channel_id VARCHAR(160);
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS telecom_status VARCHAR(32);
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS agora_uid_client BIGINT;
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS agora_uid_specialist BIGINT;
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS rtc_end_reason VARCHAR(512);
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS rtc_duration_seconds INTEGER;
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS intelbras_unique_id VARCHAR(128);
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS intelbras_bridge_id VARCHAR(160);
      `);
      await sequelize.query(`
        UPDATE sessions SET telecom_status = 'PENDING'
        WHERE telecom_status IS NULL OR trim(telecom_status::text) = '';
      `);
    }

    await sequelize.sync({ alter: false, logging: false });
  },
};
