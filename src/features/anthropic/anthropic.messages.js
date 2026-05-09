/**
 * Textos do fluxo **03d-A** copiados da especificação HTML (secção 3 — telas T1…T8wa, leads_agenda).
 * Só texto de `<p>` / `<em>` fora das caixas `.why`; chave PIX usa `{{pix_email}}` quando o HTML mostra placeholder de e-mail.
 */
/** @typedef {{ label: string, value: string }} FlowButton */

/** @type {Record<string, { text: string, buttons?: FlowButton[] }>} */
const FLOW_MESSAGES = {
  /** T1 — <p>…pergunta: <em>"…"</em></p> */
  T1: {
    text: 'Você já se consultou com a gente antes?',
  },

  /** T1b — "Bot pede o nome completo da cliente." */
  T1b: {
    text: 'Bot pede o nome completo da cliente.\n\nDepois, o sistema busca matches no banco pelo nome informado e gera 3 botões de data de nascimento — uma real e duas falsas. O bot envia os botões para a cliente escolher.',
  },

  /**
   * T1c — parágrafos da tela (sem caixas "why").
   */
  T1c: {
    text:
      'Bot detecta a intenção na primeira mensagem (ex: "quero a Sofia"). Antes de qualquer outra coisa, confirma se a cliente é nova ou retorno — o preço e o fluxo dependem disso.\n\n' +
      'Se nova → verifica disponibilidade da Sofia especificamente:\n\n' +
      'Estado 1 — disponível: segue T2 normalmente com preço promocional. A Sofia já está reservada como preferência.\n\n' +
      'Estado 2 — ocupada agora: bot informa tempo estimado e oferece escolha: aguardar por ela ou se consultar agora com outra taróloga disponível.\n\n' +
      'Estado 3 — não atende hoje: bot informa próximo horário disponível. Cliente pode aguardar aviso (entra em leads_agenda) ou se consultar agora com outra taróloga.',
  },

  /** T2 — preço + pacotes + botão vídeo (texto do doc). */
  T2: {
    text:
      'Só aqui o preço promocional aparece: R$2,96/min (em vez de R$4,49/min).\n\n' +
      'Pacotes disponíveis: 15 min · 30 min ⭐ · 60 min. O pacote de 40 min não é oferecido via WhatsApp — a regra de 3 opções reduz a paralisia de escolha.\n\n' +
      'Vídeo: não é oferecido por padrão. Se a cliente perguntar, há um botão "📹 Quero ver pacotes de vídeo" → T2v.',
    buttons: [{ label: '📹 Quero ver pacotes de vídeo', value: 'flux:t2:video' }],
  },

  /** T2v — preços + T7 exceção vídeo (citação <em>). */
  T2v: {
    text:
      'Exibe preços de vídeo: 30 min R$159,90 · 40 min R$199,90 · 60 min R$279,90. Sem promoção — vídeo não tem desconto de primeira consulta.\n\n' +
      'Se a cliente escolher um pacote → segue o fluxo normalmente (T3 → PIX). Se voltar → T2.\n\n' +
      'Na T7, se a cliente que comprou vídeo perguntar se pode ser por WhatsApp: bot responde: "Vídeo somente pelo chat da nossa plataforma 💜" — sem oferecer alternativa. Não há vídeo por WhatsApp.',
  },

  /**
   * T3 — parágrafos fora de `.why`.
   */
  T3: {
    text:
      'Calcula tarólogas disponíveis em tempo real.\n\n' +
      'Estado 1 — disponível: se 1 disponível → exibe 1. A partir de 2 → exibe N-1 (2 livres → exibe 1 · 3 livres → exibe 2).\n\n' +
      'Estado 2 — todas ocupadas: exibe tempo estimado de espera.',
  },

  /** T3b — parágrafos da tela (sem caixas "why"). */
  T3b: {
    text:
      'Nenhuma taróloga disponível. A fila tem dois tipos de entrada — a palavra "fila" nunca é usada com a cliente em nenhum dos casos.\n\n' +
      'Fila com pagamento — cliente pagou via PIX. Sistema registra com pagamento_confirmado = true. Bot confirma recebimento e informa tempo de espera. Quando a vez chegar, vai direto para atribuição de taróloga → link mágico.\n\n' +
      'Fila sem pagamento — cultura atual do WhatsApp: cliente entra na fila sem pagar. Sistema registra com pagamento_confirmado = false. Quando a vez chegar, atendente avisa e solicita pagamento — segue fluxo T2 → PIX → coleta de dados → link mágico. Sofia é reservada por 5 min após o webhook confirmar.\n\n' +
      'Status na fila:\n\n' +
      '— ATIVA: cliente está aguardando ativamente.\n\n' +
      '— AUSENTE: não respondeu ao aviso em 5 minutos. Fica no topo da fila. Quando voltar e falar qualquer coisa, status volta para ATIVA.',
  },

  /** T3c — citações <em> e encadeamento do doc. */
  T3c: {
    text:
      'Bot detecta que uma taróloga ficou disponível. Gera nota privada no Chatwoot para a atendente com: nome da cliente, tempo de espera, status, e se pagou ou não. A nota inclui botão de Atualizar — a disponibilidade pode ter mudado no intervalo entre o aviso e a atendente ver a nota.\n\n' +
      'Cenário 1 — cliente já pagou:\n' +
      'Atendente clica em "Atualizar", confirma disponibilidade, e avisa: "Sua vez chegou! Você pode fazer sua consulta agora? 💜"\n\n' +
      'Se confirmar → atribuição direta → link mágico. Ela já pagou, já escolheu pacote e modalidade. Não há nada a repetir.\n\n' +
      'Cenário 2 — cliente na fila sem ter pago:\n' +
      'Nota privada destaca ⚠️ ainda não pagou. Atendente clica em "Atualizar", confirma disponibilidade, e avisa: "Sua vez chegou 💜 Você tem 5 minutos para entrar em consulta... Para garantir sua consulta com a Sofia, escolha seu pacote:"\n\n' +
      'Cliente escolhe pacote → T2 → PIX → webhook confirma → Sofia reservada por 5 min → T5 coleta dados → T8 link mágico. Se demorar mais que 5 min → reserva libera → reatribui na T8.\n\n' +
      'Se não responder em 5 minutos: status muda para AUSENTE. Topo da fila preservado. Nenhuma mensagem enviada. Quando voltar e falar qualquer coisa, bot verifica disponibilidade:\n\n' +
      '— Taróloga disponível → "Que bom te ver de volta! A Sofia está disponível agora 💜" → atribuição → link mágico.\n' +
      '— Taróloga em consulta → "A Sofia entrou em atendimento — te aviso assim que terminar 💜" → ATIVA.\n' +
      '— Nenhuma livre → bot avisa atendente → estimativa → ATIVA.',
  },

  /** leads_agenda — parágrafos da tela (sem caixas "why"). */
  leads_agenda: {
    text:
      'O que é leads_agenda: tabela que registra leads (sem cadastro, sem pagamento) que pediram uma taróloga específica indisponível no momento. Não é fila — não há reserva, não há posição. É apenas um aviso agendado.\n\n' +
      'Quando a taróloga voltar, o bot retoma a conversa com a lead e recomeça o fluxo de compra do zero em T2 (pacotes → PIX → coleta de dados → link mágico).\n\n' +
      'Se a lead não responder ao aviso → status expirada. Sem recontato.',
  },

  /** T4 — envio PIX + comprovante <em> + timeout. */
  T4: {
    text:
      'Gera cobrança no Mercado Pago com external_reference = conversation_id do Chatwoot.\n\n' +
      'Envia chave PIX email ({{pix_email}}) com o nome do favorecido visível. QR code aparece discretamente como segunda opção.\n\n' +
      '"Assim que fizer você me passa o comprovante? 🙏🏻 Aí, já dou sequência na sua consulta!"\n\n' +
      'Timeout: PIX expira em 30 min. Carrinho abandonado — sem recontato, sem reenvio.',
  },

  /** T4b — <em> do doc ("R$XX,XX"). */
  T4b: {
    text:
      'Webhook MP confirmou. Sistema cria imediatamente um cadastro provisório com: conversation_id + telefone (capturado pela Evolution API) + dados completos do pagamento (valor, pacote, modalidade, timestamp). Nome WhatsApp é registrado como identificação temporária.\n\n' +
      'Reserva uma taróloga disponível por 5 minutos. Se a cliente não completar o fluxo até a T8 nesse tempo, a reserva é liberada e uma nova taróloga é atribuída na T8.\n\n' +
      '"Localizei seu pagamento de {{valor_pagamento}}!" — mesma mensagem independente de ter chegado pelo webhook ou pelo comprovante.',
  },

  /** T4c — <em>. */
  T4c: {
    text:
      '"Um momento, vou confirmar o pagamento..."\n\n' +
      'Consulta MP — pagamento não localizado. Cria nota privada para a atendente: "Comprovante recebido · pagamento não localizado no MP · verificar manualmente · PIX via conversation_id". Atendente assume para tentar localizar o pagamento e informar a cliente com cortesia.',
  },

  /** T5 — pedido único + e-mail opcional + tratar_por (doc). */
  T5: {
    text:
      'Pede em uma única mensagem: nome completo · data de nascimento · e-mail (opcional).\n\n' +
      'E-mail: muitas clientes dizem que não sabem ou não têm. Se não informar → email_pendente=true. O fluxo não para.\n\n' +
      'tratar_por: extraído silenciosamente do primeiro nome do nome completo. Não perguntamos — o contexto é uma consulta íntima, não o início de um relacionamento comercial. Usar o primeiro nome desde o início cria conexão sem criar atrito.',
  },

  /** T6 — parágrafos fora de `.why`. */
  T6: {
    text:
      'IA extrai nome completo · nascimento · e-mail da mensagem livre da cliente.\n\n' +
      'Salva imediatamente os dados extraídos no cadastro provisório com flag confirmacao_pendente = true. Não espera o "Sim" da cliente para persistir — o pagamento já foi feito e os dados não podem ser perdidos.\n\n' +
      'Exibe os dados para confirmação. Dois estados: com e-mail · sem e-mail.\n\n' +
      '— Cliente diz "Sim!" → sistema atualiza confirmacao_pendente = false · nome WhatsApp temporário substituído pelo nome completo · fluxo segue.\n\n' +
      '— Não responde em 2 minutos: dados já estão salvos com confirmacao_pendente = true. Sistema gera nota privada para a atendente. Atendente revisa, corrige se necessário, e confirma manualmente. Nenhum dado é perdido.\n\n' +
      'Se precisar corrigir → atendente assume. A atendente tem na nota privada o link direto para editar o cadastro no sistema.',
  },

  /** T7 — oferta + citações <em>. */
  T7: {
    text:
      'Nota privada gerada automaticamente com: id do cadastro + nome completo + link para editar cadastro. A atendente tem acesso se precisar.\n\n' +
      'Oferece por padrão: 🌐 Chat na plataforma · 📞 Telefone.\n\n' +
      'Se a cliente perguntar sobre WhatsApp → bot explica: "Pelo WhatsApp a taróloga veria seu número. Pelo chat da nossa plataforma, não 💜" — e só então oferece WhatsApp texto e áudio.\n\n' +
      'Exceção — cliente que comprou vídeo: se perguntar sobre WhatsApp, bot responde: "Vídeo somente pelo chat da nossa plataforma 💜" — sem oferecer alternativa. Não há vídeo por WhatsApp.',
  },

  /** T8 — parágrafos fora de `.why`. */
  T8: {
    text:
      'Atribui automaticamente a taróloga disponível com maior pontuação de ranking (calculado diariamente: retornos + avaliação ponderada pela frequência da cliente + tempo médio de consulta, todos relativos à média da plataforma nos últimos 30 dias).\n\n' +
      'Envia card com nome e especialidade da taróloga + botão de entrada.\n\n' +
      'Link mágico: token temporário · sem login · sem senha · expira em 5 minutos.\n\n' +
      'Se o link expirar: "Se precisar de mais tempo, Sofia pode não estar disponível, mas me chama aqui! Escreva: continuar"',
  },

  /** T8wa — parágrafos fora de `.why`. */
  T8wa: {
    text:
      'Exibe na conversa: "Atendente saiu dessa conversa" · "Sofia entrou na conversa"\n\n' +
      '"✨ Quem vai te atender é a Sofia, ela já está te esperando! A partir de agora ela vai continuar aqui com você 💜"\n\n' +
      'Abre conversa nova e limpa no Chatwoot para a taróloga com apenas: tratar_por · nascimento · modalidade · tempo de consulta. A taróloga nunca vê o histórico da venda, o número da cliente, dados fiscais ou financeiros.',
  },

  /** T9 — só aparece no diagrama do fluxo no HTML (sem nova tela §3 separada). */
  T9: {
    text: 'T9 — cliente entra na sala via link mágico · sem login.',
  },

  _: {
    transicao_invalida: 'Passo não pôde ser avançado da forma esperada pelo fluxo configurado.',
    ferramenta_indisponivel: 'Ferramenta ou dado solicitado não estão disponíveis neste momento.',
  },
};

