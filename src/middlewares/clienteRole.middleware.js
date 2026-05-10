const AppError = require('../utils/AppError');

/** Exige `req.user.role === CLIENTE`. Usar **após** `auth.middleware`. */
module.exports = function requireClienteRoleMiddleware(req, _res, next) {
  if (!req.user || `${req.user.role || ''}`.trim().toUpperCase() !== 'CLIENTE') {
    return next(new AppError('Recurso exclusivo para perfil cliente.', 403, { codigo: 'FORBIDDEN_NOT_CLIENTE' }, true));
  }
  return next();
};
