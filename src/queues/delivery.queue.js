'use strict';

/**
 * Outbox outbound: Worker consome mensagens gravadas na transação (PendingDelivery).
 * Fila oficial: `delivery-queue` (Mercado Pago pós‑pagamento T8 Chatwoot, etc.).
 *
 * Produção: shutdown gracioso + reconciliador PENDING (>10 min → re‑enqueue; jobId=idempotência).
 */

const { Op } = require('sequelize');
const { Queue, Worker } = require('bullmq');
const { getRedisConnection } = require('../providers/redis/redis.connection');
const chatwootClient = require('../providers/chatwoot/chatwoot.client');
const { PendingDelivery } = require('../models');
const P = require('../features/chatwoot/chatwoot.workflow.prompts');

const QUEUE_NAME = 'delivery-queue';

const SWEEP_MIN_AGE_MS = 10 * 60 * 1000;
const SWEEP_SCHEDULER_MS = 30 * 60 * 1000;
const OUTBOX_SCHEDULER_ID = 'pending-deliveries-outbox-sweep';

/** @type {Queue | null} */
let queueInstance = null;

/** @type {import('bullmq').Worker | null} */
let workerInstance = null;

/** @type {boolean} */
let workerActive = false;

/** Evita enqueue durante teardown (best-effort). */
let shuttingDownMessaging = false;

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
      `${p.clientFirstName || ''}`.trim().slice(0, 48) ||
      `${p.placeholder_client_first || 'Cliente'}`.slice(0, 48) ||
      'Cliente';
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

async function reconcileStalePendingDeliveries() {
  const cutoff = new Date(Date.now() - SWEEP_MIN_AGE_MS);
  const stale = await PendingDelivery.findAll({
    where: {
      status: 'PENDING',
      created_at: { [Op.lt]: cutoff },
    },
    attributes: ['id'],
    order: [['created_at', 'ASC']],
    limit: 500,
  });

  const summary = {
    cutoff_iso: cutoff.toISOString(),
    stale_rows_scanned_in_batch: stale.length,
    requeued_attempts: 0,
    enqueue_skipped_or_duplicate: 0,
    enqueue_errors: 0,
  };

  for (const row of stale) {
    const id = `${row.id || ''}`.trim();
    if (!id) continue;
    try {
      await enqueuePendingDeliveryJob(id);
      summary.requeued_attempts += 1;
    } catch (e) {
      const msg = `${e?.message || e}`;
      const duplicate =
        /\bduplicate\b/i.test(msg) ||
        /\bjob id already exists\b/i.test(msg) ||
        /\bjoberror\b/i.test(`${e?.name}`) && /already exists/i.test(msg);
      if (duplicate) {
        summary.enqueue_skipped_or_duplicate += 1;
        continue;
      }
      summary.enqueue_errors += 1;
      console.warn('[delivery-queue:outbox-sweep] falha enqueue', id, msg);
    }
  }

  if (summary.requeued_attempts > 0 || summary.enqueue_errors > 0 || summary.enqueue_skipped_or_duplicate > 0) {
    console.log('[delivery-queue:outbox-sweep] ciclo:', summary);
  }

  return summary;
}

async function registerOutboxSweepScheduler(queue) {
  try {
    await queue.upsertJobScheduler(
      OUTBOX_SCHEDULER_ID,
      { every: SWEEP_SCHEDULER_MS },
      {
        name: 'outbox-sweep',
        data: {},
        opts: {
          attempts: 2,
          backoff: { type: 'fixed', delay: 8000 },
          removeOnComplete: { count: 30 },
          removeOnFail: { count: 10 },
        },
      }
    );
    console.log(
      `[delivery-queue] Scheduler idempotente \`${OUTBOX_SCHEDULER_ID}\` — sweep a cada ${SWEEP_SCHEDULER_MS / 60000} min.`
    );
  } catch (e) {
    console.error('[delivery-queue] falha ao registar scheduler de sweep:', e?.stack || e);
  }
}

/**
 * Produz um job apenas após `transaction.commit()` com sucesso.
 *
 * @param {string} pendingDeliveryId UUID `pending_deliveries.id`
 */
