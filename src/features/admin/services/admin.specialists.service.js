'use strict';

const { Op } = require('sequelize');
const {
  sequelize,
  User,
  Specialist,
} = require('../../../models');
const AppError = require('../../../utils/AppError');
const { persistAdminAuditLog } = require('../helpers/adminAudit.helper');
const { coerceBool } = require('../helpers/coerceBody.util');

async function approveOrRejectTarologa(actorUserId, specialistId, body = {}, httpCtx = {}) {
  const sid = `${specialistId || ''}`.trim();
  const adminId = `${actorUserId || ''}`.trim();
  if (!sid) throw new AppError('ID da especialista omisso.', 400, null, true);

  const lockedPre = await Specialist.findByPk(sid, {
    paranoid: true,
    attributes: ['id', 'user_id', 'registration_approval_status'],
  });
  if (!lockedPre) throw new AppError('Especialista não encontrada.', 404, null, true);

  const uPre = await User.findByPk(lockedPre.user_id, {
    paranoid: true,
    attributes: ['id', 'role', 'is_active', 'blocked_at'],
  });
  if (!uPre) throw new AppError('Utilizadora da taróloga não encontrada.', 404, null, true);

  const reject = coerceBool(body.reject ?? body.rejeitar);
  const approve = coerceBool(body.approved ?? body.is_active ?? body.ativo);

  let wantActive;
  let nextReg;
  if (reject === true) {
    wantActive = false;
    nextReg = 'REJECTED';
  } else if (approve === null) {
    throw new AppError(
      'Envie `approved` / `is_active` (boolean) ou `reject`/`rejeitar` (true para reprovar).',
      400,
      null,
      true
    );
  } else {
    wantActive = approve;
    nextReg = wantActive ? 'APPROVED' : 'REJECTED';
  }

  const oldSnap = {
    specialist_id: sid,
    user_id: uPre.id,
    registration_approval_status: lockedPre.registration_approval_status,
    user_is_active: uPre.is_active,
    user_blocked_at: uPre.blocked_at,
  };

  await sequelize.transaction(async (t) => {
    const lockedSpec = await Specialist.findByPk(sid, {
      transaction: t,
      lock: t.LOCK.UPDATE,
      paranoid: true,
    });

    const u = await User.findByPk(lockedSpec.user_id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
      paranoid: true,
      attributes: ['id', 'role', 'is_active', 'blocked_at'],
    });
    if (!u) throw new AppError('Utilizadora da taróloga não encontrada.', 404, null, true);
    if (`${u.role || ''}` !== 'TAROLOGA') throw new AppError('Conta não é papel TARÓLOGA — inconsistência cadastral.', 409, null, true);

    await u.update({ is_active: Boolean(wantActive) }, { transaction: t });

    await lockedSpec.update(
      {
        registration_approval_status: nextReg,
        registration_reviewed_at: new Date(),
        ...(wantActive === false ? { status: 'OFFLINE', reserved_until: null, reserved_by_client_id: null } : {}),
      },
      { transaction: t }
    );

    await persistAdminAuditLog(
      {
        admin_id: adminId,
        action: 'ADMIN_APPROVE_SPECIALIST',
        target_entity: 'Specialist',
        target_id: sid,
        old_value: oldSnap,
        new_value: {
          registration_approval_status: nextReg,
          user_is_active: Boolean(u.is_active),
          user_id: u.id,
        },
        metadata: (() => {
          const jus = `${body.justification ?? body.justificativa ?? ''}`.trim().slice(0, 400);
          return jus ? { justification: jus } : null;
        })(),
        httpCtx: {
          ip: httpCtx.ip,
          user_agent: httpCtx.userAgent,
          correlation_id: httpCtx.correlationId,
        },
      },
      { transaction: t }
    );
  });

  const specialist = await Specialist.findByPk(sid, {
    paranoid: true,
    attributes: ['id', 'user_id', 'registration_approval_status', 'registration_reviewed_at'],
  });
  const refreshed = await User.findByPk(specialist.user_id, { paranoid: true, attributes: ['id', 'is_active'] });

  return {
    specialist_id: specialist.id,
    user_id: specialist.user_id,
    registration_approval_status: specialist.registration_approval_status,
    reviewed_at: specialist.registration_reviewed_at,
    is_active_user: Boolean(refreshed?.is_active),
  };
}

