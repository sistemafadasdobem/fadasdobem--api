'use strict';

const { BotConversationFlowState } = require('../../models');
const prompts = require('./chatwoot.workflow.prompts');

const INITIAL_STATE = prompts.STATES.ENTRY;

/**
 * Persistência **somente Postgres** (`bot_conversation_flow_states`).
 * Provider distinto do motor Anthropic para não haver race cond com `anthropic.workflow.store`.
 */
async function load(accountId, conversationId) {
  const aid = `${accountId || ''}`.trim();
  const cid = `${conversationId || ''}`.trim();
  const row = await BotConversationFlowState.findOne({
    where: {
      account_id: aid,
      conversation_id: cid,
      provider: prompts.WORKFLOW_PROVIDER,
    },
  });
  if (!row) return null;
  const slots =
    row.slots && typeof row.slots === 'object' && !Array.isArray(row.slots)
      ? { ...row.slots }
      : {};
  return { current_state: row.current_state, slots };
}

async function save(accountId, conversationId, { current_state: stateKey, slots = {} }) {
  const aid = `${accountId || ''}`.trim();
  const cid = `${conversationId || ''}`.trim();
  const state = `${stateKey || ''}`.trim() || INITIAL_STATE;
  const nextSlots = slots && typeof slots === 'object' && !Array.isArray(slots) ? slots : {};

  const [row, created] = await BotConversationFlowState.findOrCreate({
    where: {
      account_id: aid,
      conversation_id: cid,
      provider: prompts.WORKFLOW_PROVIDER,
    },
    defaults: {
      current_state: state,
      slots: nextSlots,
    },
  });
  if (!created) await row.update({ current_state: state, slots: nextSlots });
}

async function destroy(accountId, conversationId) {
  const aid = `${accountId || ''}`.trim();
  const cid = `${conversationId || ''}`.trim();
  await BotConversationFlowState.destroy({
    where: {
      account_id: aid,
      conversation_id: cid,
      provider: prompts.WORKFLOW_PROVIDER,
    },
  });
}

module.exports = {
  INITIAL_STATE,
  load,
  save,
  destroy,
};
