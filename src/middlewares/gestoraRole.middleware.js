const AppError = require('../utils/AppError');

/**
 * Exige `auth.middleware` com `role === 'GESTORA'` (Gestão Nice / Fase 4).
 */
module.exports = function requireGestoraRoleMiddleware(req, _res, next) {
  const role = req.user?.role;
  if (!req.user || role !== 'GESTORA') {
    return next(
      new AppError(
        'Recurso exclusivo para contas de gestão (GESTORA).',
        403,
        { codigo: 'FORBIDDEN_NOT_GESTORA' },
        true
      )
    );
  }
  return next();
};
