const AppError = require('../utils/AppError');

/**
 * Exige `req.user` já colocado pelo `auth.middleware` com `role === 'TAROLOGA'`.
 */
module.exports = function requireTarologaRoleMiddleware(req, _res, next) {
  const role = req.user?.role;
  if (!req.user || role !== 'TAROLOGA') {
    return next(
      new AppError('Recurso exclusivo para contas taróloga.', 403, { codigo: 'FORBIDDEN_NOT_TAROLOGA' }, true)
    );
  }
  return next();
};
