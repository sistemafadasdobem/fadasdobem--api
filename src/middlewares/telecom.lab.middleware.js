'use strict';

const AppError = require('../utils/AppError');

function labEnabledTruthy() {
  const v = `${process.env.INTELBRAS_TELECOM_LAB_ENABLED || ''}`.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

/**
 * Gate para rotas `/api/v1/telecom/lab/*` — **desligado por defeito.**
 * Opcional: `INTELBRAS_TELECOM_LAB_SECRET` → exige header `x-telecom-lab-secret` (ou query `lab_secret`, só homolog).
 */
function requireTelecomLab(req, _res, next) {
  if (!labEnabledTruthy()) {
    return next(new AppError('Laboratório telecom indisponível.', 404, null, true));
  }

  const expected = `${process.env.INTELBRAS_TELECOM_LAB_SECRET || ''}`.trim();
  if (expected) {
    const got =
      `${req.get('x-telecom-lab-secret') || ''}`.trim() ||
      `${typeof req.query?.lab_secret === 'string' ? req.query.lab_secret : ''}`.trim();
    if (!got || got !== expected) {
      return next(new AppError('Credencial do laboratório inválida ou ausente.', 401, null, true));
    }
  }

  next();
}

module.exports = {
  requireTelecomLab,
  labEnabledTruthy,
};
