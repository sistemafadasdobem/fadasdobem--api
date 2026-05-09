'use strict';

module.exports = {
  async up({ sequelize }) {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS bot_conversation_flow_states (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id VARCHAR(32) NOT NULL,
        conversation_id VARCHAR(64) NOT NULL,
        provider VARCHAR(32) NOT NULL DEFAULT 'anthropic',
        current_state VARCHAR(64) NOT NULL,
        slots JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (account_id, conversation_id, provider)
      );
    `);

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS bot_flow_conv_updated_idx
      ON bot_conversation_flow_states (updated_at DESC);
    `);
  },
};
