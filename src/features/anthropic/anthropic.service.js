const { getAnthropicClient } = require('../../providers/anthropic/anthropic.client');
const prompts = require('../../providers/anthropic/anthropic.prompts');
const anthropicTools = require('../../providers/anthropic/anthropic.tools');
const { mergeAdjacentSameRole, ensureOpensWithUser } = require('../chatwoot/chatwoot.aiHistory');
const { execByName } = require('../openai/openai.functionBridge');
const flowEngine = require('./anthropic.workflow.engine');
const flowStore = require('./anthropic.workflow.store');
const anthropicMessages = require('./anthropic.messages');
const errMessages = anthropicMessages.erros;
const chatwootClient = require('../../providers/chatwoot/chatwoot.client');

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

function clipOneLineText(s, max) {
  return `${s ?? ''}`.trim().replace(/\s+/g, ' ').slice(0, max);
}

function normalizeCrisisConfidence(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

/**
 * Executa alerta aos supervisores (Chatwoot) quando o modelo usa `trigger_crisis_intervention`.
 * Sem `accountId`/`conversationId`, só regista métricas e orienta o modelo sobre CVV na resposta pública.
 */
async function fulfillTriggerCrisisInterventionTool(input, chatwootCtx = {}) {
  const aid = `${chatwootCtx.accountId ?? ''}`.trim();
  const cid = `${chatwootCtx.conversationId ?? ''}`.trim();

  const detected_sentiment = clipOneLineText(input?.detected_sentiment, 600);
  const suggested_action = clipOneLineText(input?.suggested_action, 900);
  const conf = normalizeCrisisConfidence(input?.confidence_score);

  let alert_dispatched_chatwoot = false;
  let post_error = null;

  if (aid && cid) {
    const body =
      `🚨 ALERTA DE CRISE: IA detectou risco real. Motivo: ${suggested_action || '(motivo não informado)'}. Assuma a conversa imediatamente.` +
      `\n(Relatório da IA · sentimento: ${detected_sentiment || '(n/d)'} · confiança declarada: ${
        conf === null ? '—' : conf.toFixed(2)
      })`;
    try {
      await chatwootClient.postPrivateNote(aid, cid, body.slice(0, 4000));
      alert_dispatched_chatwoot = true;
    } catch (e) {
      post_error = String(e?.message || e);
      console.error('[anthropic:crisis] postPrivateNote falhou:', post_error);
    }
  }

  anthropicDiagLog('crisis_intervention_tool_used', {
    account_id: aid || undefined,
    conversation_id: cid || undefined,
    alert_dispatched_chatwoot,
    sentiment_chars: detected_sentiment.length,
  });

  /** @type {Record<string, unknown>} */
  const out = {
    ok: true,
    status: 'Sucesso no alerta',
    alert_dispatched_chatwoot,
    orientacao_para_sua_resposta_publica: prompts.CLAUDE_CRISIS_AFTER_TOOL_PUBLIC_HINT,
  };
  if (!aid || !cid) {
    out.aviso_interno =
      'Conversa sem identificadores Chatwoot — nota de supervisão não foi enviada pelo pipeline actual.';
  }
  if (post_error) out.post_error_post_chatwoot = post_error;

  return out;
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
    if (name === 'trigger_crisis_intervention') {
      const payload = await fulfillTriggerCrisisInterventionTool(input, {
        accountId,
        conversationId,
      });
      return JSON.stringify(payload);
    }
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
    if (name === 'trigger_crisis_intervention') {
      const payload = await fulfillTriggerCrisisInterventionTool(input, {});
      return JSON.stringify(payload);
    }
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

function normalizeFsmBirthToIso(x) {
  const s = `${x ?? ''}`.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  return `${m[3]}-${mm}-${dd}`;
}

function parseFsmProfileJsonEnvelope(rawAssistantText) {
  const blob = `${rawAssistantText ?? ''}`.trim();
  if (!blob) return null;
  const start = blob.indexOf('{');
  const end = blob.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(blob.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Texto livre T5 (`Lead FSM`): extrai `nome_completo`, `data_nascimento`, `email` via Claude Messages API sem tools.
 * @returns {Promise<{ ok: boolean, nome_completo?: string|null, data_nascimento_iso?: string|null, email?: string|null, erro?: string, incompleto?: boolean }>}
 */
async function extractFsmLeadClienteProfile(freeText) {
  const raw = `${freeText ?? ''}`.trim().slice(0, 3800);
  if (!raw) return { ok: false, erro: 'texto_ausente' };
  try {
    const assistant = await generateReplyFromMessages([{ role: 'user', content: raw }], {
      system: prompts.FSM_LEAD_PROFILE_EXTRACTION_SYSTEM,
      tools: [],
      max_tokens: 384,
    });
    const parsed = parseFsmProfileJsonEnvelope(assistant);
    if (!parsed || typeof parsed !== 'object')
      return { ok: false, erro: assistant === prompts.FALLBACK_IA_UNAVAILABLE ? 'ia_offline' : 'json_illegível' };

    let email = `${parsed.email ?? ''}`.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) email = '';

    const nomeCompleto = `${parsed.nome_completo ?? ''}`.trim().slice(0, 260);
    const dataIso = normalizeFsmBirthToIso(parsed.data_nascimento ?? parsed.data_iso ?? '');
    const okNome = nomeCompleto.length >= 5;
    const okIso = Boolean(dataIso);
    const okMail = Boolean(email);
    return {
      ok: Boolean(okNome && okIso && okMail),
      nome_completo: okNome ? nomeCompleto : null,
      data_nascimento_iso: okIso ? dataIso : null,
      email: okMail ? email : null,
      incompleto: !(okNome && okIso && okMail),
    };
  } catch (e) {
    console.warn('[anthropic:fsm_extract]', e.message || e);
    return { ok: false, erro: 'extracao_erro' };
  }
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
      const cap =
        typeof options.max_tokens === 'number' && options.max_tokens > 0 ? options.max_tokens : maxTokens();
      // eslint-disable-next-line no-await-in-loop
      const response = await client.messages.create({
        model: defaultModelId(),
        max_tokens: cap,
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
  extractFsmLeadClienteProfile,
};
