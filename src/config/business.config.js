'use strict';

/**
 * Parâmetros de negócio (Dossiê V2) — preferir override por variáveis de ambiente onde indicado.
 * Valores omitidos nos env aplicam defaults documentados aqui para operação rápida em dev.
 */

function envInt(key, fallback) {
  if (process.env[key] === undefined || process.env[key] === null || `${process.env[key]}`.trim() === '')
    return fallback;
  const n = Number.parseInt(String(process.env[key]).trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

function envString(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === null) return fallback;
  const t = `${raw}`.trim();
  return t || fallback;
}

/** Motivos de encerramento de sessão que habilitam o reembolso / ajuste “piso mínimo” (lista separada por vírgula no env). */
function parseSessionFloorEligibleEndReasons() {
  const raw = envString(
    'SESSION_FLOOR_ELIGIBLE_END_REASONS',
    'SPECIALIST_DISCONNECT,PLATFORM_ERROR,THIRD_PARTY_SDK_ERROR,NETWORK_ERROR,CANCELLED_BY_SPECIALIST'
  );
  return raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

module.exports = Object.freeze({
  /** Janela usada na UI/checkout para reserva de taróloga (minutos). */
  CLIENT_RESERVATION_MINUTES: envInt('CLIENT_RESERVATION_MINUTES', 5),

  /** Duração mínima económica referência para ajuste de piso (minutos). */
  SESSION_MINIMUM_FLOOR_MINUTES: envInt('SESSION_MINIMUM_FLOOR_MINUTES', 15),

  /** Janela em que o step-up (OTP) é considerado válido após re-autenticação (minutos). */
  STEP_UP_SESSION_DURATION_MINUTES: envInt('STEP_UP_SESSION_DURATION_MINUTES', 5),

  /**
   * Estratégia de geração de `Client.nome_id` a partir de `nome_completo`.
   * Valores: `FIRST_AND_LAST` | `FIRST_ONLY` | `FULL_COMPACT`
   */
  NAME_ID_GENERATION_LOGIC: envString('NAME_ID_GENERATION_LOGIC', 'FIRST_AND_LAST').toUpperCase(),

  /** Intervalo do job que libera reservas expiradas (ms). */
  SPECIALIST_RESERVATION_JOB_INTERVAL_MS: envInt('SPECIALIST_RESERVATION_JOB_INTERVAL_MS', 60_000),

  /** Claim JWT (access) com instante da verificação step-up (epoch segundos ou ms — ver middleware). */
  JWT_STEP_UP_VERIFIED_AT_CLAIM: envString('JWT_STEP_UP_VERIFIED_AT_CLAIM', 'step_up_verified_at'),

  /** Header alternativo ao claim (ISO-8601 ou epoch ms). */
  STEP_UP_HTTP_HEADER_NAME: envString('STEP_UP_HTTP_HEADER_NAME', 'x-step-up-verified-at').toLowerCase(),

  /** Motivos `sessions.ended_reason_code` elegíveis ao piso. */
  get SESSION_FLOOR_ELIGIBLE_END_REASONS() {
    return parseSessionFloorEligibleEndReasons();
  },
});
