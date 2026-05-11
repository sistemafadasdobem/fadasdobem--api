'use strict';

jest.mock('../../src/providers/chatwoot/chatwoot.client', () => ({
  postPrivateNote: jest.fn().mockResolvedValue({}),
  postTextReply: jest.fn().mockResolvedValue({}),
}));

const crypto = require('crypto');
const request = require('supertest');
const anthropicService = require('../../src/features/anthropic/anthropic.service');
const chatwootClient = require('../../src/providers/chatwoot/chatwoot.client');
const { sequelize } = require('../../src/config/database');

const {
  createSmokeExpressApp,
  createClienteComPerfil,
  createTarologa,
  destroyFixture,
} = require('./setup');
const { mergeSmokeFixtures } = require('./helpers/mergeSmokeFixtures');

const db = require('../../src/models');
const { Session } = db;

describe('Smoke · IA / vitrine · trilhos de sessão', () => {
  let app;

  beforeAll(async () => {
    await sequelize.authenticate();
    app = createSmokeExpressApp();
  });

  afterAll(async () => {
    await sequelize.close().catch(() => {});
  });

  test('Tool trigger_crisis_intervention ⇒ postPrivateNote (Chatwoot mock)', async () => {
    chatwootClient.postPrivateNote.mockClear();

    const result = await anthropicService.fulfillTriggerCrisisInterventionTool(
      {
        detected_sentiment: 'desespero iminente',
        suggested_action: 'transferir urgência aos humanos Nice',
        confidence_score: 0.93,
      },
      { accountId: 'acct-smoke', conversationId: 'conv-smoke' }
    );

    expect(result.alert_dispatched_chatwoot).toBe(true);
    expect(chatwootClient.postPrivateNote).toHaveBeenCalledTimes(1);

    const [acctId, conversationId, body] = chatwootClient.postPrivateNote.mock.calls[0];
    expect(acctId).toBe('acct-smoke');
    expect(conversationId).toBe('conv-smoke');
    expect(`${body}`).toMatch(/ALERTA|risco/im);
    /** Persistência física PostgreSQL só se existir modelo local — hoje apenas HTTP Chatwoot. */
  });

  test('Ranking (cache): maior rating aparece primeiro num subconjunto de três registos Smoke', async () => {
    const ratings = [
      [5.0, 900],
      [4.0, 800],
      [3.0, 700],
    ];

    /** @type {{ id:string, fx: object }[]} */
    const created = [];

    /** @type {import('./setup').SmokeFixtureIds} */
    let killAll = {};

    for (let i = 0; i < ratings.length; i += 1) {
      const [r, sessComp] = ratings[i];
      const row = await createTarologa({
        status: 'ONLINE',
        display_name: `SmokeRank ${crypto.randomUUID().slice(0, 6)} ${i}`,
        rating_average_cached: r,
        reviews_count_cached: 10,
        sessions_completed_cached: sessComp,
      });
      killAll = mergeSmokeFixtures(killAll, row.fixture);
      created.push({ id: row.specialist.id, fx: row.fixture });
    }

    try {
      const orderedSlice = await db.Specialist.findAll({
        where: { id: created.map((c) => c.id) },
        order: [
          ['rating_average_cached', 'DESC'],
          ['reviews_count_cached', 'DESC'],
          ['sessions_completed_cached', 'DESC'],
          ['display_name', 'ASC'],
        ],
      });

      expect(orderedSlice[0]?.id).toBe(created[0].id);

      const specialistsService = require('../../src/features/specialists/specialists.service');
      const vitrinePack = await specialistsService.listForVitrine({
        sort: 'ranking',
        order: 'desc',
        limit: 200,
      });

      /** Preserva ordenação mesmo que existam outras especialistas “mais bem votadas” fora da amostragem Smoke. */
      const subset = vitrinePack.especialistas.filter((e) =>
        created.some((c) => String(c.id) === String(e.id))
      );
      expect(subset.length).toBe(3);
      expect(String(subset[0].id)).toBe(String(created[0].id));

      const http = await request(app).get('/api/v1/specialists').query({ sort: 'ranking', order: 'desc', limit: 80 });
      expect(http.status).toBe(200);
    } finally {
      await destroyFixture(killAll);
    }
  }, 90000);

  test('billing_track persiste trilhos distintos (CLIENT_WALLET vs PACOTE_SESSAO_UNICA) na própria tabela sessões', async () => {
    const { client, fixture: cFx } = await createClienteComPerfil();
    const { specialist, fixture: sFx } = await createTarologa({ status: 'ONLINE' });
    /** @type {import('./setup').SmokeFixtureIds} */
    let kill = mergeSmokeFixtures(cFx, sFx);

    try {
      const s1 = await Session.create({
        client_id: client.id,
        specialist_id: specialist.id,
        modality: 'VIDEO',
        status: 'READY',
        telecom_status: 'PENDING',
        billing_track: 'CLIENT_WALLET',
        total_cost: 0,
      });
      const s2 = await Session.create({
        client_id: client.id,
        specialist_id: specialist.id,
        modality: 'VIDEO',
        status: 'READY',
        telecom_status: 'PENDING',
        billing_track: 'PACOTE_SESSAO_UNICA',
        total_cost: 0,
      });

      kill = mergeSmokeFixtures(kill, { sessionIds: [s1.id, s2.id] });

      await s1.reload({ paranoid: true });
      await s2.reload({ paranoid: true });

      expect(String(s1.billing_track)).toBe('CLIENT_WALLET');
      expect(String(s2.billing_track)).toBe('PACOTE_SESSAO_UNICA');
    } finally {
      await destroyFixture(kill);
    }
  });
});
