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

/** Skill de intervenção em crise — o modelo deve acionar com base em raciocínio semântico, não lista fixa no orquestrador. */
const trigger_crisis_intervention = {
  name: 'trigger_crisis_intervention',
  description:
    'Acione esta ferramenta imediatamente se detectar que o usuário está em uma crise emocional aguda, expressando intenções de auto-extermínio, violência ou emergência médica. Esta ação alertará supervisores humanos em tempo real.',
  input_schema: {
    type: 'object',
    properties: {
      detected_sentiment: {
        type: 'string',
        description: 'Descrição sucinta do que você observou na fala emocional do usuário (ex.: desespero, ideação, ameaça, emergência física acusada).',
      },
      confidence_score: {
        type: 'number',
        description: 'Confiança de 0 a 1 de que há risco real que exige intervenção humana imediata (não probabilidade casual).',
      },
      suggested_action: {
        type: 'string',
        description:
          'O que a equipe humana deve fazer já (ex.: assumir chat, avaliar segurança, orientar SAMU/psicologia de plantão conforme política interna).',
      },
    },
    required: ['detected_sentiment', 'confidence_score', 'suggested_action'],
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
  trigger_crisis_intervention,
};

/** Definições *estáticas* (modo compat; sem ferramentas de fluxo). */
function messagesApiToolDefinitions() {
  return [trigger_crisis_intervention, check_balance];
}

/**
 * @param {string[]} allowedNames nomes registados em `TOOL_REGISTRY`. `set_flow_state` é acrescentado se `nextStates` não for vazio.
 * @param {string[]} nextStates valores permitidos para o tool `set_flow_state`
 */
function messagesApiToolDefinitionsForFlowState(allowedNames, nextStates) {
  const names = [...new Set(allowedNames || [])];
  /** @type {object[]} */
  const out = [trigger_crisis_intervention];
  for (const n of names) {
    if (n === 'trigger_crisis_intervention') continue;
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
  trigger_crisis_intervention,
};
