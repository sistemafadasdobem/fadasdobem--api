'use strict';

const { Op } = require('sequelize');
const { PayoutRequest, Specialist, LedgerAccount } = require('../../models');
const { sequelize } = require('../../config/database');
const AppError = require('../../utils/AppError');

function roundAmt(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 10000) / 10000;
}

async function specialistProfileForUserId(userId) {
  const uid = `${userId || ''}`.trim();
  if (!uid) return null;
  return Specialist.findOne({
    where: { user_id: uid },
    paranoid: true,
    attributes: ['id', 'user_id'],
  });
}

async function ensureSpecialistEarningsAccount(specialistId, transaction) {
  let acc = await LedgerAccount.findOne({
    where: { specialist_id: specialistId, account_type: 'SPECIALIST_EARNINGS' },
    transaction,
    lock: transaction?.LOCK?.UPDATE,
  });
  if (!acc) {
    acc = await LedgerAccount.create(
      {
        specialist_id: specialistId,
        account_type: 'SPECIALIST_EARNINGS',
        currency: 'BRL',
        label: `Ganhos tarólogo ${String(specialistId).slice(0, 8)}…`,
        cached_balance: 0,
      },
      { transaction }
    );
  }
  return acc;
}

/**
 * Saldo em `SPECIALIST_EARNINGS.cached_balance` menos pedidos já reservados (PENDING/PROCESSING/APPROVED).
 */
async function getAvailablePayoutCapacityBrl(specialistId, transaction) {
  const sid = `${specialistId || ''}`.trim();
  if (!sid) return 0;

  const acc = await ensureSpecialistEarningsAccount(sid, transaction);
  await acc.reload({
    ...(transaction ? { transaction } : {}),
    lock: transaction?.LOCK?.UPDATE,
  });
  const bal = Number(acc.cached_balance ?? 0);

  const reservedRaw = await PayoutRequest.sum('amount', {
    where: {
      specialist_id: sid,
      status: { [Op.in]: ['PENDING', 'PROCESSING', 'APPROVED'] },
    },
    ...(transaction ? { transaction } : {}),
  });
  const reserved = Number.isFinite(Number(reservedRaw)) ? Number(reservedRaw) : 0;

  const avail = bal - reserved;
  return Number.isFinite(avail) ? roundAmt(avail) ?? 0 : 0;
}

function serializePayout(row) {
  const p = typeof row?.toJSON === 'function' ? row.toJSON() : row || {};
  return {
    id: p.id,
    specialist_id: p.specialist_id,
    amount: p.amount != null ? Number(p.amount) : null,
    status: p.status,
    pix_key: p.pix_key || p.pix_destination || null,
    pix_destination: p.pix_destination || null,
    pix_type: p.pix_type || null,
    requested_at: p.requested_at,
    processed_at: p.processed_at || p.paid_at || null,
    paid_at: p.paid_at || null,
    rejection_reason: p.rejection_reason || null,
  };
}

async function requestPayout(userId, body = {}) {
  const specialist = await specialistProfileForUserId(userId);
  if (!specialist) throw new AppError('Perfil tarólogo não encontrado.', 403, null, true);

  const pixKeyRaw = `${body.pix_key ?? body.pixKey ?? ''}`.trim();
  if (!pixKeyRaw) throw new AppError('Informe `pix_key`.', 400, null, true);

  let amount = typeof body.amount === 'number' ? body.amount : parseFloat(`${body.amount ?? ''}`);
  amount = roundAmt(amount);
  if (!amount || amount <= 0) {
    throw new AppError('amount inválido — informe um valor positivo em BRL.', 400, null, true);
  }

  return sequelize.transaction(async (t) => {
    const available = await getAvailablePayoutCapacityBrl(specialist.id, t);
    if (!(available >= amount - 1e-8)) {
      throw new AppError(
        `Saldo disponível insuficiente para este saque (${available ?? 0} BRL após deduzir pedidos pendentes).`,
        400,
        { available_brl: available, requested_brl: amount },
        true
      );
    }

    const pixTypeRaw = `${body.pix_type ?? body.pixType ?? ''}`.trim().slice(0, 32);

    const row = await PayoutRequest.create(
      {
        specialist_id: specialist.id,
        amount,
        status: 'PENDING',
        pix_destination: pixKeyRaw.slice(0, 256),
        pix_key: pixKeyRaw.slice(0, 256),
        pix_type: pixTypeRaw || null,
        gross_reference_amount: amount,
      },
      { transaction: t }
    );

    return serializePayout(row);
  });
}

async function listMyPayoutRequests(userId) {
  const specialist = await specialistProfileForUserId(userId);
  if (!specialist) throw new AppError('Perfil tarólogo não encontrado.', 403, null, true);

  const rows = await PayoutRequest.findAll({
    where: { specialist_id: specialist.id },
    order: [['requested_at', 'DESC']],
    limit: 200,
    paranoid: true,
  });

  return { payout_requests: rows.map(serializePayout) };
}

module.exports = {
  specialistProfileForUserId,
  getAvailablePayoutCapacityBrl,
  requestPayout,
  listMyPayoutRequests,
};
