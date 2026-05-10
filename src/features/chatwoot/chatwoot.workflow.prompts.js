'use strict';

/**
 * Textos e payloads das telas do motor WhatsApp (Lead) — edite aqui pela Nice.
 * IDs (`rowId`, `btnId`) são contratos estáveis interpretados pelo `chatwoot.workflow.js`.
 */

const WORKFLOW_PROVIDER = 'lead_whatsapp_fsm_v1';

const STATES = {
  ENTRY: 'T1',
  T2: 'T2',
  T2V: 'T2v',
  T3: 'T3',
  T4: 'T4_PIX',
  T5: 'T5_COLLECT_DETAILS',
  T6: 'T6_CONFIRM_PARSED',
  T7: 'T7_DELIVERY_MODE',
  T7_PRIVACY: 'T7_WHATSAPP_PRIVACY',
  T8_PLATFORM: 'T8_DONE_PLATFORM',
  T8_PHONE: 'T8_DONE_PHONE',
  RETURNING_NEED_HUMAN: 'RETURNING_NEED_HUMAN',
  HANDOFF_WHATSAPP: 'HANDOFF_WHATSAPP_SPECIALIST',
  END: 'CONVERSATION_END',
  /** Fluxo 03e — cliente de retorno (mesma tabela `bot_conversation_flow_states`). */
  E0_REENTRY: 'E0_REENTRY_RESUME',
  E1_RETURN_WELCOME: 'E1_RETURN_WELCOME',
  E3_CHECK_BALANCE: 'E3_CHECK_BALANCE',
  E4_RETURN_PRICING: 'E4_RETURN_PRICING',
  E5_RETURN_MODALITY: 'E5_RETURN_MODALITY',
  IDENTITY_CHALLENGE_DOB: 'IDENTITY_CHALLENGE_DOB',
  IDENTITY_CHALLENGE_PHONE: 'IDENTITY_CHALLENGE_PHONE',
};

/** Botões da T1 — `id` volta no texto/metadata da Evolution/Chatwoot. */
const T1 = {
  intro:
    'Olá! 💜 Seja bem-vinda ao Fadas do Bem. Sou a assistente virtual das Fadas.\n\nPara te atender melhor — você já se consultou com a gente antes?',
  buttons: [
    { id: 'fsm:t1:new', title: 'reply', displayText: '✨ Não, é minha primeira vez', labelMatch: ['primeira vez', 'nova', 'primeira vez'] },
    {
      id: 'fsm:t1:return',
      title: 'reply',
      displayText: 'Sim, já me consultei antes',
      labelMatch: ['consultei antes', 'já me consultei', 'sim', 'antes'],
    },
  ],
};

const T2 = {
  intro:
    'Que alegria! ✨ Temos uma oferta especial para primeira consulta:\n\n' +
    '💜 **R$ 2,96/min** em vez de R$ 4,49/min em consultas por texto ou voz 💜\n\n' +
    'Escolha o tempo da sua consulta:',
  list: {
    title: '💬 Chat ou 📞 Voz · preço promocional',
    buttonText: 'Escolher duração',
    footerText: 'Fadas do Bem 💜 · promoção primeira consulta',
    sectionTitle: 'Pacotes texto/voz',
    rows: [
      {
        rowId: 'fsm:t2:cv15',
        title: '⏱ 15 min',
        description: 'R$ 44,40',
      },
      {
        rowId: 'fsm:t2:cv30',
        title: '⏱ 30 min · ⭐ popular',
        description: 'R$ 88,80',
      },
      {
        rowId: 'fsm:t2:cv60',
        title: '⏱ 60 min',
        description: 'R$ 159,90',
      },
    ],
  },
  videoButtonTitle: '📹 Quero ver pacotes de vídeo',
  videoBtnId: 'fsm:t2:goto:t2v',
};

const T2V = {
  intro:
    'Para vídeo, os valores são:\n\n🎥 **R$ 6,49/min**\n\nEscolha o tempo da sua consulta:',
  list: {
    title: '🎥 Vídeo · pelo chat da plataforma',
    buttonText: 'Escolher duração (vídeo)',
    footerText: 'Vídeo somente pela plataforma 💜',
    sectionTitle: 'Pacotes vídeo',
    rows: [
      {
        rowId: 'fsm:t2v:vd30',
        title: '⏱ 30 min · ⭐ popular',
        description: 'R$ 159,90',
      },
      {
        rowId: 'fsm:t2v:vd40',
        title: '⏱ 40 min',
        description: 'R$ 199,90',
      },
      {
        rowId: 'fsm:t2v:vd60',
        title: '⏱ 60 min',
        description: 'R$ 279,90',
      },
    ],
  },
  backBtn: {
    id: 'fsm:t2v:back:t2',
    title: 'reply',
    displayText: '← Voltar · ver chat e voz',
  },
};

