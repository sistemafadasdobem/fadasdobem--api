'use strict';

/**
 * Telecom unificado: telemetria RTC + PBX; renomeações (provider/channel/rtc_live_status)
 * quando existirem; minutos cronômetro em INTEGER.
 */
module.exports = {
  async up({ sequelize }) {
    const q = async (sql) => sequelize.query(sql);

    const [cols] = await sequelize.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sessions'
    `);
    const colSet = new Set(cols.map((c) => c.column_name));

    await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS telecom_provider VARCHAR(24);`);
    if (colSet.has('provider')) {
      await q(`UPDATE sessions SET telecom_provider = provider WHERE telecom_provider IS NULL AND provider IS NOT NULL`);
      await q(`ALTER TABLE sessions DROP COLUMN provider;`);
      colSet.delete('provider');
    }

    await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS provider_channel_id VARCHAR(160);`);
    if (colSet.has('channel_name')) {
      await q(`
        UPDATE sessions
        SET provider_channel_id = COALESCE(
          NULLIF(trim(provider_channel_id::text), ''),
          NULLIF(trim(channel_name::text), '')
        );
      `);
      await q(`ALTER TABLE sessions DROP COLUMN channel_name;`);
      colSet.delete('channel_name');
    }
    // Em bases antigas `agora_channel_id` pode não existir (modelo vs migrações).
    if (colSet.has('agora_channel_id')) {
      await q(`
        UPDATE sessions
        SET provider_channel_id = COALESCE(
          NULLIF(trim(provider_channel_id::text), ''),
          NULLIF(trim(agora_channel_id::text), '')
        )
        WHERE provider_channel_id IS NULL OR trim(provider_channel_id::text) = '';
      `);
    }

    await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS telecom_status VARCHAR(32);`);
    if (colSet.has('rtc_live_status')) {
      await q(`UPDATE sessions SET telecom_status = rtc_live_status WHERE telecom_status IS NULL AND rtc_live_status IS NOT NULL`);
      await q(`ALTER TABLE sessions DROP COLUMN rtc_live_status;`);
      colSet.delete('rtc_live_status');
    }
    await q(`UPDATE sessions SET telecom_status = 'PENDING' WHERE telecom_status IS NULL OR trim(telecom_status::text) = ''`);

    await q(`
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS intelbras_unique_id VARCHAR(128);
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS intelbras_bridge_id VARCHAR(160);
    `);

    await q(`
      ALTER TABLE sessions
        ALTER COLUMN free_minutes_used DROP DEFAULT,
        ALTER COLUMN paid_minutes_used DROP DEFAULT;
      ALTER TABLE sessions
        ALTER COLUMN free_minutes_used TYPE INTEGER USING LEAST(GREATEST(ROUND(COALESCE(free_minutes_used, 0)::numeric)::integer, 0), 2147483647),
        ALTER COLUMN paid_minutes_used TYPE INTEGER USING LEAST(GREATEST(ROUND(COALESCE(paid_minutes_used, 0)::numeric)::integer, 0), 2147483647),
        ALTER COLUMN free_minutes_used SET DEFAULT 0,
        ALTER COLUMN paid_minutes_used SET DEFAULT 0,
        ALTER COLUMN free_minutes_used SET NOT NULL,
        ALTER COLUMN paid_minutes_used SET NOT NULL;
    `);

    const [[row]] = await sequelize.query(`
      SELECT data_type AS dt, udt_name::text AS udt
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'ended_reason_code'
      LIMIT 1;
    `);
    if (
      row &&
      String(row.dt || '').toUpperCase() === 'USER-DEFINED' &&
      row.udt &&
      /^[a-z0-9_]+$/i.test(row.udt)
    ) {
      const tp = `"public"."${row.udt}"`;
      for (const tag of ['MANUAL', 'NO_BALANCE_HARD_CUT', 'NETWORK_ERROR']) {
        await q(`
          DO $$ BEGIN
            ALTER TYPE ${tp} ADD VALUE '${tag.replace(/'/g, "''")}';
          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        `).catch(() => {});
      }
    }

    await q(`DROP INDEX IF EXISTS sessions_channel_name_live_idx`);

    await q(`
      CREATE INDEX IF NOT EXISTS sessions_provider_channel_id_idx
      ON sessions (provider_channel_id)
      WHERE deleted_at IS NULL AND provider_channel_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS sessions_telecom_status_idx
      ON sessions (telecom_status)
      WHERE deleted_at IS NULL;
    `);
  },
};