const NEXT_STATE_AFTER_MESSAGE = {
  T1: 'T2',
  T1b: 'T1b',
  T1c: 'T2',
  T2: 'T3',
  T2v: 'T3',
  T3: 'T4',
  T3b: 'T4',
  T3c: 'T4',
  leads_agenda: 'T2',
  T4: 'T4b',
  T4b: 'T5',
  T4c: 'T4',
  T5: 'T6',
  T6: 'T7',
  T7: 'T8',
  T8: 'T9',
  T8wa: 'T9',
  T9: 'CONVERSATION_LIVRE',
};

const ALL_FLOW_KEYS = Object.keys(FLOW_MESSAGES).filter((k) => k !== '_');

function applyPlaceholders(template, context = {}) {
  if (template == null) return '';
  let out = String(template);
  out = out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, rawKey) => {
    const key = String(rawKey).trim();
    const v = context[key];
    if (v != null && v !== '') return String(v);
    return '';
  });
  return out;
}

/** @returns {{ text: string, buttons: FlowButton[], key: string, defaultNextState: string | null }} */
function getMessage(state, context = {}) {
  const key = `${state || ''}`.trim();
  const merged = normalizeContext(context);
  const entry = FLOW_MESSAGES[key];
  if (!entry || typeof entry !== 'object' || typeof entry.text !== 'string') {
    return {
      text: '',
      buttons: [],
      key,
      defaultNextState: getDefaultNextStateAfterMessage(key),
    };
  }

  const text = applyPlaceholders(entry.text, merged).trim();
  const buttons = Array.isArray(entry.buttons)
    ? entry.buttons.map((b) => ({
        label: applyPlaceholders(b.label, merged),
        value: `${b.value || ''}`,
      }))
    : [];

  return {
    text,
    buttons,
    key,
    defaultNextState: getDefaultNextStateAfterMessage(key) ?? null,
  };
}

