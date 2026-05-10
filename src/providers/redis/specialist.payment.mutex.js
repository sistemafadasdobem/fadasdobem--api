'use strict';

const AppError = require('../../utils/AppError');
const { getRedisConnection } = require('./redis.connection');

function mutexKey(specialistId) {
  const sid = `${specialistId || ''}`.trim();
  if (!sid) return null;
  return `specialist_mutex:${sid}`;
}

/**
 * @returns {{ ok: true } | { ok: false; reason: 'lock_held' | 'redis_unconfigured' }}
 */
async function acquireSpecialistPaymentMutex(specialistId, orderId, ttlSeconds = 30) {
  const key = mutexKey(specialistId);
  if (!key) return { ok: false, reason: 'redis_unconfigured' };

  const redis = getRedisConnection();
  if (redis === false) {
    return { ok: false, reason: 'redis_unconfigured' };
  }
  if (!redis || redis === null) {
    console.error('[payments:redis_mutex] REDIS não configurado — obrigatório para reserva especialista.');
    throw new AppError(
      'Infraestrutura de filas indisponível (Redis). Tente novamente em instantes.',
      503,
      { code: 'REDIS_UNAVAILABLE' },
      false
    );
  }

  const val = `${orderId}`.trim();
  const ttl = Number(ttlSeconds) > 0 ? Number(ttlSeconds) : 30;

  /** `SET … NX EX` — lock efémero contra double-booking em webhooks concorrentes. */
  const res = await redis.set(key, val, 'NX', 'EX', ttl);
  if (res === 'OK') return { ok: true };

  return { ok: false, reason: 'lock_held' };
}

/**
 * Liberta só se o valor ainda corresponde ao `order_id` (evita libertar mutex de outro pagamento).
 */
async function releaseSpecialistPaymentMutex(specialistId, orderId) {
  const key = mutexKey(specialistId);
  if (!key) return;

  const redis = getRedisConnection();
  if (!redis || redis === false) return;

  const want = `${orderId}`.trim();
  try {
    const held = await redis.get(key);
    if (held != null && String(held) === want) {
      await redis.del(key);
    }
  } catch (e) {
    console.warn('[payments:redis_mutex] release falhou:', e?.message || e);
  }
}

module.exports = {
  acquireSpecialistPaymentMutex,
  releaseSpecialistPaymentMutex,
};
