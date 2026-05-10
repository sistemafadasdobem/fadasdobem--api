'use strict';

/**
 * Segurança “step-up”: rotas sensíveis só após re-autenticação (OTP) recente.
 * **Use depois de** `auth.middleware` (define `req.jwtClaims`).
 */

const business = require('../config/business.config');
const AppError = require('../utils/AppError');

/** @returns {number} millis Unix ou NaN */
function coerceStepUpVerifiedAtMs(raw) {
  if (raw === undefined || raw === null) return NaN;

  const n =
    typeof raw === 'bigint'
      ? Number(raw)
      : typeof raw === 'number'
        ? raw
        : Number(`${raw}`.trim());
  if (Number.isFinite(n)) {
    /** Heurística: &gt; 1e11 → ms Unix absoluto; senão epoch em segundos. */
    return Math.abs(n) > 1e11 ? Math.trunc(n) : Math.trunc(n * 1000);
  }

  const iso = `${raw}`.trim();
  if (!iso) return NaN;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : NaN;
}

/**
 * Preferência ao claim JWT; header alternativo (Express normaliza chaves para minúsculas).
 */
function resolveStepUpVerifiedAtMs(req) {
  const claimKey = business.JWT_STEP_UP_VERIFIED_AT_CLAIM;
  const fromClaim = req.jwtClaims?.[claimKey];

  const headerName =
    `${business.STEP_UP_HTTP_HEADER_NAME || 'x-step-up-verified-at'}`.trim().toLowerCase();
  const hdrRaw = req.headers?.[headerName];
  let headerStr = hdrRaw;
  if (Array.isArray(hdrRaw)) [headerStr] = hdrRaw;

  let token = `${fromClaim ?? ''}`.trim();
  if (!token) {
    token = `${headerStr ?? ''}`.trim();
  }
  return coerceStepUpVerifiedAtMs(token || null);
}

function requireRecentStepVerification(req, _res, next) {
  try {
    if (!req.jwtClaims || typeof req.jwtClaims !== 'object') {
      throw new AppError(
        'Inconsistência: falta JWT decodificado. Aplique `auth.middleware` antes do step-up.',
        500,
        null,
        true
      );
    }

    const verifiedAtMs = resolveStepUpVerifiedAtMs(req);
    if (!Number.isFinite(verifiedAtMs)) {
      throw new AppError(
        'Verificação adicional obrigatória — conclua o OTP ou envie a marca temporal de step-up válida.',
        403,
        {
          jwt_claim_hint: business.JWT_STEP_UP_VERIFIED_AT_CLAIM,
          optional_header_hint: business.STEP_UP_HTTP_HEADER_NAME,
        },
        true
      );
    }

    /** `STEP_UP_SESSION_DURATION_MINUTES &lt;= 0` desabilita TTL (somente cenários pontuais / dev assistido por env). */
    const ttlMin = Number(business.STEP_UP_SESSION_DURATION_MINUTES);
    if (!(ttlMin > 0)) {
      return next();
    }

    const maxAge = ttlMin * 60 * 1000;

    const ageMs = Date.now() - verifiedAtMs;
    if (ageMs < 0) {
      throw new AppError('Marcador step-up está no futuro — recusado.', 403, null, true);
    }
    if (ageMs > maxAge) {
      throw new AppError(
        `Step-up expirado (TTL ${ttlMin} min). Re-autenticação necessária.`,
        403,
        null,
        true
      );
    }

    return next();
  } catch (err) {
    return next(err instanceof AppError ? err : new AppError('Acesso bloqueado.', 403, null, true));
  }
}

/** Alias solicitado pela equipa (mesmo comportamento que `requireRecentStepVerification`). */
const stepUpMiddleware = requireRecentStepVerification;

module.exports = {
  requireRecentStepVerification,
  stepUpMiddleware,
  coerceStepUpVerifiedAtMs,
  resolveStepUpVerifiedAtMs,
};
