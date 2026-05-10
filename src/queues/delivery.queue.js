'use strict';

/**
 * Outbox outbound: Worker consome mensagens gravadas na transação (PendingDelivery).
 * Fila oficial: `delivery-queue` (Mercado Pago pós‑pagamento T8 Chatwoot, etc.).
 */

const { Queue, Worker } = require('bullmq');
const { getRedisConnection } = require('../providers/redis/redis.connection');
const chatwootClient = require('../providers/chatwoot/chatwoot.client');
const { PendingDelivery } = require('../models');
const P = require('../features/chatwoot/chatwoot.workflow.prompts');

const QUEUE_NAME = 'delivery-queue';

/** @type {Queue | null} */
let queueInstance = null;

/** @type {boolean} */
let workerStarted = false;

function buildChatwootMessageFromPayload(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};

  if (p.kind === 'T8_CHATWOOT' && p.variant === 'platform') {
    const first =
      `${p.clientFirstName || ''}`.trim().slice(0, 48) ||
      `${p.placeholder_client_first || 'Cliente'}`.trim().slice(0, 48) ||
      'Cliente';
    return P.T8.platform({ clientFirstName: first });
  }

  if (p.kind === 'T8_CHATWOOT' && p.variant === 'phone') {
    const first =
      `${p.clientFirstName || ''}`.trim().slice(0, 48) || `${p.placeholder_client_first || 'Cliente'}`.slice(0, 48) || 'Cliente';
    const body = `${P.T8.phone({ clientFirstName: first })}\n\n${P.T8.phoneDialLabel}\n${P.DEMO_SPECIALIST.phoneDial}`;
    return body;
  }

  throw new Error(`PendingDelivery.payload.kind desconhecido: ${JSON.stringify(p.kind)}`);
}

function getQueue() {
  if (queueInstance) return queueInstance;

  const redis = getRedisConnection();
  if (!redis || redis === false) {
    throw new Error('[delivery-queue] Redis indisponível — configure REDIS_URL ou REDIS_HOST.');
  }

  const connection =
    typeof redis.duplicate === 'function' ? redis.duplicate({ enableOfflineQueue: false }) : redis;

  queueInstance = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 10,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });

  return queueInstance;
}

/**
 * Produz um job apenas após `transaction.commit()` com sucesso.
 *
 * @param {string} pendingDeliveryId UUID `pending_deliveries.id`
 */
async function enqueuePendingDeliveryJob(pendingDeliveryId) {
  const id = `${pendingDeliveryId || ''}`.trim();
  if (!id) return;

  const q = getQueue();

  await q.add(
    'deliver-chatwoot',
    { pendingDeliveryId: id },
    {
      jobId: id,
      attempts: 10,
      backoff: { type: 'exponential', delay: 5000 },
    }
  );
}

function attachWorkerIfEnabled() {
  if (workerStarted) return;
  workerStarted = true;

  if (`${process.env.DELIVERY_QUEUE_WORKER || ''}`.trim().toLowerCase() !== 'true') {
    return;
  }

  const redis = getRedisConnection();
  if (!redis || redis === false) {
    console.warn('[delivery-queue] DELIVERY_QUEUE_WORKER=true mas Redis está indisponível — worker omitido.');
    return;
  }

  const connection =
    typeof redis.duplicate === 'function' ? redis.duplicate({ enableOfflineQueue: false }) : redis;

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const pendingDeliveryId = `${job?.data?.pendingDeliveryId || ''}`.trim();
      if (!pendingDeliveryId) {
        throw new Error('Job sem pendingDeliveryId');
      }

      const row = await PendingDelivery.findByPk(pendingDeliveryId);
      if (!row) return { skipped: true, reason: 'row_missing' };

      if (String(row.status) === 'SENT') return { skipped: true, reason: 'already_sent' };

      await row.increment('attempts');
      await row.reload();

      try {
        const text = buildChatwootMessageFromPayload(row.payload);
        const acct = `${row.payload?.chatwootAccountId ?? row.payload?.accountId ?? ''}`.trim();
        const conv = `${row.payload?.conversationId ?? ''}`.trim();
        if (!acct || !conv) throw new Error('payload sem chatwootAccountId/accountId ou conversationId');

        await chatwootClient.postTextReply(acct, conv, text);
        await row.update({ status: 'SENT', last_error: null });
        return { sent: true };
      } catch (e) {
        const msg = `${e?.message || e}`;
        await row.update({ last_error: msg.slice(0, 6000), status: 'PENDING' });
        throw e;
      }
    },
    {
      connection,
      concurrency: 4,
      limiter: { max: 30, duration: 10000 },
    }
  );

  worker.on('failed', async (job, err) => {
    try {
      if (!job) return;

      const max = job.opts.attempts || 10;
      if (job.attemptsMade < max) return;

      const pid = `${job?.data?.pendingDeliveryId || ''}`.trim();
      if (!pid) return;

      const row = await PendingDelivery.findByPk(pid);
      if (!row) return;

      const msg = `${err?.message || err}`.slice(0, 6000);
      await row.update({ status: 'FAILED', last_error: msg });

      const acct = `${row.payload?.chatwootAccountId ?? row.payload?.accountId ?? ''}`.trim();
      const conv = `${row.payload?.conversationId ?? ''}`.trim();

      const noteLines = [
        '🔕 **Outbound pós‑pagamento (PendingDelivery)** — tentativas esgotadas na fila `delivery-queue`.',
        `- pending_delivery_id: \`${pid}\``,
        `- order_id: \`${row.order_id}\``,
        `- último erro: ${msg}`,
        'Verifique integração Chatwoot / Evolution e reprocesse ou envie mensagem manualmente.',
      ].join('\n');

      if (acct && conv) {
        await chatwootClient.postPrivateNote(acct, conv, noteLines);
      } else {
        console.warn('[delivery-queue]', noteLines);
      }
    } catch (inner) {
      console.error('[delivery-queue] handler failed exhaustion:', inner?.stack || inner);
    }
  });

  worker.on('error', (e) => {
    console.error('[delivery-queue] worker error:', e?.stack || e);
  });

  console.log('[delivery-queue] Worker iniciado (`delivery-queue`, exponential backoff interno aos jobs).');
}

module.exports = {
  QUEUE_NAME,
  getQueue,
  enqueuePendingDeliveryJob,
  attachWorkerIfEnabled,
};
