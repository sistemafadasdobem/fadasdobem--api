'use strict';

jest.mock('../../src/providers/mercadopago/mercadopago.client');

const crypto = require('crypto');

const {
  sequelize,
} = require('../../src/config/database');

const mpClient = require('../../src/providers/mercadopago/mercadopago.client');

const paymentsService = require('../../src/features/payments/payments.service');
const chatwootClient = require('../../src/providers/chatwoot/chatwoot.client');
const deliveryQueue = require('../../src/queues/delivery.queue');
const { PendingDelivery, PaymentOrder } = require('../../src/models');

const {
  createClienteComPerfil,
  createTarologa,
  destroyFixture,
} = require('./setup');
const { mergeSmokeFixtures } = require('./helpers/mergeSmokeFixtures');

jest.mock('../../src/providers/chatwoot/chatwoot.client', () => ({
  postPrivateNote: jest.fn().mockResolvedValue({}),
  postTextReply: jest.fn(),
}));

describe('Smoke · Outbox / BullMQ (PendingDelivery)', () => {
  beforeAll(async () => {
    await sequelize.authenticate();
  });

  afterAll(async () => {
    await sequelize.close().catch(() => {});
  });

  test('Pagamento que gera PendingDelivery permanece PENDING quando Chatwoot falha; volta a enviar quando o provider volta', async () => {
    mpClient.getPaymentById.mockReset();

    /** @type {import('./setup').SmokeFixtureIds} */
    let kill = {};

    chatwootClient.postTextReply.mockReset();
    chatwootClient.postTextReply.mockRejectedValueOnce(new Error('simulate chatwoot transport failure'));

    const { user, client, fixture } = await createClienteComPerfil({ initial_balance: 0 });
    kill = mergeSmokeFixtures(fixture);

    const { specialist, fixture: sFx } = await createTarologa({ status: 'ONLINE' });
    kill = mergeSmokeFixtures(kill, sFx);

    const extRef = crypto.randomUUID();

    const order = await PaymentOrder.create({
      client_id: client.id,
      user_id: user.id,
      external_reference: extRef,
      amount: '60.5000',
      currency: 'BRL',
      status: 'PENDING',
      mp_payment_id: '9011122334455',
      checkout_context: {
        credit_type: 'AVULSO',
        specialist_id: specialist.id,
        label: 'Smoke outbox',
        chatwoot_account_id: 'smoke-acc',
        chatwoot_conversation_id: `conv-${crypto.randomUUID().slice(0, 8)}`,
        t8_variant: 'platform',
      },
    });

    kill = mergeSmokeFixtures(kill, { paymentOrderIds: [order.id] });

    mpClient.getPaymentById.mockResolvedValue({
      id: '9011122334455',
      external_reference: extRef,
      transaction_amount: 60.5,
      transaction_details: { net_received_amount: 60.5 },
      payment_type_id: 'bank_transfer',
      payment_method_id: 'pix',
      status: 'approved',
      live_mode: false,
      status_detail: 'accredited',
      date_approved: new Date().toISOString(),
    });

    const envelope = {
      body: { type: 'payment', api_version: 'v1', live_mode: false, data: { id: '9011122334455' } },
      query: {},
      headers: {},
    };

    try {
      await paymentsService.processMercadoPagoWebhookAsync(envelope);

      await order.reload({ paranoid: true });
      expect(order.status).toBe('PAID');

      const pdRows = await PendingDelivery.findAll({ where: { order_id: order.id } });
      expect(pdRows.length).toBe(1);
      const pd = pdRows[0];
      kill = mergeSmokeFixtures(kill, { pendingDeliveryIds: [pd.id] });

      let errCaught = null;
      try {
        await deliveryQueue.deliverPendingDeliveryOnce(pd.id);
      } catch (e) {
        errCaught = e;
      }

      expect(errCaught).not.toBeNull();

      await pd.reload();
      expect(pd.status).toBe('PENDING');

      chatwootClient.postTextReply.mockResolvedValueOnce({});

      await deliveryQueue.deliverPendingDeliveryOnce(pd.id);
      await pd.reload();
      /** O modelo persiste estado “entregue” como `SENT` (contrato atual), não “DELIVERED”. */
      expect(pd.status).toBe('SENT');

      const summary = await deliveryQueue.reconcileStalePendingDeliveries();
      expect(summary).toEqual(
        expect.objectContaining({
          stale_rows_scanned_in_batch: expect.any(Number),
          requeued_attempts: expect.any(Number),
          enqueue_skipped_or_duplicate: expect.any(Number),
          enqueue_errors: expect.any(Number),
        })
      );
    } finally {
      /** Evita ocupar Redis `delivery-queue` quando jobs tentam repetir enqueue */
      const { shutdownDeliveryMessaging } = require('../../src/queues/delivery.queue');
      await shutdownDeliveryMessaging().catch(() => {});

      await PendingDelivery.destroy({
        where: { order_id: order.id },
        force: true,
      }).catch(() => {});
      await PaymentOrder.destroy({ where: { id: order.id }, force: true }).catch(() => {});

      await destroyFixture(kill);
    }
  }, 90000);

  /** `reconcileStalePendingDeliveries` só re‑enfileira PENDING criados há > `SWEEP_MIN_AGE_MS` — validamos retorno estrutura + idempotência básica. */
});
