/**
 * **03d-A · Lead Nova Cliente · WhatsApp** — estados = telas do HTML (T1, T1b, T1c, T2, T2v, T3, …).
 * @see `anthropic.messages.js` — textos e `NEXT_STATE_AFTER_MESSAGE`.
 */
const messages = require('./anthropic.messages');

const { NEXT_STATE_AFTER_MESSAGE } = messages;

const docRegras = [
  '📄 **Regra 03d-A:** venda fecha **no WhatsApp** — não redirecionar pro site no meio da compra 💜',
  '**Nunca** use a palavra **"fila"** com a cliente — use **tempo de espera estimado ~X** ✨',
  '**Nunca** sugira outra taróloga se a cliente pediu uma específica — só se ela **explicitamente** quiser outra ou “qualquer uma agora” 💜',
  'Promo **R$ 2,96/min** e pacotes **15 · 30⭐ · 60** só após **nova confirmada** (T2); vídeo só em **T2v** sem promo 🔒',
  '**Vídeo só** no chat da **plataforma** — frase exata se ela insistir em WA: _"Vídeo somente pelo chat da nossa plataforma 💜"_ ✨',
];

const condutaBase = [
  '💜 **Cada resposta** fecha com **próximo passo claro** (pergunta, botão ou uma ação única) — a cliente nunca fica sem saber o que fazer ✨',
  'Não invente **valores PIX**, chave, QR, **horários**, **disponibilidade** real — use `slots`/ferramentas/dados que o sistema injetou 💜',
  ...docRegras,
].join('\n');

function spec(messageKey, overrides = {}) {
  return {
    messageKey,
    tools: [],
    next_states: [],
    extra_instructions: condutaBase,
    ...overrides,
  };
}

const T1 = spec('T1', {
  next_states: ['T2', 'T1b', 'T1c', 'CONVERSATION_LIVRE'],
});

const T1b = spec('T1b', {
  next_states: ['T2', 'T1', 'CONVERSATION_LIVRE'],
});

const T1c = spec('T1c', {
  next_states: ['T2', 'T3', 'leads_agenda', 'CONVERSATION_LIVRE'],
});

const T2 = spec('T2', {
  tools: ['check_balance'],
  next_states: ['T3', 'T2v', 'T1b', 'CONVERSATION_LIVRE'],
});

const T2v = spec('T2v', {
  tools: ['check_balance'],
  next_states: ['T3', 'T2', 'CONVERSATION_LIVRE'],
});

const T3 = spec('T3', {
  tools: ['check_balance'],
  next_states: ['T4', 'T3b', 'T2', 'CONVERSATION_LIVRE'],
});

const T3b = spec('T3b', {
  tools: ['check_balance'],
  next_states: ['T4', 'T3', 'T3c', 'CONVERSATION_LIVRE'],
});

const T3c = spec('T3c', {
  next_states: ['T4', 'T8', 'T8wa', 'T2', 'CONVERSATION_LIVRE'],
});

const leads_agenda = spec('leads_agenda', {
  next_states: ['T2', 'T1', 'CONVERSATION_LIVRE'],
});

const T4 = spec('T4', {
  tools: ['check_balance'],
  next_states: ['T4b', 'T4c', 'T5', 'CONVERSATION_LIVRE'],
});

const T4b = spec('T4b', {
  tools: ['check_balance'],
  next_states: ['T5', 'T4c', 'CONVERSATION_LIVRE'],
});

const T4c = spec('T4c', {
  next_states: ['T4', 'T4b', 'CONVERSATION_LIVRE'],
});

const T5 = spec('T5', {
  next_states: ['T6', 'CONVERSATION_LIVRE'],
});

const T6 = spec('T6', {
  next_states: ['T7', 'T5', 'CONVERSATION_LIVRE'],
});

/** T7 modalidade — spec (não confundir com “fila de especialistas” antigo). */
const T7 = spec('T7', {
  tools: ['check_balance'],
  next_states: ['T8', 'T8wa', 'T6', 'CONVERSATION_LIVRE'],
});

const T8 = spec('T8', {
  tools: ['check_balance'],
  next_states: ['T9', 'T8wa', 'T7', 'CONVERSATION_LIVRE'],
});

const T8wa = spec('T8wa', {
  next_states: ['T9', 'T8', 'CONVERSATION_LIVRE'],
});

const T9 = spec('T9', {
  next_states: ['CONVERSATION_LIVRE', 'T1'],
});

const CONVERSATION_LIVRE = {
  messageKey: null,
  system_prompt: [
    'Você é a IA da **Fadas do Bem** no WhatsApp 💜 Conversa **fora do funil estruturado** mas com segurança e acolhimento ✨',
    'Se fizer sentido **retomar 03d-A**, sugira gentilmente e use `set_flow_state` para **T1** 💜',
    condutaBase,
  ].join('\n\n'),
  extra_instructions: '',
  tools: ['check_balance'],
  next_states: [
    'T1',
    'T1b',
    'T1c',
    'T2',
    'T2v',
    'T3',
    'T3b',
    'T3c',
    'leads_agenda',
    'T4',
    'T4b',
    'T4c',
    'T5',
    'T6',
    'T7',
    'T8',
    'T8wa',
    'T9',
  ],
};

module.exports = {
  engine_version: 3,
  initial_state: 'T1',
  documento_referencia: '03d-A · Lead Nova Cliente · WhatsApp (HTML spec v1.2 · Abril 2026)',
  transition_after_message_completed: { ...NEXT_STATE_AFTER_MESSAGE },
  states: {
    T1,
    T1b,
    T1c,
    T2,
    T2v,
    T3,
    T3b,
    T3c,
    leads_agenda,
    T4,
    T4b,
    T4c,
    T5,
    T6,
    T7,
    T8,
    T8wa,
    T9,
    CONVERSATION_LIVRE,
  },
};
