const Redis = require('ioredis');
const { BotConversationFlowState } = require('../../models');

const KEY_PREFIX = 'fadbem:anthropic-flow:v1';
const CACHE_TTL_SEC = 60 * 60 * 24 * 90; // 90d

/** @type {import('ioredis').default | false | null} */
let redisClient = false;

function useRedisConfigured() {
  return Boolean(`${process.env.REDIS_URL || ''}`.trim() || `${process.env.REDIS_HOST || ''}`.trim());
}

function getRedisSync() {
  if (redisClient === false || redisClient === null) return null;
  return redisClient;
}

/**
 * Ligado só quando há configuração de Redis (`REDIS_URL` ou `REDIS_HOST`).
 * Falha degradam para Postgres apenas (warn uma vez por processo).
 */
function connectRedisLazy() {
  if (redisClient !== false) return getRedisSync();
  if (!useRedisConfigured()) {
    redisClient = null;
    return null;
  }
  try {
    const url = `${process.env.REDIS_URL || ''}`.trim();
    redisClient =
      url
        ? new Redis(url, {
            maxRetriesPerRequest: 3,
          })
        : new Redis({
            host: process.env.REDIS_HOST,
            port: Number(process.env.REDIS_PORT || 6379),
            password: process.env.REDIS_PASSWORD || undefined,
            db: Number(process.env.REDIS_DB || 0),
            maxRetriesPerRequest: 3,
          });

    redisClient.on('error', (err) => {
      console.warn('[anthropic.workflow.store][redis]', err.message);
    });
    return redisClient;
  } catch (err) {
    console.warn('[anthropic.workflow.store] Redis não disponível:', err.message);
    redisClient = null;
    return null;
  }
}

function cacheKey(accountId, conversationId) {
  return `${KEY_PREFIX}:${accountId}:${conversationId}`;
}

/**
 * @returns {Promise<{ state: string, slots: object } | null>}
 */
async function load(accountId, conversationId, provider = 'anthropic') {
  const cid = `${conversationId}`.trim();
  const aid = `${accountId}`.trim();

  const r = connectRedisLazy();
  if (r) {
    try {
      const raw = await r.get(cacheKey(aid, cid));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.state === 'string') {
          return { state: parsed.state, slots: parsed.slots || {} };
        }
      }
    } catch {
      // ignora cache inválido
    }
  }

  const row = await BotConversationFlowState.findOne({
    where: {
      account_id: aid,
      conversation_id: cid,
      provider,
    },
  });
  if (!row) return null;

  const snapshot = { state: row.current_state, slots: row.slots || {} };

  if (r) {
    try {
      await r.set(cacheKey(aid, cid), JSON.stringify(snapshot), 'EX', CACHE_TTL_SEC);
    } catch {
      // ignora falha de cache
    }
  }

  return snapshot;
}

/**
 * @param {{ state: string, slots?: object }} body
 */
async function save(accountId, conversationId, body, provider = 'anthropic') {
  const cid = `${conversationId}`.trim();
  const aid = `${accountId}`.trim();
  const state = `${body.state}`.trim();
  const slots = body.slots && typeof body.slots === 'object' && !Array.isArray(body.slots) ? body.slots : {};

  const [row, created] = await BotConversationFlowState.findOrCreate({
    where: {
      account_id: aid,
      conversation_id: cid,
      provider,
    },
    defaults: {
      current_state: state,
      slots,
    },
  });
  if (!created) {
    await row.update({ current_state: state, slots });
  }

  const r = connectRedisLazy();
  if (r) {
    try {
      await r.set(cacheKey(aid, cid), JSON.stringify({ state, slots }), 'EX', CACHE_TTL_SEC);
    } catch {
      // ignora
    }
  }
}

module.exports = {
  load,
  save,
  useRedisConfigured,
};
