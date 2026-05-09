'use strict';

const crypto = require('crypto');
const AppError = require('../utils/AppError');

/**
 * Extrai `data.id` da query (notificações MP via URL) ou do corpo JSON já parseado.
 * Na validação HMAC, o campo é normalizado em **minúsculas** (requisito técnico Orders/Payments).
 */
function extractMercadoPagoNotificationDataId(req) {
  const q = req.query || {};
  let raw =
    q['data.id'] ??
    q.data?.id ??
    req.body?.data?.id ??
    req.body?.resource_id ??
    null;

  if (raw == null && typeof req.body?.resource === 'string') {
    const m = req.body.resource.match(/(\d+)\s*$/);
    if (m) raw = m[1];
  }

  if (raw == null || raw === '') return '';
  return String(raw).trim().toLowerCase();
}

function parseXSignatureHeader(headerVal) {
  const map = {};
  String(headerVal || '').split(',').forEach((segment) => {
    const idx = segment.indexOf('=');
    if (idx === -1) return;
    const key = segment.slice(0, idx).trim().toLowerCase();
    const value = segment.slice(idx + 1).trim();
    if (key) map[key] = value;
  });
  return map;
}

function compareHmacHex(secret, manifest, v1Hex) {
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const a = Buffer.from(String(expected).toLowerCase(), 'hex');
  const b = Buffer.from(String(v1Hex).toLowerCase(), 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Valida `x-signature` (ts + v1) conforme documentação Mercado Pago.
 * Template: `id:{dataId};request-id:{xRequestId};ts:{ts};`
 */
function validateMercadoPagoWebhook(req, res, next) {
  const bypass = `${process.env.MP_WEBHOOK_VERIFY_DISABLED || ''}`.trim().toLowerCase();
  if (bypass === 'true' || bypass === '1' || bypass === 'yes') {
    console.warn('[MP:Webhook] verificação de assinatura DESLIGADA — não use em produção.');
    return next();
  }

  const secret = `${process.env.MP_WEBHOOK_SECRET || ''}`.trim();
  if (!secret) {
    return next(
      new AppError(
        'MP_WEBHOOK_SECRET não configurado — impossível validar webhooks Mercado Pago.',
        503,
        null,
        true
      )
    );
  }

  const xSignature = req.get('x-signature') || req.get('X-Signature');
  const xRequestId = req.get('x-request-id') || req.get('X-Request-Id');

  if (!xSignature) {
    return next(new AppError('Cabeçalho x-signature ausente.', 401, null, true));
  }
  if (!xRequestId) {
    return next(new AppError('Cabeçalho x-request-id ausente.', 401, null, true));
  }

  const dataId = extractMercadoPagoNotificationDataId(req);
  if (!dataId) {
    return next(new AppError('data.id ausente — não é possível validar a assinatura.', 401, null, true));
  }

  const parts = parseXSignatureHeader(xSignature);
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) {
    return next(new AppError('x-signature inválido (esperado ts e v1).', 401, null, true));
  }

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  if (!compareHmacHex(secret, manifest, v1)) {
    console.warn('[MP:Webhook] assinatura HMAC inválida', {
      dataIdPreview: dataId.slice(0, 16),
      requestIdPreview: String(xRequestId).slice(0, 16),
    });
    return next(new AppError('Assinatura do webhook Mercado Pago inválida.', 403, null, true));
  }

  return next();
}

module.exports = {
  validateMercadoPagoWebhook,
  extractMercadoPagoNotificationDataId,
};
