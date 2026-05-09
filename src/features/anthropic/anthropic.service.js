const { getAnthropicClient } = require('../../providers/anthropic/anthropic.client');
const prompts = require('../../providers/anthropic/anthropic.prompts');
const anthropicTools = require('../../providers/anthropic/anthropic.tools');
const { mergeAdjacentSameRole, ensureOpensWithUser } = require('../chatwoot/chatwoot.aiHistory');
const { execByName } = require('../openai/openai.functionBridge');
const flowEngine = require('./anthropic.workflow.engine');
const flowStore = require('./anthropic.workflow.store');
const anthropicMessages = require('./anthropic.messages');
const errMessages = anthropicMessages.erros;

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
 * Motor de Fluxo Chatwoot: estado persistido por conversa (`flowStore`).
 * `chatwoot.service` deve usar este método em vez de `generateReply`.
 *
 * @param {Array<{ role: 'user' | 'assistant', content: string }>} historico
 * @param {string} mensagemUsuario
 * @param {{ accountId: string, conversationId: string }} ctx
 */
async function generateReplyForChatwoot(historico, mensagemUsuario, ctx) {
  const accountId = `${ctx.accountId || ''}`.trim();
  const conversationId = `${ctx.conversationId || ''}`.trim();
  if (!accountId || !conversationId) {
    anthropicDiagLog('flow_fallback', { reason: 'ids_chatwoot_ausentes' });
    return generateReply(historico, mensagemUsuario);
  }

  const persisted = await flowStore.load(accountId, conversationId);
  /** @type {string} Estado mutável dentro do mesmo ciclo Tool Use */
  let activeStateKey = flowEngine.resolveStateKey(persisted);

  /** Estado mutável (slots) dentro do ciclo Tool Use — repousa também no Postgres após cada transição. */
  let workingSlots =
    persisted && persisted.slots && typeof persisted.slots === 'object' ? { ...persisted.slots } : {};

  async function execTool(name, input) {
    if (name === 'set_flow_state') {
      const rawNext = typeof input?.next_state === 'string' ? input.next_state.trim() : '';
      try {
        flowEngine.assertKnownState(rawNext);
      } catch {
        return JSON.stringify({
          ok: false,
          error: 'unknown_target_state',
          message: errMessages.transicao_invalida,
        });
      }
      if (!flowEngine.isTransitionAllowed(activeStateKey, rawNext)) {
        return JSON.stringify({
          ok: false,
          error: 'transition_not_allowed',
          from: activeStateKey,
          attempted: rawNext,
          allowed: flowEngine.workflow.states[activeStateKey].next_states || [],
        });
      }
      const note = `${input?.notes_for_slots || ''}`.trim();
      if (note) {
        const prev = [...(Array.isArray(workingSlots.transition_notes) ? workingSlots.transition_notes : [])];
        prev.push(`${activeStateKey}→${rawNext}: ${note}`.slice(0, 500));
        workingSlots.transition_notes = prev.slice(-20);
      }
      await flowStore.save(accountId, conversationId, { state: rawNext, slots: workingSlots });
      activeStateKey = rawNext;
      return JSON.stringify({ ok: true, state: rawNext });
    }
    try {
      const payload = await execByName(name, input);
      return JSON.stringify(payload);
    } catch (e) {
      return JSON.stringify({
        ok: false,
        error: String(e?.message || e),
        message: errMessages.ferramenta_indisponivel,
      });
    }
  }

  const cfg = flowEngine.workflow.states[activeStateKey];
  const flowContext = anthropicMessages.normalizeContext({ slots: workingSlots });
  const system = flowEngine.buildSystemPrompt(activeStateKey, {
    includeTransitions: true,
    context: flowContext,
  });
  const tools = anthropicTools.messagesApiToolDefinitionsForFlowState(cfg.tools, cfg.next_states || []);

  anthropicDiagLog('flow_turn', {
    account_id: accountId,
    conversation_id: conversationId,
    state: activeStateKey,
    transitions: cfg.next_states,
    redis: flowStore.useRedisConfigured(),
    tools: tools.length,
  });

  const history = Array.isArray(historico) ? historico : [];
  const latest = `${mensagemUsuario || ''}`.trim();
  const base = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, content: `${m.content}`.trim() }));
  const withLatest = latest ? [...base, { role: 'user', content: latest }] : base;
  let merged = mergeAdjacentSameRole(withLatest);
  merged = ensureOpensWithUser(merged);

  return generateReplyFromMessages(merged, { system, tools, execTool });
}

