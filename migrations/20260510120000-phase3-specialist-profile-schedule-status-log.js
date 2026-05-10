'use strict';

/**
 * Fase 3 — Módulo da taróloga / vitrine: perfil público rico, agenda semanal (`specialist_schedules`),
 * trilho de auditoria de status (`specialist_status_logs`).
 *
 * Contrato temporal: horários são TIME sem fuso armazenado; interpretação no fuso `specialists.timezone`.
 */
module.exports = {
  async up({ sequelize }) {
    await sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'specialists' AND column_name = 'years_experience'
        ) THEN
          ALTER TABLE specialists RENAME COLUMN years_experience TO experience_years;
        END IF;
      END
      $$;
    `);

    await sequelize.query(`
      ALTER TABLE specialists
        ADD COLUMN IF NOT EXISTS experience_years SMALLINT NULL;
      ALTER TABLE specialists
        ADD COLUMN IF NOT EXISTS greeting_audio_url VARCHAR(1024) NULL;
      ALTER TABLE specialists
        ADD COLUMN IF NOT EXISTS presentation_video_url VARCHAR(1024) NULL;
      ALTER TABLE specialists
        ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo';
      COMMENT ON COLUMN specialists.greeting_audio_url IS 'URL (CDN/signed) do áudio de boas-vindas na vitrine';
      COMMENT ON COLUMN specialists.presentation_video_url IS 'URL do vídeo de apresentação na vitrine';
      COMMENT ON COLUMN specialists.experience_years IS 'Anos de experiência informados pela profissional (vitrine)';
      COMMENT ON COLUMN specialists.timezone IS 'IANA; horários em specialist_schedules são wall-clock neste fuso';
    `);

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS specialist_schedules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        specialist_id UUID NOT NULL REFERENCES specialists (id) ON DELETE CASCADE ON UPDATE CASCADE,
        day_of_week SMALLINT NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT specialist_schedules_day_of_week_range CHECK (day_of_week >= 0 AND day_of_week <= 6),
        CONSTRAINT specialist_schedules_time_order CHECK (end_time > start_time)
      );

      CREATE INDEX IF NOT EXISTS specialist_schedules_specialist_day_idx ON specialist_schedules (specialist_id, day_of_week);

      CREATE INDEX IF NOT EXISTS specialist_schedules_specialist_active_idx
        ON specialist_schedules (specialist_id)
        WHERE is_active = true;
    `);

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS specialist_status_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        specialist_id UUID NOT NULL REFERENCES specialists (id) ON DELETE CASCADE ON UPDATE CASCADE,
        previous_status VARCHAR(24) NULL,
        new_status VARCHAR(24) NOT NULL,
        changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT specialist_status_logs_status_not_empty CHECK (length(trim(new_status)) > 0),
        CONSTRAINT specialist_status_logs_no_self_transition CHECK (
          previous_status IS NULL OR previous_status IS DISTINCT FROM new_status
        )
      );

      CREATE INDEX IF NOT EXISTS specialist_status_logs_specialist_changed_idx
        ON specialist_status_logs (specialist_id, changed_at DESC);
      COMMENT ON TABLE specialist_status_logs IS 'Histórico imputável para disputas SLA / horas de presença; preencher no update de specialists.status';
    `);
  },

  async down({ sequelize }) {
    await sequelize.query(`DROP TABLE IF EXISTS specialist_status_logs CASCADE;`);
    await sequelize.query(`DROP TABLE IF EXISTS specialist_schedules CASCADE;`);
    await sequelize.query(`
      ALTER TABLE specialists DROP COLUMN IF EXISTS greeting_audio_url;
      ALTER TABLE specialists DROP COLUMN IF EXISTS presentation_video_url;
      ALTER TABLE specialists DROP COLUMN IF EXISTS timezone;
    `);
    await sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'specialists' AND column_name = 'experience_years'
        ) THEN
          ALTER TABLE specialists RENAME COLUMN experience_years TO years_experience;
        END IF;
      END
      $$;
    `);
  },
};
