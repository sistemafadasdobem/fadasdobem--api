const { AuditLog } = require('../../models');

/**
 * Auditoria de segurança (R15). Não grava senhas, tokens em claro nem refresh.
 * `admin_id` fica nulo — eventos iniciados pelo próprio utilizador.
 *
 * @param {object} opts
 * @param {string} opts.action — identificador estável (ex.: AUTH_LOGIN_SUCCESS)
 * @param {string|null} [opts.userId]
 * @param {string|null} [opts.ip]
 * @param {string|null} [opts.userAgent]
 * @param {string} [opts.targetEntity='User']
 * @param {object} [opts.metadata]
 */
async function recordAuthSecurityAudit({
  action,
  userId = null,
  ip = null,
  userAgent = null,
  targetEntity = 'User',
  metadata = {},
}) {
  try {
    await AuditLog.create({
      admin_id: null,
      action,
      target_entity: targetEntity,
      target_id: userId,
      old_value: null,
      new_value: null,
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      ip_address: ip ? `${ip}`.slice(0, 45) : null,
      user_agent: userAgent ? `${userAgent}`.slice(0, 2000) : null,
      occurred_at: new Date(),
    });
  } catch (err) {
    console.error('[auth-audit] falha ao registar evento (não bloqueia fluxo):', action, err.message);
  }
}

module.exports = {
  recordAuthSecurityAudit,
};
