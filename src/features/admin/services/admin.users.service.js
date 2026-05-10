'use strict';

const { Op } = require('sequelize');
const {
  sequelize,
  User,
  Client,
} = require('../../../models');
const AppError = require('../../../utils/AppError');
const { persistAdminAuditLog } = require('../helpers/adminAudit.helper');
const { coerceBool } = require('../helpers/coerceBody.util');

function httpCtxNormalize(httpCtx = {}) {
  return {
    ip: httpCtx.ip,
    user_agent: httpCtx.userAgent,
    correlation_id: httpCtx.correlationId,
  };
}

async function searchClientAccounts(query = {}) {
  const raw = `${query.q ?? query.term ?? query.search ?? ''}`.trim();
  if (!raw || raw.length < 2) {
    throw new AppError('Informe `q` (mínimo 2 caracteres) para pesquisar clientes.', 400, null, true);
  }

  let limit = parseInt(`${query.limit ?? 40}`, 10);
  if (!Number.isFinite(limit)) limit = 40;
  limit = Math.min(Math.max(limit, 1), 100);

  const like = `%${raw}%`;
  const digitsCompact = raw.replace(/\D+/g, '');

  const { QueryTypes } = require('sequelize');

  const cpfClause =
    digitsCompact.length >= 3 ? ` OR regexp_replace(coalesce(c.cpf,''), '\\D','','g') LIKE :digitsLike ` : '';

  const rows = await sequelize.query(
    `
    SELECT
      c.id AS client_id,
      c.nome_completo,
      c.nome_id,
      c.nome,
      c.apelido,
      c.cpf,
      u.id AS user_id,
      u.email,
      u.phone,
      u.blocked_at,
      u.is_active,
      u.onboarding_completed_at
    FROM clients c
    INNER JOIN users u ON u.id = c.user_id
    WHERE c.deleted_at IS NULL
      AND u.deleted_at IS NULL
      AND u.role = 'CLIENTE'
      AND (
        c.nome_completo ILIKE :needle
        OR c.nome_id ILIKE :needle
        OR c.nome ILIKE :needle
        OR u.email ILIKE :needle
        ${cpfClause}
      )
    ORDER BY u.last_login_at DESC NULLS LAST, c.created_at DESC NULLS LAST
    LIMIT :lim
    `,
    {
      type: QueryTypes.SELECT,
      replacements: {
        needle: like,
        ...(digitsCompact.length >= 3 ? { digitsLike: `%${digitsCompact}%` } : {}),
        lim: limit,
      },
    }
  );

  return rows;
}

async function patchUserSuspend(actorUserId, targetUserId, body = {}, httpCtx = {}) {
  const actorId = `${actorUserId || ''}`.trim();
  const tgt = `${targetUserId || ''}`.trim();

  if (!tgt) throw new AppError('user_id inválido.', 400, null, true);
  if (actorId === tgt) {
    throw new AppError('Não pode suspender ou reactivar a própria conta GESTORA por esta API.', 400, null, true);
  }

  const blocking = coerceBool(body.blocked ?? body.suspend ?? body.block);
  if (blocking === null) throw new AppError('Envie `blocked` ou `suspend` (boolean).', 400, null, true);

  const target = await User.findByPk(tgt, {
    paranoid: true,
    attributes: ['id', 'role', 'blocked_at', 'block_reason', 'is_active', 'email'],
  });
  if (!target) throw new AppError('Utilizador alvo não encontrado.', 404, null, true);

  if (`${target.role || ''}` === 'GESTORA' && blocking) {
    throw new AppError('Suspender outra conta GESTORA não é permitido por esta API.', 403, null, true);
  }

  const oldSnap = {
    user_id: target.id,
    role: target.role,
    blocked_at: target.blocked_at,
    block_reason: target.block_reason,
    is_active: target.is_active,
  };

  await sequelize.transaction(async (t) => {
    const u = await User.findByPk(tgt, {
      transaction: t,
      lock: t.LOCK.UPDATE,
      paranoid: true,
      attributes: ['id', 'role', 'blocked_at', 'block_reason', 'is_active'],
    });

    if (blocking) {
      await u.update(
        {
          blocked_at: new Date(),
          block_reason:
            `${body.reason || body.motivo || ''}`.trim().slice(0, 1600) || null,
          is_active: false,
        },
        { transaction: t }
      );
    } else {
      await u.update(
        {
          blocked_at: null,
          block_reason: null,
        },
        { transaction: t }
      );
    }

    await u.reload({ transaction: t });

    await persistAdminAuditLog(
      {
        admin_id: actorId,
        action: 'ADMIN_BLOCK_USER_TOGGLE',
        target_entity: 'User',
        target_id: tgt,
        old_value: oldSnap,
        new_value: {
          blocked_at: u.blocked_at,
          block_reason: u.block_reason,
          is_active: u.is_active,
        },
        httpCtx: httpCtxNormalize(httpCtx),
      },
      { transaction: t }
    );
  });

  await target.reload();

  return {
    user_id: target.id,
    blocked_at: target.blocked_at,
    is_active: target.is_active,
    block_reason: target.block_reason,
    email: `${target.email || ''}`,
  };
}

module.exports = { searchClientAccounts, patchUserSuspend };