function normalizeContext(context) {
  const c = context && typeof context === 'object' && !Array.isArray(context) ? { ...context } : {};
  const slots = c.slots && typeof c.slots === 'object' && !Array.isArray(c.slots) ? { ...c.slots } : {};
  if (!`${c.nome_tarologa || ''}`.trim() && slots.nome_tarologa) c.nome_tarologa = slots.nome_tarologa;
  if (!`${c.nome_completo || ''}`.trim() && slots.nome_completo) c.nome_completo = slots.nome_completo;
  if (!`${c.data_nascimento || ''}`.trim() && slots.data_nascimento) c.data_nascimento = slots.data_nascimento;
  if (!`${c.email_ou_pendente || ''}`.trim() && slots.email_ou_pendente) c.email_ou_pendente = slots.email_ou_pendente;
  if (!`${c.valor_pagamento || ''}`.trim() && slots.valor_pagamento) c.valor_pagamento = slots.valor_pagamento;
  if (!`${c.pix_email || ''}`.trim() && slots.pix_email) c.pix_email = slots.pix_email;
  if (!`${c.tempo_espera || ''}`.trim() && slots.tempo_espera) c.tempo_espera = slots.tempo_espera;

  const out = {
    nome_tarologa: `${c.nome_tarologa || 'Sofia'}`.trim(),
    nome_completo: `${c.nome_completo || ''}`.trim(),
    data_nascimento: `${c.data_nascimento || ''}`.trim(),
    email_ou_pendente: `${c.email_ou_pendente || (c.email ? c.email : 'não informado (email_pendente)')}`.trim(),
    valor_pagamento: `${c.valor_pagamento || 'R$XX,XX'}`.trim(),
    pix_email: `${c.pix_email || ''}`.trim(),
    tempo_espera: `${c.tempo_espera || '12 min'}`.trim(),
    email: `${c.email || ''}`.trim(),
    ...slots,
    ...c,
  };
  return out;
}

function getDefaultNextStateAfterMessage(stateKey) {
  const next = NEXT_STATE_AFTER_MESSAGE[stateKey];
  return next != null ? next : null;
}

const erros = {
  estado_desconhecido: 'Estado desconhecido no fluxo.',
  transicao_invalida: FLOW_MESSAGES._.transicao_invalida,
  ferramenta_indisponivel: FLOW_MESSAGES._.ferramenta_indisponivel,
};

module.exports = {
  FLOW_MESSAGES,
  ALL_FLOW_KEYS,
  NEXT_STATE_AFTER_MESSAGE,
  applyPlaceholders,
  getMessage,
  getDefaultNextStateAfterMessage,
  normalizeContext,
  erros,
};
