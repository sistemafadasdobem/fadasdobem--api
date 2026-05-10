'use strict';

const { Op } = require('sequelize');
const { QueryTypes } = require('sequelize');
const {
  sequelize,
  Specialist,
  Session,
  Queue,
  PaymentOrder,
  LedgerAccount,
  TransactionLedger,
  Review,
} = require('../../models');

const BRT = 'America/Sao_Paulo';

/** Motor extensível: registe secções próprias (plugins internos/domínios). */
const SECTION_EXT = new Map();

/**
 * Regista um gerador async `(ctx) => object` sob `sectionKey`; o resultado aparece em `dashboard.extensions.<key>`.
 * @param {string} sectionKey
 * @param {(ctx: object) => Promise<object>} provider
 */
function registerAdminMetricsSection(sectionKey, provider) {
  const k = `${sectionKey || ''}`.trim();
  if (!k) return;
  if (typeof provider !== 'function') {
    throw new Error('registerAdminMetricsSection: provider deve ser async function.');
  }
  SECTION_EXT.set(k, provider);
}

function literalBrDayStart() {
  return sequelize.literal(`(((CURRENT_TIMESTAMP AT TIME ZONE '${BRT}')::date) AT TIME ZONE '${BRT}')`);
}

function literalBrDayEndExclusive() {
  return sequelize.literal(
    `((((CURRENT_TIMESTAMP AT TIME ZONE '${BRT}')::date) + interval '1 day') AT TIME ZONE '${BRT}')`
  );
}

function literalBrMonthStart() {
  return sequelize.literal(
    `(DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE '${BRT}') AT TIME ZONE '${BRT}')`
  );
}

function literalBrMonthNext() {
  return sequelize.literal(
    `((DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE '${BRT}') + INTERVAL '1 month') AT TIME ZONE '${BRT}')`
  );
}

async function grossPaidVolume(whereExtra = {}) {
  const raw =
    (await PaymentOrder.sum('amount', {
      paranoid: true,
      where: { status: 'PAID', ...whereExtra },
    })) ?? 0;
  const x = Number.parseFloat(`${raw}`);
  return Number.isFinite(x) ? x : 0;
}

async function sumPlatformCreditsToRevenueLedger() {
  const raw =
    (await TransactionLedger.sum('amount', {
      attributes: [],
      include: [
        {
          model: LedgerAccount,
          as: 'credit_account',
          attributes: [],
          required: true,
          where: { account_type: 'PLATFORM_REVENUE' },
        },
      ],
    })) ?? 0;
  const x = Number.parseFloat(`${raw}`);
  return Number.isFinite(x) ? x : 0;
}

async function clientWalletLiabilities() {
  const raw =
    (await LedgerAccount.sum('cached_balance', {
      where: { account_type: 'CLIENT_WALLET' },
    })) ?? 0;
  const x = Number.parseFloat(`${raw}`);
  return Number.isFinite(x) ? x : 0;
}

async function leadConversionStats() {
  const [row] = await sequelize.query(
    `
    SELECT
      (
        SELECT COUNT(*)::integer
        FROM leads l
        WHERE l.deleted_at IS NULL
          AND l.status <> 'ABANDONED'
      ) AS denominator,
      (
        SELECT COUNT(*)::integer
        FROM leads l
        WHERE l.deleted_at IS NULL
          AND l.status <> 'ABANDONED'
          AND l.status = 'CONVERTED'
          AND EXISTS (
            SELECT 1
            FROM users u
            INNER JOIN clients c ON c.user_id = u.id AND c.deleted_at IS NULL
            INNER JOIN payment_orders po
              ON po.deleted_at IS NULL
             AND po.status = 'PAID'
             AND (po.client_id = c.id OR po.user_id = u.id)
            WHERE u.deleted_at IS NULL
              AND u.role = 'CLIENTE'
              AND u.chatwoot_contact_id IS NOT NULL
              AND u.chatwoot_contact_id = l.chatwoot_contact_id
          )
      ) AS numerator
    `,
    { type: QueryTypes.SELECT }
  );

  const denom = Number.parseInt(`${row?.denominator ?? 0}`, 10) || 0;
  const num = Number.parseInt(`${row?.numerator ?? 0}`, 10) || 0;
  const rate = denom > 0 ? Math.round(((num / denom) * 100 + Number.EPSILON) * 10000) / 10000 : null;

  return {
    numerator: num,
    denominator: denom,
    conversion_rate_pay_lead: rate,
    note_conversion:
      'Numerador exige Lead `CONVERTED` correlacionado pelo `chatwoot_contact_id` a um `User` cliente com pelo menos uma `payment_orders` PAID.',
  };
}

async function avgPlatformRatingGlobal() {
  const row = await Review.findOne({
    paranoid: true,
    attributes: [[sequelize.fn('AVG', sequelize.col('rating')), 'avg_rating']],
    raw: true,
  });
  const x = Number.parseFloat(`${row?.avg_rating ?? 0}`);
  return Number.isFinite(x) ? Math.round(x * 10000) / 10000 : 0;
}

