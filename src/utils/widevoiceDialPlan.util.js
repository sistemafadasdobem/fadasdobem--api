'use strict';

const AppError = require('./AppError');

/**
 * Discagem BR para WideVoice (`destino` em `clicktocall`).
 *
 * - **DDD “local”** (`INTELBRAS_DIAL_LOCAL_DDD`, default **11**) → só `DDD+assinante`, sem `011`.
 * - **Outros DDD** → por defeito **`011`+DDD+assinante**. Com **`INTELBRAS_DIAL_USE_011_FOR_NON_LOCAL=false`**
 *   fica só `DDD+número` (**exemplo doc Intelbras**: também pode exigir **`0`+DDD+número** →
 *   **`INTELBRAS_CLICKTOCALL_PREPEND_ZERO=true`** só para chamadas onde DDD ≠ local).
 * - **`INTELBRAS_CLICKTOCALL_PREPEND_ROUTE`** (ex. **`015`**) — código de seleção/rota antes do nacional; suporte pode exigir
 *   **`015` + DDD + assinante** em vez de um único `0` inicial (`PREPEND_ZERO`). Se definido para DDD≠local com tronco `011`
 *   desligado, **substitui** `INTELBRAS_CLICKTOCALL_PREPEND_ZERO` para esse caso.
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

function clickToCallDropMobileNineAfterDdd() {
  const v = `${process.env.INTELBRAS_CLICKTOCALL_DROP_MOBILE_NINE ?? 'false'}`.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

/** Prefixo de discagem/rota só dígitos (ex.: `015`) antes de `DDD+assinante` para DDD≠local — ver suporte/trunk. */
function clickToCallPrependRouteDigits() {
  return onlyDigits(process.env.INTELBRAS_CLICKTOCALL_PREPEND_ROUTE ?? '');
}

/**
 * Destino já colado com código de rota (ex.: `01571983141335`) — extrai nacional se bater com PREPEND_ROUTE.
 * Rejeita `0150719…` (0 extra após o 015).
 */
function maybePeelConfiguredRoutePrefixFromFullDial(d) {
  const routePre = clickToCallPrependRouteDigits();
  if (!routePre || !d.startsWith(routePre)) {
    return d;
  }
  if (d.length <= routePre.length + 9) {
    return d;
  }
  const national = d.slice(routePre.length);
  if (national.length >= 10 && national.length <= 11) {
    if (national.startsWith('0')) {
      throw new AppError(
        'Após o prefixo de rota (ex. 015), use DDD+número direto — sem 0 extra antes do DDD. Certo: 01571983141335. Errado: 01507183141335.',
        400,
        { campo: 'destino', exemplo_ok: `${routePre}<DDD><assinante>` },
        true
      );
    }
    return national;
  }
  throw new AppError(
    'Após o código de rota devem seguir 10 ou 11 dígitos (DDD + assinante). Em E.164 use só «55» + DDD + número (ex. 5571983141335), não «55» junto ao código tipo 015 antes do nacional.',
    400,
    { campo: 'destino', prefixo_rota_visto: routePre, digitos_apos_prefixo: national.length },
    true
  );
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

  d = maybePeelConfiguredRoutePrefixFromFullDial(d);

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
  let subscriber = d.slice(2);

  if (subscriber.length < 8) {
    throw new AppError('Número local incompleto após DDD.', 400, { campo: 'destino' }, true);
  }

  /**
   * Móvel BR: 9 + 8 dígitos após DDD. Troncos legados às vezes marcam com só 8 dígitos (sem o 9).
   */
  if (
    clickToCallDropMobileNineAfterDdd() &&
    subscriber.length === 9 &&
    subscriber.startsWith('9')
  ) {
    subscriber = subscriber.slice(1);
  }

  if (subscriber.length < 8) {
    throw new AppError('Número local incompleto após DDD (após regra do 9).', 400, { campo: 'destino' }, true);
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

  const routePre = clickToCallPrependRouteDigits();
  const nonLocalNo011 =
    !use011TrunkForNonLocalDdd() && ddd !== localDdd;

  /** Ex.: conta pede `01571983141335` (rota/código **`015`** + nacional) em vez de `0719…`. */
  if (routePre && nonLocalNo011) {
    formatted = `${routePre}${ddd}${subscriber}`;
  } else if (
    clickToCallPrependLeadingZeroForNonLocal() &&
    nonLocalNo011
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
  clickToCallPrependRouteDigits,
  clickToCallDropMobileNineAfterDdd,
};
