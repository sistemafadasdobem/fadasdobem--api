/**
 * Tool Use (Claude) — equivalente semântico a `openai.tools.js` / function calling.
 * @see https://docs.anthropic.com/en/docs/build-with-claude/tool-use
 */

const check_balance = {
  name: 'check_balance',
  description:
    'Consulta o saldo aproximado da carteira em BRL para o cliente autenticado no contexto operacional atual (ficcional até integrar ledger).',
  input_schema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

/**
 * Transição declarativa do Motor de Fluxo (`anthropic.workflow.config.js`).
 * O `enum` de `next_state` reflecte apenas os `next_states` do **passo corrente** (dinâmico por chamada).
 */
function buildSetFlowStateTool(allowedNextStates) {
  const uniq = [...new Set((allowedNextStates || []).filter(Boolean))];
  return {
    name: 'set_flow_state',
    description:
      'Avança o atendimento para o próximo passo só quando os critérios do estado actual estão claros.',
    input_schema: {
      type: 'object',
      properties: {
        next_state: {
          type: 'string',
          enum: uniq.length ? uniq : ['CONVERSATION_LIVRE'],
          description: 'Destino válido segundo o passo atual do fluxo.',
        },
        notes_for_slots: {
          type: 'string',
          description: 'Opcional — notas curtas sobre o que capturou (nome, pacote, etc.).',
        },
      },
      required: ['next_state'],
      additionalProperties: false,
    },
  };
}

const TOOL_REGISTRY = {
  check_balance,
};

/** Definições *estáticas* (modo compat; sem ferramentas de fluxo). */
function messagesApiToolDefinitions() {
  return [check_balance];
}

/**
 * @param {string[]} allowedNames nomes registados em `TOOL_REGISTRY`. `set_flow_state` é acrescentado se `nextStates` não for vazio.
 * @param {string[]} nextStates valores permitidos para o tool `set_flow_state`
 */
function messagesApiToolDefinitionsForFlowState(allowedNames, nextStates) {
  const names = [...new Set(allowedNames || [])];
  /** @type {object[]} */
  const out = [];
  for (const n of names) {
    const t = TOOL_REGISTRY[n];
    if (t) out.push(t);
  }
  if (nextStates && nextStates.length) {
    out.push(buildSetFlowStateTool(nextStates));
  }
  return out;
}

module.exports = {
  messagesApiToolDefinitions,
  messagesApiToolDefinitionsForFlowState,
  buildSetFlowStateTool,
  TOOL_REGISTRY,
  check_balance,
};