async function minutesConsumedInRange(whereEndedAt) {
  const raw =
    (await Session.sum('paid_minutes_used', {
      paranoid: true,
      where: {
        ended_at: { ...whereEndedAt },
        paid_minutes_used: { [Op.gt]: 0 },
      },
    })) ?? 0;

  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

/**
 * Painel KPI Fase‑4 Gestora · subqueries paralelas sempre que possível.
 */
async function getExecutiveDashboardKpis() {
  const dayStart = literalBrDayStart();
  const dayEndEx = literalBrDayEndExclusive();
  const moStart = literalBrMonthStart();
  const moNext = literalBrMonthNext();

  const [
    gross_total_brl,
    gross_today_brl,
    gross_month_brl,
    platform_accumulated_margin_brl,
    client_wallet_liabilities_brl,
    specialists_online_now,
    sessions_in_progress_distinct_estimate,
    queue_waiting_size,
    conversion,
    quality_avg_rating_global,
    consumed_minutes_today_raw,
    consumed_minutes_month_raw,
    paid_orders_count_all_time,
  ] = await Promise.all([
    grossPaidVolume({}),
    grossPaidVolume({
      paid_at: { [Op.gte]: dayStart, [Op.lt]: dayEndEx },
    }),
    grossPaidVolume({
      paid_at: { [Op.gte]: moStart, [Op.lt]: moNext },
    }),
    sumPlatformCreditsToRevenueLedger(),
    clientWalletLiabilities(),
    Specialist.count({ paranoid: true, where: { status: 'ONLINE' } }),
    Session.count({
      paranoid: true,
      where: {
        [Op.or]: [
          { telecom_status: { [Op.in]: ['ACTIVE', 'WARNING'] } },
          { status: 'ACTIVE' },
        ],
      },
    }),
    Queue.count({ paranoid: true, where: { status: 'WAITING' } }),
    leadConversionStats(),
    avgPlatformRatingGlobal(),
    minutesConsumedInRange({ [Op.gte]: dayStart, [Op.lt]: dayEndEx }),
    minutesConsumedInRange({ [Op.gte]: moStart, [Op.lt]: moNext }),
    PaymentOrder.count({ paranoid: true, where: { status: 'PAID' } }),
  ]);

  const ctx = {
    timezone: BRT,
    generated_at: new Date().toISOString(),
  };

  /** @type {Record<string, object>} */
  const extensions = {};
  for (const [key, thunk] of SECTION_EXT.entries()) {
    extensions[key] = await thunk(ctx);
  }

  return {
    ...ctx,
    financial: {
      gross_revenue_brl_total_all_paid_orders: gross_total_brl,
      gross_revenue_brl_today_paid_at_br: gross_today_brl,
      gross_revenue_brl_month_paid_at_br: gross_month_brl,
      platform_net_margin_accumulated_from_ledger_brl: platform_accumulated_margin_brl,
      outstanding_client_wallet_liability_brl: client_wallet_liabilities_brl,
      paid_orders_count_all_time_hint: paid_orders_count_all_time,
      assumptions:
        '`gross_*` usa `PaymentOrder.amount` só em `PAID`; janelas hoje/mês são `paid_at` com fronteira BRT. Lucro líquido plataforma = somatório ledger creditado à conta **`PLATFORM_REVENUE`**.',
    },
    operational: {
      specialists_online_now: specialists_online_now,
      consultations_in_progress_session_rows: sessions_in_progress_distinct_estimate,
      assumption_consult_progress:
        'Conta sessões onde `telecom ∈ {ACTIVE,WARNING}` OU `sessions.status = ACTIVE` (overlap possível até normalizar UI).',
      queue_waiting_clients: queue_waiting_size,
      queue_note:
        '`COUNT` em `queues` com `status = WAITING` (soft-delete respeita `deleted_at`; se existir SLA adicional usar serviços de sessão AO VIVO).',
    },
    conversion: conversion,
    quality: {
      avg_rating_public_reviews: quality_avg_rating_global,
      assumption_quality: '`AVG(reviews.rating)` em linhas não apagadas (soft delete).',
    },
    volume: {
      consumed_paid_minutes_today_sessions_ended_br: consumed_minutes_today_raw,
      consumed_paid_minutes_month_sessions_ended_br: consumed_minutes_month_raw,
      assumption_volume_minutes:
        'Soma `paid_minutes_used` de sessões com `ended_at` na janela BRT (inteiro cronômetro económico).',
    },
    extensions,
    engine_hint:
      'Registe plugins com `registerAdminMetricsSection(sectionKey, asyncThunk)` antes do handler HTTP — ideal para KPIs próprios (ex.: NPS WhatsApp).',
  };
}

module.exports = {
  registerAdminMetricsSection,
  getExecutiveDashboardKpis,
};
