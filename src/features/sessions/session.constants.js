/**
 * Cronômetro **2+X+2** (core) — parâmetros de produto não hardcoded dispersos.
 * Mantém defaults alinhados ao que costuma estar em `Session.cron_config_*` até refatorarmos snapshots.
 */

/** Cortesia inicial antes de iniciar debitar minutos pagos. */
const FREE_INITIAL_MINUTES = 2;

/**
 * Janela de aviso: quando restam até N minutos de saldo pré-pagos (inteiro‑arredondado pelo preço/min),
 * a sessão entra em `telecom_status = WARNING` antes do corte por saldo.
 */
const WARNING_REMAINING_MINUTES = 2;

/** Intervalo sugerido do loop que varre carteiras (`setInterval`) — usar em `app.js` ou worker. */
const BILLING_TICK_INTERVAL_MS = 10000;

module.exports = Object.freeze({
  FREE_INITIAL_MINUTES,
  WARNING_REMAINING_MINUTES,
  BILLING_TICK_INTERVAL_MS,
});