const T3_MESSAGES = {
  available: ({ minutes, totalBrl, count }) =>
    `✅ Ótima escolha!\n\nTarólogas disponíveis agora: **${count}**\nSeu pacote: **${minutes} min · R$ ${totalBrl}**\n\nConfirma e eu gero o PIX?`,
  busy: ({ minutes, totalBrl, eta }) =>
    `✅ Ótima escolha!\n\nSeu pacote: **${minutes} min · R$ ${totalBrl}**\nTempo de espera estimado: ~**${eta}** min 💜\n\nConfirma e eu gero o PIX?`,
  buttonsConfirm: [
    { id: 'fsm:t3:confirm_pix', title: 'reply', displayText: '✅ Confirmar e gerar PIX' },
    { id: 'fsm:t3:change_pkg', title: 'reply', displayText: '← Mudar pacote' },
  ],
};

const T4 = {
  intro:
    'PIX gerado! É em nome de **Fadas do Bem** 💜\n\n' +
    '• Valor conforme combinado • Chave tipo **e-mail**: **pix@fadasdobem.com.br**\n' +
    '• Copiar-e-Cola e QR: confira pelo **card** enviado (se disponível no seu cliente WhatsApp 💜).\n\n' +
    'Assim que fizer você me passa o comprovante? 🙏🏻 Aí já dou sequência na sua consulta!',
};

const T5 = ({ amountFormatted }) =>
  `Localizei seu pagamento de ${amountFormatted}! ✅\n\n` +
  'Agora, só preciso de alguns dados seus:\n' +
  '· Seu nome completo\n' +
  '· Sua data de nascimento\n' +
  '· Seu e-mail\n\n' +
  'Pode responder em texto livre, numa tacada só 💜';

const T6 = ({ name, birth, email }) =>
  `Confirmando seus dados:\n· Nome: **${name}**\n· Nascimento: **${birth}**\n· E-mail: **${email}**\n\nEstá correto?`;

const T6_BUTTONS = [
  { id: 'fsm:t6:ok', title: 'reply', displayText: 'Sim, está correto' },
  { id: 'fsm:t6:fix', title: 'reply', displayText: 'Quero corrigir' },
];

const T7 = {
  intro: 'Como prefere fazer sua consulta?',
  buttonsPrimary: [
    { id: 'fsm:t7:platform', title: 'reply', displayText: '🌐 Chat na plataforma (maior privacidade)' },
    { id: 'fsm:t7:phone', title: 'reply', displayText: '📞 Telefone' },
  ],
  privacyExplanation:
    'Pode sim! Mas pelo WhatsApp a taróloga veria seu número. Pelo chat da nossa **plataforma**, não 💜\n\n' +
    'Se preferir assim mesmo, pode escolher:',
  privacyButtons: [
    { id: 'fsm:t7:wa_text', title: 'reply', displayText: '💬 WhatsApp texto' },
    { id: 'fsm:t7:wa_voice', title: 'reply', displayText: '🎙 WhatsApp áudio' },
  ],
  videoWhatsappBlocked: 'Vídeo somente pelo chat da nossa **plataforma** 💜',
};

/** Campos exemplo / demo — personalize depois pela integração com tarólogo real. */
const DEMO_SPECIALIST = {
  name: 'Sofia Luz',
  speciality: 'Tarot Cigano · Amor e relacionamentos',
  platformDeepLinkPlaceholder: 'https://app.fadasdobem.com.br/consulta/exemplo-consulta',
  phoneDial: '+551126267145',
};

const T8 = {
  platform: ({ clientFirstName }) =>
    `✨ Tudo pronto, ${clientFirstName}!\n\n` +
    `🔮 Sua taróloga: **${DEMO_SPECIALIST.name}**\n**Especialidade:** ${DEMO_SPECIALIST.speciality}\n\n` +
    `Ela está te aguardando.\n🔗 **Link:** ${DEMO_SPECIALIST.platformDeepLinkPlaceholder}\n\n` +
    '*Toque para entrar 💜*\n\n' +
    '⚠️ **O link expira em ~5 minutos.** Se precisar de mais tempo, ela pode não estar disponível — me escreva **continuar** por aqui que vemos juntas 💜',
  phone: ({ clientFirstName }) =>
    `✨ Tudo pronto, ${clientFirstName}!\n\n` +
    `🔮 Sua taróloga: **${DEMO_SPECIALIST.name}**\n**Especialidade:** ${DEMO_SPECIALIST.speciality}\n\n` +
    'Para sua consulta, **toque aqui para ligar** 📞:',
  phoneDialLabel: '📞 (11) 2626-7145',
  whatsappHandoff:
    `✨ Quem vai te atender é **${DEMO_SPECIALIST.name}**, ela já está te esperando! A partir de agora **ela vai continuar aqui** com você 💜`,
};

/** Nota ao humano quando “retorno” escolhe rota diferente da nova cliente. */
const RETURNING_TEAM_NOTE_PT =
  '🔔 **Cliente indica já ter sido atendida antes** (`RETURNING_NEED_HUMAN`) — iniciar protocolo de **identificação de retorno** / cadastro oficial.';

