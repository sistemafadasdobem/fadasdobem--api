'use strict';

const { Op } = require('sequelize');
const {
  sequelize,
  Specialist,
  LedgerAccount,
  TransactionLedger,
  Client,
  PayoutRequest,
  PaymentOrder,
} = require('../../../models');
const AppError = require('../../../utils/AppError');
const { persistAdminAuditLog } = require('../helpers/adminAudit.helper');

const ACCOUNT_LEDGER_INCLUDES = [
  {
    model: LedgerAccount,
    as: 'debit_account',
    attributes: ['id', 'account_type', 'client_id', 'specialist_id', 'label', 'cached_balance'],
    required: false,
    include: [
      { model: Client, as: 'client', attributes: ['id', 'nome_id', 'nome_completo', 'nome'], required: false },
      {
        model: Specialist,
        as: 'specialist',
        attributes: ['id', 'display_name'],
        required: false,
      },
    ],
  },
  {
    model: LedgerAccount,
    as: 'credit_account',
    attributes: ['id', 'account_type', 'client_id', 'specialist_id', 'label', 'cached_balance'],
    required: false,
    include: [
      { model: Client, as: 'client', attributes: ['id', 'nome_id', 'nome_completo', 'nome'], required: false },
      {
        model: Specialist,
        as: 'specialist',
        attributes: ['id', 'display_name'],
        required: false,
      },
    ],
  },
];

function coerceParty(acc) {
  if (!acc) return null;
  const c = acc.client;
  const s = acc.specialist;
  return {
    ledger_account_id: acc.id,
    account_type: acc.account_type,
    label: acc.label || null,
    client_id: acc.client_id || null,
    specialist_id: acc.specialist_id || null,
    cached_balance: acc.cached_balance != null ? Number(acc.cached_balance) : null,
    client_nome_visible: c ? c.nome_id || c.nome_completo || c.nome || null : null,
    specialist_display_name: s ? s.display_name || null : null,
  };
}

function serializeLedgerMovement(row) {
  const j = typeof row?.toJSON === 'function' ? row.toJSON() : row;
  return {
    id: j.id,
    occurred_at: j.occurred_at,
    created_at: j.created_at,
    reference_type: j.reference_type,
    reference_id: j.reference_id || null,
    idempotency_key: j.idempotency_key || null,
    description: j.description || null,
    amount: j.amount != null ? Number(j.amount) : null,
    metadata: j.metadata || null,
    debit: coerceParty(j.debit_account),
    credit: coerceParty(j.credit_account),
    created_by_user_id: j.created_by_user_id || null,
  };
}

async function listFinanceLedgerTransactions(query = {}) {
  let limit = parseInt(`${query.limit ?? 50}`, 10);
  if (!Number.isFinite(limit)) limit = 50;
  limit = Math.min(Math.max(limit, 1), 200);

  let offset = parseInt(`${query.offset ?? 0}`, 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  /** @type {import('sequelize').WhereOptions} */
  const where = {};

  const rtRaw = `${query.reference_type || ''}`.trim();
  if (rtRaw && Array.isArray(TransactionLedger.REF_TYPES) && TransactionLedger.REF_TYPES.includes(rtRaw)) {
    where.reference_type = rtRaw;
  }

  const fromIso = `${query.occurred_from || query.from || ''}`.trim();
  const toIso = `${query.occurred_to || query.to || ''}`.trim();

  const fromDt = fromIso ? new Date(fromIso) : null;
  const toDt = toIso ? new Date(toIso) : null;

  if (fromDt && Number.isFinite(fromDt.getTime())) {
    where.occurred_at = { ...(where.occurred_at || {}), [Op.gte]: fromDt };
  }
  if (toDt && Number.isFinite(toDt.getTime())) {
    where.occurred_at = { ...(where.occurred_at || {}), [Op.lte]: toDt };
  }

  const [total, rows] = await Promise.all([
    TransactionLedger.count({ where }),
    TransactionLedger.findAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset,
      include: ACCOUNT_LEDGER_INCLUDES,
    }),
  ]);

  return {
    items: rows.map((r) => serializeLedgerMovement(r)),
    pagination: {
      total_rows: total,
      limit,
      offset,
    },
    reference_types_known: TransactionLedger.REF_TYPES || [],
    filters_applied: {
      reference_type: rtRaw || null,
      occurred_from: fromDt && Number.isFinite(fromDt.getTime()) ? fromDt.toISOString() : null,
      occurred_to: toDt && Number.isFinite(toDt.getTime()) ? toDt.toISOString() : null,
    },
    currency_hint: 'BRL',
    note_partidas:
      'Cada lançamento expõe `debit` e `credit` com montante sempre positivo.',
  };
}

