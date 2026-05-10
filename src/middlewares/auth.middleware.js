const jwt = require('jsonwebtoken');
const { User, Client } = require('../models');
const AppError = require('../utils/AppError');
const { jwtVerifyOptions } = require('../config/auth.config');

/**
 * Exige `Authorization: Bearer <access_token>` válido, usuário ativo e injeta `req.user` (com `client_profile` se existir).
 */
module.exports = async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, raw] = header.split(' ');
    if (!scheme || scheme.toLowerCase() !== 'bearer' || !raw) {
      throw new AppError('Token de acesso não informado.', 401, null, true);
    }

    let payload;
    try {
      payload = jwt.verify(raw.trim(), process.env.JWT_SECRET, jwtVerifyOptions());
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new AppError('Sessão expirada. Faça login novamente ou use o refresh token.', 401, null, true);
      }
      throw new AppError('Token inválido ou corrompido.', 401, null, true);
    }

    if (payload.token_use !== 'access') {
      throw new AppError('Tipo de token incorreto para esta rota.', 401, null, true);
    }

    const user = await User.findByPk(payload.sub, {
      include: [
        {
          model: Client,
          as: 'client_profile',
          required: false,
        },
      ],
    });

    if (!user) {
      throw new AppError('Conta não encontrada ou removida.', 401, null, true);
    }
    if (!user.is_active) {
      throw new AppError('Conta desativada. Contate o suporte.', 401, null, true);
    }
    if (user.blocked_at) {
      throw new AppError('Conta bloqueada. Contate o suporte.', 401, null, true);
    }

    req.jwtClaims = payload;
    req.user = user;
    return next();
  } catch (err) {
    return next(err instanceof AppError ? err : new AppError('Não autorizado.', 401, null, true));
  }
};