const HANDOFF_TEAM_NOTE_PT =
  '🔕 **Cliente optou pelo fluxo WhatsApp com tarólogo** — desactivar automatismos IA neste tópico e **delegar sala limpa à tarólogo** (`HANDOFF`).';

/** Preço “vitrine” para contraste no script de preço (novas clientes). */
const RETURN_PRICE_NOCHE_GUEST_PER_MIN_BRL = 4.49;

/**
 * Fluxo **03e** — cliente de retorno (textos centralizados).
 * IDs estáveis `fsm:e*` / `fsm:iden:*` interpretados em `chatwoot.workflow.returning.js`.
 */
const RETURN = {
  E0: {
    resumePrompt: ({ firstName }) =>
      `Oi ${firstName}, você já está na **fila** ou com uma **consulta em andamento** neste canal 💜\n\nQuer **retomar** por aqui?`,
    buttons: [
      { id: 'fsm:e0:resume_yes', title: 'reply', displayText: '✅ Sim, retomar' },
      { id: 'fsm:e0:human', title: 'reply', displayText: '💬 Falar com a equipe' },
    ],
  },
  E1: {
    welcome: ({ displayName }) =>
      `Que bom te ver de volta, ${displayName}! 💜 Como você já é das nossas, já tenho seus dados salvados.\n\n` +
      `Tem alguma taróloga de **preferência** para hoje? (Pode escrever o nome — ou diga que quer **qualquer uma disponível** 💜)`,
    toBalanceBtn: { id: 'fsm:e1:to_balance', title: 'reply', displayText: 'Ver saldo e continuar 💜' },
  },
  E3: {
    balanceIntro: ({ firstName, balanceLabel }) =>
      `${firstName}, você tem **${balanceLabel}** de saldo 💜\n\nQuer usar agora ou adicionar mais tempo?`,
    buttons: [
      { id: 'fsm:e3:use_balance', title: 'reply', displayText: '✅ Usar meu saldo agora' },
      { id: 'fsm:e3:add_time', title: 'reply', displayText: '➕ Adicionar mais tempo' },
    ],
  },
  E4: {
    /** `rows` é montado em runtime (preços do `pricing_level`). */
    list: {
      title: 'Pacotes · cliente de retorno',
      buttonText: 'Escolher pacote',
      footerText: 'Valores conforme seu nível tarifário 💜',
      sectionTitle: 'Tempo · texto ou voz',
    },
    listVideoSection: 'Pacotes · vídeo (preço fixo)',
    priceComplaint:
      `Para você, temos um **valor especial** 💜 Para novas clientes, o valor atual é **R$ ${RETURN_PRICE_NOCHE_GUEST_PER_MIN_BRL.toFixed(2).replace('.', ',')}/min**. ` +
      `O seu é **conforme seu nível no cadastro** — combinamos com carinho.\n\nSe quiser revisar com calma, posso pedir para **alguém da equipe** te explicar aqui.`,
    priceComplaintEscalationNote:
      '⚠️ Cliente **insiste no preço** após script 03e — assumir conversa humana.',
  },
  E5: {
    intro: 'Como prefere usar o seu saldo agora?',
    buttons: [
      { id: 'fsm:e5:texto', title: 'reply', displayText: '💬 Chat texto' },
      { id: 'fsm:e5:voz', title: 'reply', displayText: '📞 Voz' },
      { id: 'fsm:e5:video', title: 'reply', displayText: '🎥 Vídeo (plataforma)' },
    ],
  },
  IDENTITY: {
    dobListTitle: 'Confirme sua data de nascimento',
    dobListDescription: 'Toque na data que consta no seu cadastro 💜',
    dobListButton: 'Sou eu · data',
    dobSection: 'Escolha a data correta',
    phoneListTitle: 'Confirme o final do seu celular',
    phoneListDescription: 'Selecione o número que corresponde ao seu WhatsApp 💜',
    phoneListButton: 'Sou eu · número',
    phoneSection: 'Final do celular',
    successNote: '✅ Identidade confirmada — seguir fluxo de retorno 03e.',
    fail: 'Não consegui confirmar 💜 Vou pedir para **alguém da equipe** continuar com você.',
  },
};

/** Mapa técnico de pacotes (valor total exibido; `selected_package_id` persistido nos slots). */
const PACKAGE_IDS = Object.freeze({
  cv15: 'text_voice_promo_15',
  cv30: 'text_voice_promo_30',
  cv60: 'text_voice_promo_60',
  vd30: 'video_30',
  vd40: 'video_40',
  vd60: 'video_60',
});

module.exports = {
  WORKFLOW_PROVIDER,
  STATES,
  T1,
  T2,
  T2V,
  T3_MESSAGES,
  T4,
  T5,
  T6,
  T6_BUTTONS,
  T7,
  T8,
  DEMO_SPECIALIST,
  RETURNING_TEAM_NOTE_PT,
  HANDOFF_TEAM_NOTE_PT,
  PACKAGE_IDS,
  RETURN,
  RETURN_PRICE_NOCHE_GUEST_PER_MIN_BRL,
};
