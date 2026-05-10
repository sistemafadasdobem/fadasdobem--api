'use strict';

/**
 * Dossiê V2 — hardening negócio: enum ledger, nomes cliente, diário, tabela diários.
 */
module.exports = {
  async up({ sequelize }) {
    try {
      await sequelize.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_transaction_ledger_reference_type')
             AND NOT EXISTS (
               SELECT 1 FROM pg_enum e
               JOIN pg_type t ON e.enumtypid = t.oid
               WHERE t.typname = 'enum_transaction_ledger_reference_type'
                 AND e.enumlabel = 'SYSTEM_FLOOR_ADJUSTMENT'
             ) THEN
            ALTER TYPE "enum_transaction_ledger_reference_type" ADD VALUE 'SYSTEM_FLOOR_ADJUSTMENT';
          END IF;
        END $$;
      `);
    } catch (err) {
      console.warn('[migration] ENUM SYSTEM_FLOOR_ADJUSTMENT — ignorado ou falhou:', err?.message || err);
    }

    await sequelize.query(`
      ALTER TABLE clients
        ADD COLUMN IF NOT EXISTS nome_completo VARCHAR(160),
        ADD COLUMN IF NOT EXISTS nome_id VARCHAR(160),
        ADD COLUMN IF NOT EXISTS apelido VARCHAR(80);
      UPDATE clients
      SET nome_completo = NULLIF(trim(nome), '')
      WHERE (nome_completo IS NULL OR trim(nome_completo) = '')
        AND nome IS NOT NULL AND trim(nome) != '';
    `);

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS client_diaries (
        id UUID PRIMARY KEY NOT NULL,
        client_id UUID NOT NULL REFERENCES clients(id),
        content TEXT NOT NULL,
        date DATE NOT NULL,
        deleted_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS client_diaries_client_id_idx ON client_diaries(client_id);
      CREATE INDEX IF NOT EXISTS client_diaries_date_idx ON client_diaries(date);
      CREATE UNIQUE INDEX IF NOT EXISTS client_diaries_client_date_active_uidx
        ON client_diaries (client_id, date)
        WHERE deleted_at IS NULL;
    `);
  },
};
