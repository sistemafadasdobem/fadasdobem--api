'use strict';

const { AuditLog } = require('../../../models');

/**
 * @param {object} params
 * @param {string} [params.admin_id]
 * @param {string} params.action
 * @param {string} params.target_entity
 * @param {string|null} [params.target_id]
 * @param {object|null} [params.old_value]
 * @param {object|null} [params.new_value]
 * @param {object|null} [params.metadata]
 * @param {{ ip?: string; user_agent?: string; correlation_id?: string }} [params.httpCtx]
 */
/**
 * @param {object} [sequelizeOpts] transaction etc.
 */
async function persistAdminAuditLog(params = {}, sequelizeOpts = {}) {
  const adminRaw = `${params.admin_id ?? ''}`.trim() || null;
  const actionRaw = `${params.action ?? ''}`.trim();
  if (!actionRaw) return null;

  return AuditLog.create(
    {
      admin_id: adminRaw,
      action: actionRaw.slice(0, 120),
      target_entity: `${params.target_entity || 'UNKNOWN'}`.trim().slice(0, 80),
      target_id: `${params.target_id ?? ''}`.trim() ? `${params.target_id}`.trim() : null,
      old_value: params.old_value != null ? params.old_value : null,
      new_value: params.new_value != null ? params.new_value : null,
      metadata: params.metadata != null ? params.metadata : null,
      ip_address: `${params.httpCtx?.ip || ''}`.trim().slice(0, 45) || null,
      user_agent:
        `${params.httpCtx?.user_agent || ''}`.trim().slice(0, 4000) || null,
      correlation_id:
        `${params.httpCtx?.correlation_id || ''}`.trim().slice(0, 64) || null,
      occurred_at: new Date(),
    },
    sequelizeOpts
  );
}

module.exports = { persistAdminAuditLog };
