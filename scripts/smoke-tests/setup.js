'use strict';

/**
 * Infra partilhada dos smoke tests: App Express mínimo, JWT de teste, guardas de segurança.
 * Não executar contra produção: exige `ALLOW_SMOKE_TESTS=true` e nome de base indicando homolog/test.
 */

const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const jwt = require('jsonwebtoken');

const { assertJwtSecretsLoaded, jwtSignOptionsAccess, jwtVerifyOptions } = require('../../src/config/auth.config');

const apiRoot = path.join(__dirname, '..', '..');

function assertSmokeEnvironment() {
  const allow = `${process.env.ALLOW_SMOKE_TESTS || ''}`.trim().toLowerCase();
  if (!['true', '1', 'yes'].includes(allow)) {
    throw new Error(
      '[smoke] Defina ALLOW_SMOKE_TESTS=true para indicar uso consciente (Postgres dedicado à homolog).'
    );
  }

  const dbUrl = `${process.env.DATABASE_URL || ''}`.trim();
  const dbName = `${process.env.DB_NAME || ''}`.trim().toLowerCase();
  const safe =
    (/smoke|test|jest|homolog|staging|ci|temp/i.test(dbUrl) ||
      /smoke|test|jest|homolog|staging|ci|temp/i.test(dbName));
  if (!safe) {
    throw new Error(
      '[smoke] DATABASE_URL/DB_NAME não parecem um ambiente de teste/homolog. Ajuste o nome ou a URL antes de rodar.'
    );
  }

  if (!`${process.env.REDIS_URL || process.env.REDIS_HOST || ''}`.trim()) {
    throw new Error('[smoke] Redis é obrigatório para mutex/outbox-smoke (`REDIS_URL` ou `REDIS_HOST`).');
  }

  if (!`${process.env.MP_WEBHOOK_SECRET || ''}`.trim()) {
    process.env.MP_WEBHOOK_SECRET = crypto.randomBytes(32).toString('hex');
  }
  assertJwtSecretsLoaded();

  /** Evita modo produção de MP que bloqueia `live_mode: false` típico de stubs. */
  if (!`${process.env.MP_ENV || ''}`.trim()) {
    process.env.MP_ENV = 'sandbox';
  }
}

/**
 * Bootstrap HTTP sem `listen()` — igual ao núcleo de `app.js` (middlewares globais já cobertos antes das rotas).
 */
function createSmokeExpressApp() {
  require('../../src/models');

  const routes = require('../../src/routes');
  const notFoundMiddleware = require('../../src/middlewares/notFound.middleware');
  const errorHandlerMiddleware = require('../../src/middlewares/errorHandler.middleware');

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', routes);
  app.use(notFoundMiddleware);
  app.use(errorHandlerMiddleware);

  return app;
}

async function bcryptHash(pw) {
  const rounds = Number(process.env.SMOKE_BCRYPT_ROUNDS) || 8;
  return bcrypt.hash(pw, rounds);
}

function mintAccessToken(userId, extra = {}) {
  return jwt.sign(
    { sub: userId, token_use: 'access', ...extra },
    process.env.JWT_SECRET,
    jwtSignOptionsAccess()
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, jwtVerifyOptions());
}

/**
 * Gera cabeçalhos `x-signature` / `x-request-id` válidos para `validateMercadoPagoWebhook`.
 */
function signMercadoPagoWebhook({ secret, dataId, requestId }) {
  const sid = `${dataId || ''}`.trim().toLowerCase();
  const rid = `${requestId || ''}`.trim();
  const ts = String(Math.floor(Date.now() / 1000));
  const manifest = `id:${sid};request-id:${rid};ts:${ts};`;
  const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return {
    'x-signature': `ts=${ts},v1=${v1}`,
    'x-request-id': rid,
  };
}

/** @type {import('sequelize').Sequelize} */
function getSequelize() {
  const { sequelize } = require('../../src/config/database');
  return sequelize;
}

/**
 * Apaga entidades criadas pelos testes (ordem respeitando FKs comuns).
 * @param {import('./setup').SmokeFixtureIds} ids
 */