async function patchRankingBoostMultiplier(actorUserId, specialistId, body = {}, httpCtx = {}) {
  const sid = `${specialistId || ''}`.trim();
  const adminId = `${actorUserId || ''}`.trim();
  const rawMul = body.rank_boost_multiplier ?? body.multiplier;
  let m =
    typeof rawMul === 'number' ? rawMul : typeof rawMul === 'string' ? Number.parseFloat(rawMul) : Number.NaN;
  if (!Number.isFinite(m) || m <= 0) throw new AppError('Informe `multiplier` / `rank_boost_multiplier` > 0.', 400, null, true);
  m = Math.min(Math.max(m, 0.01), 999.9999);

  const snapshot = await Specialist.findByPk(sid, {
    paranoid: true,
    attributes: ['id', 'rank_boost_multiplier'],
  });
  if (!snapshot) throw new AppError('Especialista não encontrada.', 404, null, true);

  const prev = snapshot.rank_boost_multiplier != null ? Number(snapshot.rank_boost_multiplier) : 1;

  await sequelize.transaction(async (t) => {
    const row = await Specialist.findByPk(sid, {
      paranoid: true,
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    await row.update({ rank_boost_multiplier: m }, { transaction: t });

    await persistAdminAuditLog(
      {
        admin_id: adminId,
        action: 'ADMIN_RANKING_BOOST_SPECIALIST',
        target_entity: 'Specialist',
        target_id: sid,
        old_value: { rank_boost_multiplier: prev },
        new_value: { rank_boost_multiplier: m },
        httpCtx: {
          ip: httpCtx.ip,
          user_agent: httpCtx.userAgent,
          correlation_id: httpCtx.correlationId,
        },
      },
      { transaction: t }
    );
  });

  const refreshed = await Specialist.findByPk(sid, {
    paranoid: true,
    attributes: ['id', 'rank_boost_multiplier'],
  });

  return {
    specialist_id: refreshed.id,
    rank_boost_multiplier:
      refreshed.rank_boost_multiplier != null ? Number(refreshed.rank_boost_multiplier) : m,
  };
}

async function listSpecialistsAdmin(query = {}) {
  let limit = parseInt(`${query.limit ?? 100}`, 10);
  let offset = parseInt(`${query.offset ?? 0}`, 10);
  if (!Number.isFinite(limit)) limit = 100;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  limit = Math.min(Math.max(limit, 1), 250);

  const where = {};

  const stRaw = `${query.registration_status || query.approval || ''}`.trim().toUpperCase();
  if (stRaw && Specialist.REG_APPROVAL_STATUSES?.includes(stRaw)) {
    where.registration_approval_status = stRaw;
  }

  const statusTar = `${query.status || ''}`.trim().toUpperCase();
  if (statusTar && Specialist.STATUSES?.includes(statusTar)) {
    where.status = statusTar;
  }

  const qEmail = `${query.email || ''}`.trim().toLowerCase();
  /** @type {import('sequelize').IncludeOptions[]} */
  const includeUser = [
    {
      model: User,
      as: 'user',
      paranoid: true,
      attributes: ['id', 'email', 'phone', 'is_active', 'blocked_at', 'last_login_at', 'onboarding_completed_at'],
      ...(qEmail
        ? { where: { email: { [Op.iLike]: `%${qEmail}%` } }, required: true }
        : { required: false }),
    },
  ];

  const rows = await Specialist.findAll({
    where,
    paranoid: true,
    order: [['display_name', 'ASC']],
    limit,
    offset,
    include: includeUser,
  });

  return rows.map((r) => {
    const json = typeof r?.toJSON === 'function' ? r.toJSON() : r || {};
    return {
      specialist: json,
      user: json.user || null,
    };
  });
}

module.exports = {
  approveOrRejectTarologa,
  patchRankingBoostMultiplier,
  listSpecialistsAdmin,
};