async function markPayoutAsPaid(actorUserId, payoutId, body = {}, httpCtx = {}) {
  const gid = `${payoutId || ''}`.trim();
  const adminId = `${actorUserId || ''}`.trim();
  if (!gid) throw new AppError('ID de repasse omisso.', 400, null, true);

  const row = await PayoutRequest.findByPk(gid, {
    paranoid: true,
    include: [{ model: Specialist, as: 'specialist', attributes: ['id', 'display_name'], required: false }],
  });
  if (!row) throw new AppError('Pedido de repasse não encontrado.', 404, null, true);

  const st = `${row.status || ''}`;
  if (st === 'PAID') throw new AppError('Pedido já consta como PAGO.', 409, null, true);
  if (st === 'REJECTED' || st === 'FAILED') throw new AppError('Pedido já encerrado e não pode ser pago.', 409, null, true);

  const extRaw = `${body.external_transfer_id ?? body.externalTransferId ?? ''}`;
  const extId = extRaw.trim().slice(0, 128) || row.external_transfer_id || null;

  const before = row.toJSON ? row.toJSON() : {};

  await sequelize.transaction(async (t) => {
    await row.reload({ transaction: t, lock: t.LOCK.UPDATE, paranoid: true });

    const nowRow = `${row.status || ''}`;
    if (nowRow === 'PAID') throw new AppError('Pedido já consta como PAGO.', 409, null, true);

    await row.update(
      {
        status: 'PAID',
        paid_at: new Date(),
        processed_at: new Date(),
        processed_by_user_id: adminId || null,
        external_transfer_id: extId || row.external_transfer_id,
      },
      { transaction: t }
    );

    await persistAdminAuditLog(
      {
        admin_id: adminId,
        action: 'ADMIN_PAYOUT_MARK_PAID',
        target_entity: 'PayoutRequest',
        target_id: row.id,
        old_value: {
          status: before.status,
          paid_at: before.paid_at,
          specialist_id: before.specialist_id,
          amount: before.amount != null ? Number(before.amount) : null,
        },
        new_value: {
          status: row.status,
          paid_at: row.paid_at,
          processed_at: row.processed_at,
          specialist_id: row.specialist_id,
          amount: row.amount != null ? Number(row.amount) : null,
          external_transfer_id: row.external_transfer_id,
        },
        metadata: body?.notes ? { notes: `${body.notes}`.slice(0, 900) } : null,
        httpCtx: {
          ip: httpCtx.ip,
          user_agent: httpCtx.userAgent,
          correlation_id: httpCtx.correlationId,
        },
      },
      { transaction: t }
    );
  });

  const fresh = await PayoutRequest.findByPk(row.id, { paranoid: true });
  return {
    payout_id: fresh?.id || row.id,
    status: fresh?.status,
    amount: fresh?.amount != null ? Number(fresh.amount) : null,
    specialist_id: fresh?.specialist_id,
    paid_at: fresh?.paid_at,
    processed_at: fresh?.processed_at,
  };
}

async function financePulseSummary() {
  const [creditsSoldBrlRaw, walletsOpenRaw, paidOrdersCount, platformCredits] = await Promise.all([
    PaymentOrder.sum('amount', { where: { status: 'PAID' } }).catch(() => 0),
    LedgerAccount.sum('cached_balance', { where: { account_type: 'CLIENT_WALLET' } }).catch(() => 0),
    PaymentOrder.count({ where: { status: 'PAID' } }).catch(() => null),
    TransactionLedger.sum('amount', {
      include: [
        {
          model: LedgerAccount,
          as: 'credit_account',
          attributes: [],
          required: true,
          where: { account_type: 'PLATFORM_REVENUE' },
        },
      ],
    }).catch(() => 0),
  ]);

  const creditsSold = Number.parseFloat(`${creditsSoldBrlRaw ?? 0}`);
  const walletsSum = Number.parseFloat(`${walletsOpenRaw ?? 0}`);
  const platformSum = Number.parseFloat(`${platformCredits ?? 0}`);

  return {
    credits_sold_brl_total_paid_orders: Number.isFinite(creditsSold) ? creditsSold : 0,
    paid_orders_count:
      typeof paidOrdersCount === 'number' && Number.isFinite(paidOrdersCount) ? paidOrdersCount : null,
    client_wallets_cached_balance_total_open: Number.isFinite(walletsSum) ? walletsSum : 0,
    accumulated_platform_credit_to_revenue_account_brl_hint: Number.isFinite(platformSum) ? platformSum : 0,
    currency: 'BRL',
    note_legacy:
      'Resumo rápido; painel KPI completo está em `/api/v1/admin/metrics/dashboard` (motor `admin.metrics.service.js`).',
  };
}

module.exports = {
  listFinanceLedgerTransactions,
  markPayoutAsPaid,
  financePulseSummary,
};
