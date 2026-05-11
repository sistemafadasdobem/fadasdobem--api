'use strict';

const AppError = require('./AppError');

/**
 * Regra de negócio (Intelbras WideVoice / PBX São Paulo): **DDD 11 em formato local**
 * (sem prefixo trunk `011`), **demais DDD com prefixo `011`** antes do código de área quando
 * originados a partir da central configurada conforme briefing operacional Nice.
 */

function onlyDigits(input) {
  return `${input ?? ''}`.replace(/\D/g, '');
}

/**
 * Normaliza e formata o destino para o campo `destino` do `clicktocall`.
 *
 * @param {string} raw — E.164 (`5511999999999`), nacional com DDD, ou misto.
 * @param {{ localDdd?: string }} [opts] — DDD tratado como “local” (default `11`).
 * @returns {string} — Apenas dígitos, prontos para a API.
 */
function formatBrazilDestinationForWideVoice(raw, opts = {}) {
  const localDdd = `${opts.localDdd ?? process.env.INTELBRAS_DIAL_LOCAL_DDD ?? '11'}`.trim();
  let d = onlyDigits(raw);
  if (!d) {
    throw new AppError('Número de destino vazio.', 400, { campo: 'destino' }, true);
  }

  if (d.startsWith('55') && d.length > 11) {
    d = d.slice(2);
  }

  /** Remove prefixo nacional 0 habitual em discagem urbana brasileira. */
  while (d.startsWith('0') && d.length > 11) {
    d = d.slice(1);
  }

  if (d.length < 10 || d.length > 11) {
    throw new AppError(
      'Número inválido: após país/DDD esperam-se 10 ou 11 dígitos brasileiros.',
      400,
      { campo: 'destino', digitos: d.length },
      true
    );
  }

  const ddd = d.slice(0, 2);
  const subscriber = d.slice(2);

  if (subscriber.length < 8) {
    throw new AppError('Número local incompleto após DDD.', 400, { campo: 'destino' }, true);
  }

  if (!/^\d{2}$/.test(ddd)) {
    throw new AppError('DDD inválido.', 400, { campo: 'destino' }, true);
  }

  if (ddd === localDdd) {
    return `${ddd}${subscriber}`;
  }

  return `011${ddd}${subscriber}`;
}

module.exports = {
  onlyDigits,
  formatBrazilDestinationForWideVoice,
};
