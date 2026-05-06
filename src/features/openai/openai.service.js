const prompts = require('../../providers/openai/openai.prompts');
const { getOpenAiClient } = require('../../providers/openai/openai.client');
const openaiTools = require('../../providers/openai/openai.tools');
const workflow = require('./openai.workflow');
const { execByName } = require('./openai.functionBridge');

/**
 * Threads + Assistant (continuidade por `identity.openai_thread_id`) — legado/outros fluxos.
 * @param {import('sequelize').Model} identity — `User` ou `Lead` (coluna `openai_thread_id`).
 */
async function replyForUserPlainText(identity, plaintext) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return prompts.FALLBACK_IA_UNAVAILABLE;
    }
    return await workflow.generateAssistantReply(identity, plaintext);
  } catch (err) {
    console.error('[openai.service]', err.message);
    return prompts.FALLBACK_IA_UNAVAILABLE;
  }
}

function chatSystemPrompt() {
  return `${prompts.ASSISTANT_SYSTEM_INSTRUCTIONS}\n\n(Reforço: ${prompts.RUN_APPEND_INSTRUCTIONS_PT})`;
}

/**
 * Paridade com Anthropic (`generateReply`): histórico Chatwoot + mensagem atual, *stateless* via Chat Completions + tools.
 * @param {Array<{ role: 'user' | 'assistant', content: string }>} historico
 * @param {string} mensagemUsuario
 * @returns {Promise<string>}
 */
async function generateReply(historico, mensagemUsuario) {
  if (!process.env.OPENAI_API_KEY) {
    return prompts.FALLBACK_IA_UNAVAILABLE;
  }

  const client = getOpenAiClient();
  const model = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
  const toolDefs = openaiTools.assistantToolDefinitions();
  const tools = Array.isArray(toolDefs) ? toolDefs : [];
  const maxRounds = Number(process.env.OPENAI_MAX_TOOL_ROUNDS) || 10;

  const history = Array.isArray(historico) ? historico : [];
  const latest = `${mensagemUsuario || ''}`.trim();

  const messages = [
    { role: 'system', content: chatSystemPrompt() },
    ...history
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({ role: m.role, content: `${m.content}`.trim() })),
  ];
  if (latest) {
    messages.push({ role: 'user', content: latest });
  }

  try {
    for (let round = 0; round < maxRounds; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      const response = await client.chat.completions.create({
        model,
        messages,
        ...(tools.length
          ? { tools, tool_choice: 'auto' }
          : {}),
      });

      const choice = response.choices?.[0];
      const msg = choice?.message;
      if (!msg) return prompts.FALLBACK_IA_UNAVAILABLE;

      messages.push(msg);

      if (msg.tool_calls && msg.tool_calls.length) {
        for (const tc of msg.tool_calls) {
          const name = tc.function?.name;
          let args = {};
          try {
            args = JSON.parse(tc.function?.arguments || '{}');
          } catch {
            args = {};
          }
          // eslint-disable-next-line no-await-in-loop
          const payload = await execByName(name, args);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(payload),
          });
        }
        continue;
      }

      const text = `${msg.content || ''}`.trim();
      return text || prompts.FALLBACK_IA_UNAVAILABLE;
    }
    return prompts.FALLBACK_IA_UNAVAILABLE;
  } catch (err) {
    console.error('[openai.service] generateReply', err.message);
    return prompts.FALLBACK_IA_UNAVAILABLE;
  }
}

module.exports = {
  replyForUserPlainText,
  generateReply,
};
