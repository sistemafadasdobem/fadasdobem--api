'use strict';

jest.mock('../../src/providers/mercadopago/mercadopago.client');

const crypto = require('crypto');
const request = require('supertest');

const {
  createSmokeExpressApp,
  createClienteComPerfil,
  createTarologa,
  destroyFixture,
  signMercadoPagoWebhook,
  computeLedgerNetForAccount,
} = require('./setup');
const { mergeSmokeFixtures } = require('./helpers/mergeSmokeFixtures');

const mpClient = require('../../src/providers/mercadopago/mercadopago.client');
const { sequelize } = require('../../src/config/database');
const {
  PaymentOrder,
  LedgerAccount,
  ClientCreditLot,
  TransactionLedger,
  Session,
} = require('../../src/models');
const sessionsService = require('../../src/features/sessions/sessions.service');

describe('Smoke · Finanças (ledger · idempotência · piso · reconciliação local)', () => {
  let app;

  beforeAll(async () => {
    await sequelize.authenticate();
    app = createSmokeExpressApp();
  });

  afterAll(async () => {
    await sequelize.close().catch(() => {});
  });

  test('Piso económico: 8′ pagos, piso 15′, tarifa 10.0000 ⇒ FLOOR_COMPENSATION = 70.0000', async () => {
    const { client, fixture } = await createClienteComPerfil();
    /** @type {import('./setup').SmokeFixtureIds} */
    let kill = mergeSmokeFixtures(fixture);

    const { specialist, fixture: sFx } = await createTarologa({ status: 'ONLINE' });
    kill = mergeSmokeFixtures(kill, sFx);

    const session = await Session.create({
      client_id: client.id,
      specialist_id: specialist.id,
      modality: 'VIDEO',
      status: 'ENDED',
      telecom_status: 'COMPLETED',
      ended_reason_code: 'NETWORK_ERROR',
      paid_minutes_used: 8,
      minute_price_applied_snapshot: '10.0000',
      specialist_commission_pct_snapshot: '30.0000',
      total_cost: 0,
      economics_settled_at: new Date(),
    });
    kill = mergeSmokeFixtures(kill, { sessionIds: [session.id] });

    try {
      await sessionsService.applyMinimumFloorReimbursement(session.id, {
        eligibleReasonCodesOverride: ['NETWORK_ERROR'],
      });

      const floorTxn = await TransactionLedger.findOne({
        where: { reference_type: 'FLOOR_COMPENSATION', reference_id: session.id },
      });

      expect(floorTxn).not.toBeNull();
      expect(Number(floorTxn.amount)).toBeCloseTo(70.0, 4);
    } finally {
      await TransactionLedger.destroy({
        where: { reference_type: 'FLOOR_COMPENSATION', reference_id: session.id },
        force: true,
      }).catch(() => {});
      await destroyFixture(kill);
    }
  });

  test('Webhook Mercado Pago triplicado (mesmo order / mesma notificação) ⇒ PAYMENT_ACCREDITED singular + único ClientCreditLot', async () => {
    const { user, client, fixture } = await createClienteComPerfil({ initial_balance: 0 });

    /** @type {import('./setup').SmokeFixtureIds} */
    let kill = mergeSmokeFixtures(fixture);

    const numericId = `${880055501}`;
    const extRef = crypto.randomUUID();

    const po = await PaymentOrder.create({
      client_id: client.id,
      user_id: user.id,
      external_reference: extRef,
      amount: '25.7500',
      currency: 'BRL',
      status: 'PENDING',
      mp_payment_id: numericId,
      checkout_context: { credit_type: 'AVULSO', label: 'Smoke idempotência' },
    });
    kill = mergeSmokeFixtures(kill, { paymentOrderIds: [po.id] });

    const wallet = await LedgerAccount.findOne({
      where: { client_id: client.id, account_type: 'CLIENT_WALLET' },
    });
    expect(wallet).not.toBeNull();

    mpClient.getPaymentById.mockReset();
    mpClient.getPaymentById.mockResolvedValue({
      id: numericId,
      external_reference: extRef,
      transaction_amount: 25.75,
      transaction_details: { net_received_amount: 25.75 },
      payment_type_id: 'bank_transfer',
      payment_method_id: 'pix',
      status: 'approved',
      live_mode: false,
      status_detail: 'accredited',
      date_approved: new Date().toISOString(),
    });

    try {
      for (let r = 0; r < 3; r += 1) {
        const hdr = signMercadoPagoWebhook({
          secret: process.env.MP_WEBHOOK_SECRET,
          dataId: numericId.toLowerCase(),
          requestId: crypto.randomUUID(),
        });
        // eslint-disable-next-line no-await-in-loop
        const res = await request(app)
          .post('/api/v1/payments/webhook')
          .set(hdr)
          .send({
            type: 'payment',
            api_version: 'v1',
            live_mode: false,
            action: 'payment.updated',
            data: { id: numericId.toLowerCase() },
          });

        expect(res.status).toBe(200);
      }

      await po.reload({ paranoid: true });
      expect(po.status).toBe('PAID');

      const lotCount = await ClientCreditLot.count({ where: { payment_order_id: po.id }, paranoid: true });
      expect(lotCount).toBe(1);

      const creditRows = await TransactionLedger.findAll({
        where: { reference_type: 'PAYMENT_ACCREDITED', reference_id: po.id },
      });
      expect(creditRows.length).toBe(1);

      const netLedger = await computeLedgerNetForAccount(wallet.id);
      await wallet.reload();
      expect(Number(netLedger)).toBeCloseTo(25.75, 4);
      expect(Number(wallet.cached_balance)).toBeCloseTo(25.75, 4);
    } finally {
      await destroyFixture(kill);
    }
  });

  test('Σ razão carteira cliente == CLIENT_WALLET.cached_balance depois de 5 lançamentos simétricos', async () => {
    const { client, fixture } = await createClienteComPerfil({ initial_balance: 0 });
    const { Op } = require('sequelize');

    /** @type {import('./setup').SmokeFixtureIds} */
    let kill = mergeSmokeFixtures(fixture);

    /** @returns {Promise<*>} suspense */
    async function suspenseAcc() {
      let acc = await LedgerAccount.findOne({
        where: {
          account_type: 'PLATFORM_SUSPENSE',
          client_id: { [Op.is]: null },
          specialist_id: { [Op.is]: null },
        },
      });
      if (!acc) {
        acc = await LedgerAccount.create({
          account_type: 'PLATFORM_SUSPENSE',
          currency: 'BRL',
          label: 'Suspense smoke',
          cached_balance: null,
        });
        kill = mergeSmokeFixtures(kill, { ledgerAccountIds: [acc.id] });
      }
      return acc;
    }

    const suspenseRow = await suspenseAcc();
    const wallet = await LedgerAccount.findOne({
      where: { client_id: client.id, account_type: 'CLIENT_WALLET' },
    });

    /** @type {number[][]} tipo [valor crédito/débito absoluto carteira+] */
    const deltas = [[100], [-20], [5], [-10], [3]];
    /** @type {string[]} */
    const entryIds = [];

    try {
      await sequelize.transaction(async (t) => {
        for (let i = 0; i < deltas.length; i += 1) {
          const raw = deltas[i][0];
          let debitAccountId = suspenseRow.id;
          let creditAccountId = wallet.id;
          if (raw < 0) {
            debitAccountId = wallet.id;
            creditAccountId = suspenseRow.id;
          }
          const amount = Math.abs(raw);

          // eslint-disable-next-line no-await-in-loop
          const row = await TransactionLedger.create(
            {
              debit_account_id: debitAccountId,
              credit_account_id: creditAccountId,
              amount,
              reference_type: 'ADJUSTMENT_ADMIN',
              reference_id: crypto.randomUUID(),
              idempotency_key: `smoke-five-${crypto.randomUUID()}`,
              description: `Smoke cinco LAN ${i}`,
              occurred_at: new Date(),
            },
            { transaction: t }
          );
          entryIds.push(row.id);

          // eslint-disable-next-line no-await-in-loop
          await wallet.reload({ transaction: t, lock: t.LOCK.UPDATE });
          const prev = Number(wallet.cached_balance ?? 0);
          // eslint-disable-next-line no-await-in-loop
          await wallet.update({ cached_balance: prev + raw }, { transaction: t });
        }
      });

      kill = mergeSmokeFixtures(kill, { ledgerEntryIds: entryIds });

      const netLedger = await computeLedgerNetForAccount(wallet.id);
      await wallet.reload();
      expect(Number(netLedger)).toBeCloseTo(Number(wallet.cached_balance), 4);
      expect(Number(wallet.cached_balance)).toBeCloseTo(78, 4);
    } finally {
      await TransactionLedger.destroy({ where: { id: { [Op.in]: entryIds } }, force: true }).catch(() => {});
      await destroyFixture(kill);
    }
  });
});
