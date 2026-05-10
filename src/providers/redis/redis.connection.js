'use strict';

let RedisCtor;
try {
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  RedisCtor = require('ioredis');
} catch {
  RedisCtor = null;
}

/** @type {ReturnType<any> | null | false | undefined} */
let shared;

/**
 * Ligado só quando há `REDIS_URL` ou (`REDIS_HOST` + porta).
 * Para BullMQ usar `duplicate()` sobre esta instância.
 */
function createRedisConnection() {
  if (!RedisCtor) return false;

  const url = `${process.env.REDIS_URL || ''}`.trim();
  if (url) {
    return new RedisCtor(url, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    });
  }

  const host = `${process.env.REDIS_HOST || ''}`.trim();
  if (!host) return null;

  const portRaw = `${process.env.REDIS_PORT || '6379'}`.trim();
  const password = `${process.env.REDIS_PASSWORD || ''}`.trim();
  const port = Number(portRaw);
  return new RedisCtor({
    host,
    port: Number.isFinite(port) ? port : 6379,
    ...(password ? { password } : {}),
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  });
}

function getRedisConnection() {
  if (!RedisCtor) return false;

  if (shared === undefined) {
    shared = createRedisConnection();
  }

  return shared;
}

module.exports = {
  getRedisConnection,
};
