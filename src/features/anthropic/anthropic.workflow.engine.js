const workflow = require('./anthropic.workflow.config');
const prompts = require('../../providers/anthropic/anthropic.prompts');
const messages = require('./anthropic.messages');

function listStateKeys() {
  return Object.keys(workflow.states || {});
}

/**
 * @param {{ state?: string, slots?: object } | null} persisted
 * @returns {string}
 */
function resolveStateKey(persisted) {
  const key = persisted && typeof persisted.state === 'string' ? persisted.state.trim() : '';
  if (key && workflow.states[key]) return key;
  return workflow.initial_state;
}

function assertKnownState(stateKey) {
  if (!workflow.states[stateKey]) throw new Error(`Estado do fluxo desconhecido: ${stateKey}`);
}

/**
 * Prompt `system` completo — persona + guião `getMessage(messageKey)` quando existir.
 * @param {string} stateKey
 * @param {{ includeTransitions?: boolean, context?: Record<string, unknown> }} [opts]
 */
function buildSystemPrompt(stateKey, opts = {}) {
  assertKnownState(stateKey);
  const cfg = workflow.states[stateKey];
  const base = prompts.CLAUDE_SYSTEM_INSTRUCTIONS;
  const reinf = prompts.CLAUDE_RUN_APPEND_INSTRUCTIONS_PT;
  const ctx = messages.normalizeContext(opts.context || {});

  let stepBody = '';

  if (cfg.messageKey) {
    const pack = messages.getMessage(cfg.messageKey, ctx);
    const btnHint =
      pack.buttons.length > 0
        ? `\n\n**Opções interativas (Chatwoot):** integre empaticamente na resposta — payload para automação:\n\`\`\`json\n${JSON.stringify(
            pack.buttons,
            null,
            2
          )}\n\`\`\`\n`
        : '';
    const nextDefault = pack.defaultNextState
      ? `\n\n**Happy path BD:** após cumprir com critérios deste guião (\`${pack.key}\`), o próximo estado *típico* é \`${pack.defaultNextState}\`. Só evolua com \`set_flow_state\` se bater com a conversa **e** constar nos estados permitidos abaixo.`
      : '';
    stepBody = `### Guião deste passo (\`${pack.key}\`)\n\n${pack.text}${btnHint}${nextDefault}`;
  } else if (cfg.system_prompt) {
    stepBody = cfg.system_prompt;
  }

  const extra =
    cfg.extra_instructions && `${cfg.extra_instructions}`.trim()
      ? `\n\n### Conduta específica do passo\n${cfg.extra_instructions}`
      : '';

  const wantTrans = opts.includeTransitions !== false;
  const nextLine =
    wantTrans && cfg.next_states && cfg.next_states.length > 0
      ? `\n\n**Transições (\`set_flow_state\`):** apenas um destes: ${cfg.next_states.join(', ')}.\nInvoque só quando for seguro para a cliente — senão mantenha o diálogo no mesmo estado.`
      : '';

  return `${base}

---
## Estado do fluxo: ${stateKey}

${stepBody}${extra}

---
(Reforço contextual: ${reinf})${wantTrans ? nextLine : ''}`;
}

function isTransitionAllowed(fromState, toState) {
  assertKnownState(fromState);
  assertKnownState(toState);
  const allowed = workflow.states[fromState].next_states || [];
  return allowed.includes(toState);
}

module.exports = {
  workflow,
  listStateKeys,
  resolveStateKey,
  buildSystemPrompt,
  isTransitionAllowed,
  assertKnownState,
};