async function enqueuePendingDeliveryJob(pendingDeliveryId) {
  const id = `${pendingDeliveryId || ''}`.trim();
  if (!id) return;

  if (shuttingDownMessaging) {
    console.warn('[delivery-queue] enqueue omitido durante shutdown:', id);
    return;
  }

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

/**
 * Encerra Worker (drena trabalhos activos onde BullMQ permite) e depois fecha a Queue.
 */
async function shutdownDeliveryMessaging() {
  shuttingDownMessaging = true;

  if (workerInstance) {
    try {
      await workerInstance.close();
      console.log('[delivery-queue] Worker fechado (draining concluído ou timeout interno BullMQ).');
    } catch (e) {
      console.error('[delivery-queue] worker.close:', e?.message || e);
    }
    workerInstance = null;
  }

  if (queueInstance) {
    try {
      await queueInstance.close();
      console.log('[delivery-queue] Queue fechada.');
    } catch (e) {
      console.error('[delivery-queue] queue.close:', e?.message || e);
    }
    queueInstance = null;
  }
}

/**
 * Execução unitária do job `deliver-chatwoot` (útil a testes smoke sem Worker BullMQ activo).
 * @returns {Promise<{ skipped?:boolean, sent?:boolean, reason?: string }>}
 */
async function deliverPendingDeliveryOnce(pendingDeliveryId) {
  const pendingDeliveryId_norm = `${pendingDeliveryId || ''}`.trim();
  if (!pendingDeliveryId_norm) {
    throw new Error('pendingDeliveryId ausente');
  }

  const row = await PendingDelivery.findByPk(pendingDeliveryId_norm);
  if (!row) return { skipped: true, reason: 'row_missing' };

  if (String(row.status) === 'SENT') return { skipped: true, reason: 'already_sent' };

  await row.increment('attempts');
  await row.reload();

  try {
    const text = buildChatwootMessageFromPayload(row.payload);
    const acct = `${row.payload?.chatwootAccountId ?? row.payload?.accountId ?? ''}`.trim();
    const conv = `${row.payload?.conversationId || ''}`.trim();
    if (!acct || !conv) throw new Error('payload sem chatwootAccountId/accountId ou conversationId');

    await chatwootClient.postTextReply(acct, conv, text);
    await row.update({ status: 'SENT', last_error: null });
    return { sent: true };
  } catch (e) {
    const msg = `${e?.message || e}`;
    await row.update({ last_error: msg.slice(0, 6000), status: 'PENDING' });
    throw e;
  }
}

function attachWorkerIfEnabled() {
  if (`${process.env.DELIVERY_QUEUE_WORKER || ''}`.trim().toLowerCase() !== 'true') {
    return;
  }

  if (workerActive) return;

  const redis = getRedisConnection();
  if (!redis || redis === false) {
    console.warn('[delivery-queue] DELIVERY_QUEUE_WORKER=true mas Redis está indisponível — worker omitido.');
    return;
  }

  workerActive = true;

  const queue = getQueue();
  registerOutboxSweepScheduler(queue).catch((err) =>
    console.error('[delivery-queue] registerOutboxSweepScheduler async:', err?.message || err)
  );

  const connection =
    typeof redis.duplicate === 'function' ? redis.duplicate({ enableOfflineQueue: false }) : redis;

  workerInstance = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (`${job?.name}` === 'outbox-sweep') {
        return reconcileStalePendingDeliveries();
      }

      const pendingDeliveryId = `${job?.data?.pendingDeliveryId || ''}`.trim();
      if (!pendingDeliveryId) {
        throw new Error('Job sem pendingDeliveryId');
      }

      return deliverPendingDeliveryOnce(pendingDeliveryId);
    },
    {
      connection,
      concurrency: 4,
      limiter: { max: 30, duration: 10000 },
    }
  );

  workerInstance.on('failed', async (job, err) => {
    try {
      if (!job) return;

      const sweep = `${job?.name}` === 'outbox-sweep';
      if (sweep) {
        console.error('[delivery-queue] outbox-sweep job falhou:', err?.stack || err);
        return;
      }

      const max = job.opts.attempts || 10;
      if (job.attemptsMade < max) return;

      const pid = `${job?.data?.pendingDeliveryId || ''}`.trim();
      if (!pid) return;

      const row = await PendingDelivery.findByPk(pid);
      if (!row) return;

      const msg = `${err?.message || err}`.slice(0, 6000);
      await row.update({ status: 'FAILED', last_error: msg });

      const acct = `${row.payload?.chatwootAccountId ?? row.payload?.accountId ?? ''}`.trim();
      const conv = `${row.payload?.conversationId || ''}`.trim();

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

  workerInstance.on('error', (e) => {
    console.error('[delivery-queue] worker error:', e?.stack || e);
  });

  console.log('[delivery-queue] Worker iniciado (`delivery-queue` + exponential backoff + outbox sweep).');
}

module.exports = {
  QUEUE_NAME,
  getQueue,
  enqueuePendingDeliveryJob,
  attachWorkerIfEnabled,
  shutdownDeliveryMessaging,
  reconcileStalePendingDeliveries,
  deliverPendingDeliveryOnce,
  OUTBOX_SCHEDULER_ID,
  SWEEP_MIN_AGE_MS,
  SWEEP_SCHEDULER_MS,
};
