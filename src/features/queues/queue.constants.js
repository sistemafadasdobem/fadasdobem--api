'use strict';

/**
 * Textos isolados para fila ao vivo — notas Chatwoot, atalhos de atendente e bots.
 * Substitua chaves `{nome_da_var}` usando `formatQueueTemplate`.
 */

const MSG_PRIVATE_NOTE_ATTENDANT =
  '⚡ {specialist_name} ficou disponível. Próxima na fila: {client_name}. Aguardando há: {wait_time} min.\n\nVerifique a disponibilidade e dispare o atalho correspondente.';

/** Texto quando a atendente confirma e o cliente já tem saldo/consulta paga manualmente configurada no fluxo. */
const MSG_QUEUE_PAID =
  'Sua vez chegou! Você pode fazer sua consulta agora? 💜';

/** Texto quando a atendente guia cliente sem consulta garantida até o pacote/checkout. */
const MSG_QUEUE_UNPAID =
  '{client_name}! Sua vez chegou 💜 Você tem 5 minutos para entrar em consulta... Para garantir sua consulta com a {specialist_name}, escolha seu pacote:';

/** Bot / outbound para lead com agenda (contexto próprio da automação Chatwoot). */
const MSG_LEADS_AGENDA_BOT =
  'Oi {client_name}! 💜 A {specialist_name} ficou disponível agora.\n\nQuer consultar com ela?';

/** Bot — retorno após período ausente reconhecido no fluxo. */
const MSG_ABSENT_RETURN_BOT =
  'Que bom te ver de volta, {client_name}! 💜 Sua taróloga está disponível agora.';

/** Bot genérico — vitrine / sem nome resolvido. */
const MSG_GENERIC_AVAILABLE_BOT =
  'Temos tarólogas disponíveis agora! 💜';

/**
 * Substitui `{chave}` no template; valores em falha mantêm o placeholder literal.
 *
 * @param {string} template
 * @param {Record<string, string|number|null|undefined>} vars
 */
function formatQueueTemplate(template, vars = {}) {
  if (typeof template !== 'string' || !template) return '';
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) return match;
    const v = vars[key];
    if (v === null || v === undefined) return '';
    return String(v);
  });
}

module.exports = {
  MSG_PRIVATE_NOTE_ATTENDANT,
  MSG_QUEUE_PAID,
  MSG_QUEUE_UNPAID,
  MSG_LEADS_AGENDA_BOT,
  MSG_ABSENT_RETURN_BOT,
  MSG_GENERIC_AVAILABLE_BOT,
  formatQueueTemplate,
};
