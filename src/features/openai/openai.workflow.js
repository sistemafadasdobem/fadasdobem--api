const prompts = require('../../providers/openai/openai.prompts');
const { getOpenAiClient } = require('../../providers/openai/openai.client');
const { getAssistantId } = require('../../providers/openai/openai.setup');
const { fulfillToolOutputs } = require('./openai.functionBridge');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function flattenAssistantOutput(message) {
  if (!message) return '';
  const parts = message.content || [];
  return parts
    .filter((p) => p.type === 'text' && p.text?.value)
    .map((p) => p.text.value)
    .join('\n')
    .trim();
}

async function readLatestAssistantText(client, threadId) {
  const page = await client.beta.threads.messages.list(threadId, {
    order: 'desc',
    limit: 12,
  });
  const msg = page.data.find((m) => m.role === 'assistant');
  return flattenAssistantOutput(msg);
}

async function ensureThread(client, identity) {
  const existing = `${identity?.openai_thread_id ?? ''}`.trim();
  if (existing) {
    return existing;
  }
  const thread = await client.beta.threads.create({});
  await identity.update({ openai_thread_id: thread.id });
  return thread.id;
}

async function runAssistantLoop(client, threadId, assistantId) {
  const pollDelay = Number(process.env.OPENAI_RUN_POLL_MS) || 750;
  const maxAttempts = Number(process.env.OPENAI_RUN_MAX_POLL_ATTEMPTS) || 60;

  const initial = await client.beta.threads.runs.create(threadId, {
    assistant_id: assistantId,
    additional_instructions: prompts.RUN_APPEND_INSTRUCTIONS_PT,
  });
  let runId = initial.id;

  for (let i = 0; i < maxAttempts; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const run = await client.beta.threads.runs.retrieve(threadId, runId);

    if (run.status === 'completed') {
      return run;
    }
    if (run.status === 'failed' || run.status === 'cancelled' || run.status === 'expired') {
      throw new Error(`Run terminou negativamente: ${run.status}`);
    }
    if (run.status === 'requires_action') {
      const submitAction = run.required_action?.submit_tool_outputs;
      const toolCalls = submitAction?.tool_calls || [];
      if (!toolCalls.length) {
        throw new Error('requires_action sem tool_calls');
      }
      // eslint-disable-next-line no-await-in-loop
      const outputs = await fulfillToolOutputs(toolCalls);
      // eslint-disable-next-line no-await-in-loop
      await client.beta.threads.runs.submitToolOutputs(threadId, runId, {
        tool_outputs: outputs,
      });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(pollDelay);
  }

  throw new Error('Timeout aguardando conclusão do Run OpenAI');
}

/**
 * @param {import('sequelize').Model} identity — `User` ou `Lead` com coluna `openai_thread_id`.
 */
async function generateAssistantReply(identity, userText) {
  const trimmed = `${userText}`.trim();
  if (!trimmed) return '';

  const client = getOpenAiClient();
  const assistantId = await getAssistantId();
  const threadId = await ensureThread(client, identity);

  await client.beta.threads.messages.create(threadId, {
    role: 'user',
    content: trimmed,
  });

  await runAssistantLoop(client, threadId, assistantId);

  const answer = await readLatestAssistantText(client, threadId);
  return answer || prompts.FALLBACK_IA_UNAVAILABLE;
}

module.exports = {
  generateAssistantReply,
};