/** Estado efectivo já normalizado pela config (útil ao `chatwoot.service` registar métricas). */
async function getCurrentFlowState(accountId, conversationId) {
  const aid = `${accountId || ''}`.trim();
  const cid = `${conversationId || ''}`.trim();
  if (!aid || !cid) {
    return { stateKey: flowEngine.workflow.initial_state, slots: {}, backend: null };
  }
  const persisted = await flowStore.load(aid, cid);
  const stateKey = flowEngine.resolveStateKey(persisted);
  return {
    stateKey,
    slots: persisted?.slots || {},
    backend: flowStore.useRedisConfigured() ? 'redis+cache-or-pg' : 'postgres',
  };
}

/**
 * Paridade com OpenAI: resposta sem persistência Chatwoot (sem `accountId/conversationId`).
 * Usa o estado conceptual `CONVERSATION_LIVRE` **sem** `set_flow_state` para não deslocar Postgres/Redis inadvertidamente.
 * @param {Array<{ role: 'user' | 'assistant', content: string }>} historico
 * @param {string} mensagemUsuario
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

  const stateKey = 'CONVERSATION_LIVRE';
  const cfgCv = flowEngine.workflow.states[stateKey];
  const system = flowEngine.buildSystemPrompt(stateKey, { includeTransitions: false, context: {} });
  const tools = anthropicTools.messagesApiToolDefinitionsForFlowState(cfgCv.tools, []);

  async function execToolBridge(name, input) {
    if (name === 'set_flow_state') {
      return JSON.stringify({
        ok: false,
        error: 'flow_tool_disabled_without_conversation_scope',
      });
    }
    try {
      const payload = await execByName(name, input);
      return JSON.stringify(payload);
    } catch (e) {
      return JSON.stringify({
        ok: false,
        error: String(e?.message || e),
        message: errMessages.ferramenta_indisponivel,
      });
    }
  }

  return generateReplyFromMessages(merged, { system, tools, execTool: execToolBridge });
}

/**
 * @param {import('sequelize').Model} _identity
 * @param {string} plaintext
 */
async function replyForUserPlainText(_identity, plaintext) {
  return generateReply([], `${plaintext ?? ''}`);
}

/**
 * Ciclo Messages API + Tool Use — `execTool` recebe já o payload parseado `{ name, input }` via ciclo interno.
 * @param {Array<{ role: 'user' | 'assistant', content: string | Array<object> }>} seedMessages
 * @param {{ system?: string, tools?: object[], execTool?: (name: string, input: object) => Promise<string> }} [options]
 * @returns {Promise<string>}
 */
async function generateReplyFromMessages(seedMessages, options = {}) {
  const system =
    typeof options.system === 'string'
      ? options.system
      : `${prompts.CLAUDE_SYSTEM_INSTRUCTIONS}\n\n(Reforço contextual: ${prompts.CLAUDE_RUN_APPEND_INSTRUCTIONS_PT})`;

  const rawToolsBase = anthropicTools.messagesApiToolDefinitions();
  /** @type {object[]} */
  const tools = Array.isArray(options.tools)
    ? options.tools
    : Array.isArray(rawToolsBase)
      ? rawToolsBase
      : [];

  /** @type {(name: string, input: object) => Promise<string>} */
  const execTool =
    typeof options.execTool === 'function'
      ? options.execTool
      : async (name, input) =>
          JSON.stringify(await execByName(name, input).catch((e) => ({ error: String(e?.message || e) })));

  if (!process.env.ANTHROPIC_API_KEY) {
    anthropicDiagLog('blocked', { reason: 'ANTHROPIC_API_KEY_absente' });
    return prompts.FALLBACK_IA_UNAVAILABLE;
  }

  try {
    const client = getAnthropicClient();
    let messages = (seedMessages || [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));

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
        const txt = await execTool(name, input);
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: typeof txt === 'string' ? txt : JSON.stringify(txt),
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
  generateReplyForChatwoot,
  getCurrentFlowState,
  replyForUserPlainText,
  generateReplyFromMessages,
};
