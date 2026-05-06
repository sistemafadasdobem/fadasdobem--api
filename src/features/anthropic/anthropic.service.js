const { getAnthropicClient } = require('../../providers/anthropic/anthropic.client');
const prompts = require('../../providers/anthropic/anthropic.prompts');
const { messagesApiToolDefinitions } = require('../../providers/anthropic/anthropic.tools');
const { mergeAdjacentSameRole, ensureOpensWithUser } = require('../chatwoot/chatwoot.aiHistory');
const { execByName } = require('../openai/openai.functionBridge');

/** Só silencia com ANTHROPIC_SERVICE_LOG=false explícito no env. */
function anthropicDiagLog(summary, fields = {}) {
  if (`${process.env.ANTHROPIC_SERVICE_LOG || ''}`.trim().toLowerCase() === 'false') return;
  const extra = Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : '';
  console.log(`[anthropic:claude] ${summary}${extra}`);
}

function defaultModelId() {
  return process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';
}

function maxTokens() {
  const raw = Number(process.env.ANTHROPIC_MAX_TOKENS);
  return Number.isFinite(raw) && raw > 0 ? raw : 2048;
}

function extractAssistantPlainText(content) {
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('\n').trim();
}

/**
 * Paridade com OpenAI: resposta *stateless* a partir de histórico + última mensagem do utilizador.
 * @param {Array<{ role: 'user' | 'assistant', content: string }>} historico — turnos anteriores (sem duplicar a última).
 * @param {string} mensagemUsuario — texto inbound corrente.
 * @returns {Promise<string>}
 */
async function generateReply(historico, mensagemUsuario) {
  const history = Array.isArray(historico) ? historico : [];
  const latest = `${mensagemUsuario || ''}`.trim();

  const base = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, content: `${m.content}`.trim() }));

  const withLatest = latest ? [...base, { role: 'user', content: latest }] : base;
  let merged = mergeAdjacentSameRole(withLatest);
  merged = ensureOpensWithUser(merged);

  return generateReplyFromMessages(merged);
}

/**
 * Compatível com a fachada OpenAI (`replyForUserPlainText`) — identidade ignorada no fluxo stateless.
 * @param {import('sequelize').Model} _identity
 * @param {string} plaintext
 */
async function replyForUserPlainText(_identity, plaintext) {
  return generateReply([], `${plaintext ?? ''}`);
}

/**
 * Ciclo Messages API + Tool Use — `tools` no formato Anthropic (`name`, `description`, `input_schema`).
 * @param {Array<{ role: 'user' | 'assistant', content: string | Array<object> }>} seedMessages — turnos texto ou blocos já avançados.
 * @returns {Promise<string>}
 */
async function generateReplyFromMessages(seedMessages) {
  if (!process.env.ANTHROPIC_API_KEY) {
    anthropicDiagLog('blocked', { reason: 'ANTHROPIC_API_KEY_absente' });
    return prompts.FALLBACK_IA_UNAVAILABLE;
  }

  const toolsRaw = messagesApiToolDefinitions();
  const tools = Array.isArray(toolsRaw) ? toolsRaw : [];

  try {
    const client = getAnthropicClient();
    let messages = (seedMessages || [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));

    const system = `${prompts.CLAUDE_SYSTEM_INSTRUCTIONS}\n\n(Reforço contextual: ${prompts.CLAUDE_RUN_APPEND_INSTRUCTIONS_PT})`;

    const maxToolRounds = Number(process.env.ANTHROPIC_MAX_TOOL_ROUNDS) || 10;

    let lastAssistantText = '';

    anthropicDiagLog('messages_call_ready', {
      model: defaultModelId(),
      messages_turns: messages.length,
      tools: tools.length,
      max_tokens: maxTokens(),
    });

    for (let round = 0; round < maxToolRounds; round += 1) {
      const roundStart = Date.now();
      // eslint-disable-next-line no-await-in-loop
      const response = await client.messages.create({
        model: defaultModelId(),
        max_tokens: maxTokens(),
        system,
        ...(tools.length ? { tools } : {}),
        messages,
      });

      lastAssistantText = extractAssistantPlainText(response.content) || lastAssistantText;

      anthropicDiagLog('messages_round', {
        round,
        ms: Date.now() - roundStart,
        stop_reason: response.stop_reason,
        usage: response.usage || undefined,
        assistant_text_chars: lastAssistantText.length,
      });

      if (response.stop_reason === 'end_turn' || response.stop_reason === 'stop_sequence') {
        anthropicDiagLog('done', { stop_reason: response.stop_reason, out_chars: lastAssistantText.length });
        return lastAssistantText || prompts.FALLBACK_IA_UNAVAILABLE;
      }

      if (response.stop_reason === 'max_tokens') {
        anthropicDiagLog('done_max_tokens', { out_chars: lastAssistantText.length });
        return lastAssistantText || prompts.FALLBACK_IA_UNAVAILABLE;
      }

      if (response.stop_reason !== 'tool_use') {
        console.warn('[anthropic.service] stop_reason inesperado:', response.stop_reason);
        return lastAssistantText || prompts.FALLBACK_IA_UNAVAILABLE;
      }

      const toolUses = (response.content || []).filter((b) => b.type === 'tool_use');
      if (!toolUses.length) {
        return lastAssistantText || prompts.FALLBACK_IA_UNAVAILABLE;
      }

      messages = messages.concat([{ role: 'assistant', content: response.content }]);

      const toolResultBlocks = [];
      for (const tu of toolUses) {
        const name = tu.name;
        let input = tu.input;
        if (typeof input === 'string') {
          try {
            input = JSON.parse(input || '{}');
          } catch (_) {
            input = {};
          }
        }
        // eslint-disable-next-line no-await-in-loop
        const payload = await execByName(name, input);
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(payload),
        });
      }

      messages = messages.concat([{ role: 'user', content: toolResultBlocks }]);
    }

    console.error('[anthropic.service] Limite de voltas de Tool Use excedido.');
    return lastAssistantText || prompts.FALLBACK_IA_UNAVAILABLE;
  } catch (error) {
    const detail = error.response ? error.response.data : error.message;
    console.error('[AnthropicService] Erro na API do Claude:', detail);
    anthropicDiagLog('api_error', { message: error.message, status: error.status || error.response?.status });
    return prompts.FALLBACK_IA_UNAVAILABLE;
  }
}

module.exports = {
  generateReply,
  replyForUserPlainText,
  generateReplyFromMessages,
};
