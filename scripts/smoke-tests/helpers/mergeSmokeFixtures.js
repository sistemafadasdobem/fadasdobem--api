'use strict';

/**
 * Une IDs de teardown de várias fixtures (dedupe estável por ordem de chegada).
 * @param  {...Partial<import('../setup').SmokeFixtureIds>} parts
 */
function mergeSmokeFixtures(...parts) {
  /** @type {import('../setup').SmokeFixtureIds} */
  const out = {
    userIds: [],
    clientIds: [],
    specialistIds: [],
    paymentOrderIds: [],
    sessionIds: [],
    queueIds: [],
    pendingDeliveryIds: [],
    ledgerAccountIds: [],
    ledgerEntryIds: [],
  };
  const seen = {};
  function pushDedupe(key, id) {
    if (!id) return;
    const kmap = seen[key] || (seen[key] = new Set());
    if (kmap.has(id)) return;
    kmap.add(id);
    out[key].push(id);
  }

  for (const p of parts) {
    if (!p || typeof p !== 'object') continue;
    (p.userIds || []).forEach((id) => pushDedupe('userIds', id));
    (p.clientIds || []).forEach((id) => pushDedupe('clientIds', id));
    (p.specialistIds || []).forEach((id) => pushDedupe('specialistIds', id));
    (p.paymentOrderIds || []).forEach((id) => pushDedupe('paymentOrderIds', id));
    (p.sessionIds || []).forEach((id) => pushDedupe('sessionIds', id));
    (p.queueIds || []).forEach((id) => pushDedupe('queueIds', id));
    (p.pendingDeliveryIds || []).forEach((id) => pushDedupe('pendingDeliveryIds', id));
    (p.ledgerAccountIds || []).forEach((id) => pushDedupe('ledgerAccountIds', id));
    (p.ledgerEntryIds || []).forEach((id) => pushDedupe('ledgerEntryIds', id));
  }
  return out;
}

module.exports = { mergeSmokeFixtures };
