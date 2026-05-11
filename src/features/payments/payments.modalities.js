'use strict';

const { loadPackageCatalog } = require('./payments.constants');

/** Pacotes sem JSON explícito: texto/voz agrupados (vide dossiê). */
const FALLBACK_PACOTE_TEXT_VOICE = ['TEXTO', 'VOZ'];

/**
 * @param {unknown} modalities
 * @returns {string[]|null}
 */
function normalizeConsumptionsModalitiesArray(modalities) {
  if (!Array.isArray(modalities)) return null;
  const out = modalities
    .map((x) => `${x || ''}`.trim().toUpperCase())
    .filter((x) => x === 'TEXTO' || x === 'VOZ' || x === 'VIDEO');
  return out.length ? out : null;
}

/**
 * @param {Record<string, unknown>} checkoutCtx checkout_context PaymentOrder ou equivalente Lead FSM.
 * @param {string|null} explicitPackageKey `package_id` ou `package_id_fsm`
 */
function resolveConsumptionModalitiesForLot(checkoutCtx = {}, explicitPackageKey = null) {
  const ctx = checkoutCtx && typeof checkoutCtx === 'object' ? checkoutCtx : {};
  const fromCtx = normalizeConsumptionsModalitiesArray(ctx.consumption_modalities);
  if (fromCtx) return fromCtx;

  const catalog = loadPackageCatalog();
  const pkgKey =
    (explicitPackageKey && `${explicitPackageKey}`.trim()) ||
    (ctx.package_id != null ? `${ctx.package_id}`.trim() : '') ||
    (ctx.package_id_fsm != null ? `${ctx.package_id_fsm}`.trim() : '');

  if (pkgKey && catalog[pkgKey] && Array.isArray(catalog[pkgKey].consumption_modalities)) {
    const parsed = normalizeConsumptionsModalitiesArray(catalog[pkgKey].consumption_modalities);
    if (parsed) return parsed;
  }

  return [...FALLBACK_PACOTE_TEXT_VOICE];
}

/**
 * @param {string} sessionModality `TEXTO` | `VOZ` | `VIDEO`
 * @param {unknown} lotConsumptionModalidades JSON armazenado no lote (`null`/vazio = aceita todas — legado)
 */
function sessionModalityMatchesPacoteLot(sessionModality, lotConsumptionModalidades) {
  const m = `${sessionModality || ''}`.trim().toUpperCase();
  if (!m || (m !== 'TEXTO' && m !== 'VOZ' && m !== 'VIDEO')) return false;
  const arr = normalizeConsumptionsModalitiesArray(lotConsumptionModalidades);
  if (!arr) return true;
  const set = new Set(arr);
  if (m === 'VIDEO') return set.has('VIDEO');
  if (m === 'TEXTO' || m === 'VOZ') return set.has('TEXTO') || set.has('VOZ');
  return false;
}

module.exports = {
  resolveConsumptionModalitiesForLot,
  sessionModalityMatchesPacoteLot,
  FALLBACK_PACOTE_TEXT_VOICE,
};