async function destroyFixture(ids) {
  const { Op } = require('sequelize');
  const db = require('../../src/models');
  const {
    TransactionLedger,
    ClientCreditLot,
    PendingDelivery,
    PaymentOrder,
    Queue,
    Session,
    LedgerAccount,
    SpecialistModality,
    Client,
    Specialist,
    User,
  } = db;

  const t = await getSequelize().transaction();
  try {
    if (ids.sessionIds?.length) {
      await Session.destroy({ where: { id: { [Op.in]: ids.sessionIds } }, force: true, transaction: t });
    }
    if (ids.queueIds?.length) {
      await Queue.destroy({ where: { id: { [Op.in]: ids.queueIds } }, force: true, transaction: t });
    }
    if (ids.pendingDeliveryIds?.length) {
      await PendingDelivery.destroy({
        where: { id: { [Op.in]: ids.pendingDeliveryIds } },
        force: true,
        transaction: t,
      });
    }
    if (ids.ledgerEntryIds?.length) {
      await TransactionLedger.destroy({
        where: { id: { [Op.in]: ids.ledgerEntryIds } },
        force: true,
        transaction: t,
      });
    }
    if (ids.paymentOrderIds?.length) {
      await ClientCreditLot.destroy({
        where: { payment_order_id: { [Op.in]: ids.paymentOrderIds } },
        force: true,
        transaction: t,
      });
      await TransactionLedger.destroy({
        where: {
          reference_id: { [Op.in]: ids.paymentOrderIds },
        },
        force: true,
        transaction: t,
      });
      await PaymentOrder.destroy({ where: { id: { [Op.in]: ids.paymentOrderIds } }, force: true, transaction: t });
    }
    if (ids.ledgerAccountIds?.length) {
      await LedgerAccount.destroy({ where: { id: { [Op.in]: ids.ledgerAccountIds } }, force: true, transaction: t });
    }
    if (ids.specialistIds?.length) {
      await Specialist.update(
        { reserved_by_client_id: null, reserved_until: null },
        {
          where: { id: { [Op.in]: ids.specialistIds } },
          transaction: t,
          silent: true,
        }
      );
      await SpecialistModality.destroy({
        where: { specialist_id: { [Op.in]: ids.specialistIds } },
        force: true,
        transaction: t,
      });
      await Specialist.destroy({ where: { id: { [Op.in]: ids.specialistIds } }, force: true, transaction: t });
    }
    if (ids.clientIds?.length) {
      await Client.destroy({ where: { id: { [Op.in]: ids.clientIds } }, force: true, transaction: t });
    }
    if (ids.userIds?.length) {
      await User.destroy({ where: { id: { [Op.in]: ids.userIds } }, force: true, transaction: t });
    }
    await t.commit();
  } catch (e) {
    await t.rollback();
    console.error('[smoke] destroyFixture falhou:', e?.stack || e);
    throw e;
  }
}

/**
 * Fixture “zero intervenção”: utilizador cliente + carteira opcionalmente com saldo 0.
 * @returns {Promise<{ user: *, client: *, token: string, fixture: SmokeFixtureIds }>}
 */
async function createClienteComPerfil(attrs = {}) {
  const db = require('../../src/models');
  const { User, Client, LedgerAccount } = db;

  const email =
    attrs.email ||
    `smoke+cli+${crypto.randomUUID().slice(0, 8)}@smoke.fadasdobem.test`.toLowerCase();
  const password = attrs.password || 'SmokeCli@2026';

  const user = await User.create({
    email,
    password_hash: await bcryptHash(password),
    role: 'CLIENTE',
    is_active: true,
    email_verified_at: new Date(),
    accepted_terms_version: 'smoke',
    accepted_terms_at: new Date(),
  });

  const client = await Client.create({
    user_id: user.id,
    nome: attrs.nome || 'Cliente Smoke',
    nickname: attrs.nickname || 'Smoke',
  });

  /** @type {SmokeFixtureIds} */
  const fixture = { userIds: [user.id], clientIds: [client.id], ledgerAccountIds: [] };

  if (attrs.wallet !== false) {
    const [acc] = await LedgerAccount.findOrCreate({
      where: { client_id: client.id, account_type: 'CLIENT_WALLET' },
      defaults: {
        client_id: client.id,
        account_type: 'CLIENT_WALLET',
        currency: 'BRL',
        label: 'Carteira smoke',
        cached_balance: attrs.initial_balance ?? 0,
      },
    });
    if (attrs.initial_balance != null) {
      await acc.update({ cached_balance: attrs.initial_balance });
    }
    fixture.ledgerAccountIds.push(acc.id);
  }

  const token = mintAccessToken(user.id);
  return { user, client, token, password, fixture };
}

