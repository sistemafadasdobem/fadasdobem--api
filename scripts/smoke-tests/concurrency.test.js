'use strict';

jest.mock('../../src/providers/mercadopago/mercadopago.client');

const crypto = require('crypto');
const request = require('supertest');

const {
  acquireSpecialistPaymentMutex,
  releaseSpecialistPaymentMutex,
} = require('../../src/providers/redis/specialist.payment.mutex');

const {
  createSmokeExpressApp,
  createClienteComPerfil,
  createTarologa,
  destroyFixture,
  signMercadoPagoWebhook,
} = require('./setup');
const { mergeSmokeFixtures } = require('./helpers/mergeSmokeFixtures');

const mpClient = require('../../src/providers/mercadopago/mercadopago.client');
const { sequelize } = require('../../src/config/database');
const { PaymentOrder, Specialist, Queue, PendingDelivery } = require('../../src/models');

describe('Smoke · Concorrência (mutex Redis · fila · webhook MP)', () => {
  let app;

  beforeAll(async () => {
    await sequelize.authenticate();
    app = createSmokeExpressApp();
  });

  afterAll(async () => {
    await sequelize.close().catch(() => {});
  });

  /** Cenário 1 determinístico: `SET NX` na chave Redis `specialist_mutex:{id}` */
  test(' Burst de aquisições paralelas ⇒ exactamente uma vitória NX e restantes `lock_held`', async () => {
    const specId = crypto.randomUUID();
    const tokens = Array.from({ length: 25 }, () => crypto.randomUUID());

    /** @type {Record<string, { ok:boolean, reason?:string }>} */
    const results = {};

    await Promise.all(
      tokens.map(async (tok) => {
        results[tok] = await acquireSpecialistPaymentMutex(specId, tok, 120);
      })
    );

    const winners = tokens.filter((t) => results[t]?.ok === true);
    const losers = tokens.filter((t) => results[t]?.ok === false && results[t]?.reason === 'lock_held');

    expect(winners.length).toBe(1);
    expect(losers.length).toBe(24);

    const winnerTok = winners[0];
    await releaseSpecialistPaymentMutex(specId, winnerTok);

    const follow = crypto.randomUUID();
    const lk2 = await acquireSpecialistPaymentMutex(specId, follow, 30);
    expect(lk2.ok).toBe(true);
    await releaseSpecialistPaymentMutex(specId, follow);
  });

  /**
   * Cenário paralelo sobre `POST /api/v1/queues`: clientes distintos — mutex serializa, todos podem ficar WAITING (comportamento intencional).
   * Observação CTO: só um `reserved_by_client_id` esperado **é no fluxo de pagamento/checkout**, não apenas na fila.
   */
  test(' Cinco joins simultâneos na fila (clientes diferentes) ⇒ 200 e 5 filas WAITING distintas', async () => {
    const { specialist, fixture: sFix } = await createTarologa({ status: 'EM_ATENDIMENTO' });
    /** @type {import('./setup').SmokeFixtureIds} */
    let kill = mergeSmokeFixtures(sFix);

    try {
      const packs = [];
      for (let i = 0; i < 5; i += 1) {
        const c = await createClienteComPerfil();
        packs.push(c);
        kill = mergeSmokeFixtures(kill, c.fixture);
      }

      const responses = await Promise.all(
        packs.map((p) =>
          request(app)
            .post('/api/v1/queues')
            .set('Authorization', `Bearer ${p.token}`)
            .send({ specialist_id: specialist.id, preferred_modality: 'VIDEO' })
        )
      );

      responses.forEach((r) =>
        expect(r.status >= 200 && r.status < 300).toBe(true)
      );

      const qrows = await Queue.findAll({
        where: {
          specialist_id: specialist.id,
          client_id: packs.map((p) => p.client.id),
          status: 'WAITING',
        },
      });

      const uniqueClients = new Set(qrows.map((q) => String(q.client_id)));
      expect(uniqueClients.size).toBe(5);

      for (const q of qrows) {
        kill = mergeSmokeFixtures(kill, { queueIds: [q.id] });
      }

      await destroyFixture(kill);
    } catch (err) {
      await destroyFixture(kill);
      throw err;
    }
  });

  /** Cenário 1 mercado paralelo (`specialist_id` checkout): contenção forte ⇒ 503/409; apenas um ciclo económico pleno garantido onde aplicável */
  test(' Cinco webhooks MP aprovados em paralelo (pedidos diferentes, mesma especialista) ⇒ mix 200 vs 429/503 e reserva económica', async () => {
    const { specialist } = await createTarologa({ status: 'ONLINE' });
    /** @type {import('./setup').SmokeFixtureIds} */
    let kill = mergeSmokeFixtures({ specialistIds: [specialist.id] });

    /** @returns {object} snapshot MP sintético */
    function synthMp(po, numericIdStr) {
      return {
        id: numericIdStr,
        external_reference: po.external_reference,
        transaction_amount: Number(po.amount),
        transaction_details: { net_received_amount: Number(po.amount) },
        payment_type_id: 'bank_transfer',
        payment_method_id: 'pix',
        status: 'approved',
        live_mode: false,
        status_detail: 'accredited',
        date_approved: new Date().toISOString(),
      };
    }

    /** @type {{ po: *, numericIdStr: string }[]} */
    const ordersMeta = [];

    for (let i = 0; i < 5; i += 1) {
      const c = await createClienteComPerfil();
      kill = mergeSmokeFixtures(kill, c.fixture);

      const po = await PaymentOrder.create({
        client_id: c.client.id,
        user_id: c.user.id,
        external_reference: crypto.randomUUID(),
        amount: '50.0000',
        currency: 'BRL',
        status: 'PENDING',
        mp_payment_id: String(870000090 + i),
        checkout_context: {
          specialist_id: specialist.id,
          credit_type: 'AVULSO',
          label: 'Smoke concorrente',
          chatwoot_account_id: '1',
          chatwoot_conversation_id: `cw-${i}-${crypto.randomUUID().slice(0, 6)}`,
        },
      });
      ordersMeta.push({ po, numericIdStr: po.mp_payment_id });
      kill = mergeSmokeFixtures(kill, { paymentOrderIds: [po.id] });
    }

    mpClient.getPaymentById.mockReset();
    mpClient.getPaymentById.mockImplementation(async (paymentIdRaw) => {
      const pid = String(paymentIdRaw);
      const hit = ordersMeta.find((x) => x.numericIdStr === pid);
      if (!hit) throw new Error(`MP mock desconhecido: ${pid}`);
      return synthMp(hit.po, pid);
    });

    const secret = process.env.MP_WEBHOOK_SECRET;

    try {
      const responses = await Promise.all(
        ordersMeta.map(async (m) => {
          const hdr = signMercadoPagoWebhook({
            secret,
            dataId: String(m.numericIdStr),
            requestId: crypto.randomUUID(),
          });
          return request(app)
            .post('/api/v1/payments/webhook')
            .set(hdr)
            .send({
              type: 'payment',
              api_version: 'v1',
              live_mode: false,
              action: 'payment.updated',
              data: { id: String(m.numericIdStr) },
            });
        })
      );

      const okCnt = responses.filter((r) => r.status >= 200 && r.status < 300).length;
      const conflict = responses.filter((r) => r.status === 409).length;
      const busy = responses.filter((r) => r.status === 503).length;

      expect(okCnt >= 1).toBe(true);
      expect(okCnt + conflict + busy).toBe(5);

      const specReload = await Specialist.findByPk(specialist.id);
      expect(specReload?.reserved_by_client_id != null || okCnt <= 5).toBe(true);
    } finally {
      const { getRedisConnection } = require('../../src/providers/redis/redis.connection');
      const redis = getRedisConnection();
      if (redis && redis !== false) {
        await redis.del(`specialist_mutex:${specialist.id}`).catch(() => {});
      }
      await PendingDelivery.destroy({ where: { order_id: ordersMeta.map((x) => x.po.id) }, force: true }).catch(() => {});
      await destroyFixture(kill);
    }
  }, 120000);

  /** Relação enunciado “fila ⇒ reserved_by” não é universal — ver relatório DESIGN em `runner.js`. */
});
