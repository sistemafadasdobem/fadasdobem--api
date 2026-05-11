'use strict';

const AppError = require('./AppError');

/**
 * Discagem BR para WideVoice (`destino` em `clicktocall`).
 *
 * - **DDD “local”** (`INTELBRAS_DIAL_LOCAL_DDD`, default **11**) → só `DDD+assinante`, sem `011`.
 * - **Outros DDD** → por defeito **`011`+DDD+assinante**. Com **`INTELBRAS_DIAL_USE_011_FOR_NON_LOCAL=false`**
 *   fica só `DDD+número` (**exemplo doc Intelbras**: também pode exigir **`0`+DDD+número** →
 *   **`INTELBRAS_CLICKTOCALL_PREPEND_ZERO=true`** só para chamadas onde DDD ≠ local).
 */

function onlyDigits(input) {
  return `${input ?? ''}`.replace(/\D/g, '');
}

function use011TrunkForNonLocalDdd() {
  const v = `${process.env.INTELBRAS_DIAL_USE_011_FOR_NON_LOCAL ?? 'true'}`.trim().toLowerCase();
  /** default true — mantém comportamento anterior (DDD ≠ local ⇒ prefixo 011). */
  return !(v === 'false' || v === '0' || v === 'no' || v === 'off');
}

function clickToCallPrependLeadingZeroForNonLocal() {
  const v = `${process.env.INTELBRAS_CLICKTOCALL_PREPEND_ZERO ?? 'false'}`.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
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

  /** Remove zeros à esquerda até o comprimento ficar ≤11 (ex.: `0719…` → `719…`). */
  while (d.startsWith('0') && d.length > 11) {
    d = d.slice(1);
  }
  /** Ex.: doc WideVoice `04821060006` (**0 + DDD + fixo**) — comprimento **11**; o ``while`` acima só atua quando **>11**. */
  if (d.startsWith('0') && d.length === 11) {
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

  let formatted;
  if (ddd === localDdd) {
    formatted = `${ddd}${subscriber}`;
  } else if (!use011TrunkForNonLocalDdd()) {
    formatted = `${ddd}${subscriber}`;
  } else {
    formatted = `011${ddd}${subscriber}`;
  }

  /** Só faz sentido com tronco `011` desligado; reproduz padrão `048…` da documentação. */
  if (
    clickToCallPrependLeadingZeroForNonLocal() &&
    !use011TrunkForNonLocalDdd() &&
    ddd !== localDdd
  ) {
    if (!formatted.startsWith('0')) {
      formatted = `0${formatted}`;
    }
  }

  return formatted;
}

module.exports = {
  onlyDigits,
  formatBrazilDestinationForWideVoice,
  use011TrunkForNonLocalDdd,
  clickToCallPrependLeadingZeroForNonLocal,
};