/**
 * @returns {Promise<{ user: *, specialist: *, fixture: SmokeFixtureIds }>}
 */
async function createTarologa(attrs = {}) {
  const db = require('../../src/models');
  const { User, Specialist, SpecialistModality } = db;

  const email =
    attrs.email ||
    `smoke+spec+${crypto.randomUUID().slice(0, 8)}@smoke.fadasdobem.test`.toLowerCase();
  const password = attrs.password || 'SmokeSpec@2026';

  const user = await User.create({
    email,
    password_hash: await bcryptHash(password),
    role: 'TAROLOGA',
    is_active: true,
    email_verified_at: new Date(),
    accepted_terms_version: 'smoke',
    accepted_terms_at: new Date(),
  });

  const specialist = await Specialist.create({
    user_id: user.id,
    display_name: attrs.display_name || 'Taróloga Smoke',
    status: attrs.status ?? 'ONLINE',
    accepts_queue_any: true,
    is_blocked: false,
    rating_average_cached: attrs.rating_average_cached ?? null,
    reviews_count_cached: attrs.reviews_count_cached ?? 0,
    sessions_completed_cached: attrs.sessions_completed_cached ?? 0,
  });

  if (attrs.modalities?.length) {
    for (const m of attrs.modalities) {
      await SpecialistModality.create({ specialist_id: specialist.id, modality: m });
    }
  } else {
    await SpecialistModality.create({ specialist_id: specialist.id, modality: 'VIDEO' });
  }

  /** @type {SmokeFixtureIds} */
  const fixture = {
    userIds: [user.id],
    specialistIds: [specialist.id],
  };

  return { user, specialist, password, fixture };
}

/**
 * Ledger líquido de uma conta (soma dos créditos − soma dos débitos).
 */
async function computeLedgerNetForAccount(accountId) {
  const { QueryTypes } = require('sequelize');
  const seq = getSequelize();
  const [row] = await seq.query(
    `
    SELECT COALESCE(SUM(CASE WHEN credit_account_id::text = :aid THEN amount::numeric ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN debit_account_id::text = :aid THEN amount::numeric ELSE 0 END), 0)
         AS net
    FROM transaction_ledger
    WHERE credit_account_id::text = :aid OR debit_account_id::text = :aid
    `,
    { replacements: { aid: String(accountId) }, type: QueryTypes.SELECT }
  );
  return Number(row?.net ?? 0);
}

module.exports = {
  apiRoot,
  assertSmokeEnvironment,
  createSmokeExpressApp,
  bcryptHash,
  mintAccessToken,
  verifyAccessToken,
  signMercadoPagoWebhook,
  destroyFixture,
  createClienteComPerfil,
  createTarologa,
  computeLedgerNetForAccount,
  getSequelize,
};

/**
 * @typedef {object} SmokeFixtureIds
 * @property {string[]} [userIds]
 * @property {string[]} [clientIds]
 * @property {string[]} [specialistIds]
 * @property {string[]} [paymentOrderIds]
 * @property {string[]} [sessionIds]
 * @property {string[]} [queueIds]
 * @property {string[]} [pendingDeliveryIds]
 * @property {string[]} [ledgerAccountIds]
 * @property {string[]} [ledgerEntryIds]
 */
