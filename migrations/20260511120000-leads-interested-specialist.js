'use strict';

/** Leads Agenda (Fase 5): interesse explícito por uma taróloga para retomada quando ela fica ONLINE. */
module.exports = {
  async up({ sequelize }) {
    await sequelize.query(`
      ALTER TABLE leads
        ADD COLUMN IF NOT EXISTS interested_specialist_id UUID NULL
        REFERENCES specialists (id) ON UPDATE CASCADE ON DELETE SET NULL;
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS leads_interested_specialist_id_idx ON leads (interested_specialist_id);
    `);
  },
};
