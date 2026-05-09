'use strict';

const axios = require('axios');
const { randomUUID } = require('crypto');
const AppError = require('../../utils/AppError');

const MP_API_BASE_URL = `${process.env.MP_API_BASE_URL || 'https://api.mercadopago.com'}`.replace(
  /\/+$/,
  ''
);

/** @type {import('axios').AxiosInstance | null} */
let http = null;

function getAccessToken() {
  const mode = `${process.env.MP_ENV || 'sandbox'}`.trim().toLowerCase();
  const normalized = mode === 'production' || mode === 'sandbox' ? mode : 'sandbox';
  if (normalized !== mode && mode !== '') {
    console.warn(`[MercadoPago] MP_ENV inválido: "${mode}" — usando sandbox.`);
  }

  const token =
    normalized === 'production'
      ? `${process.env.MP_ACCESS_TOKEN_PRODUCTION || process.env.MP_ACCESS_TOKEN || ''}`.trim()
      : `${process.env.MP_ACCESS_TOKEN_SANDBOX || process.env.MP_ACCESS_TOKEN || ''}`.trim();

  if (!token) {
    throw new AppError(
      normalized === 'production'
        ? 'Mercado Pago: defina MP_ACCESS_TOKEN_PRODUCTION (ou MP_ACCESS_TOKEN) em modo production.'
        : 'Mercado Pago: defina MP_ACCESS_TOKEN_SANDBOX (ou MP_ACCESS_TOKEN) em modo sandbox.',
      503,
      null,
      true
    );
  }
  return token;
}

function ensureHttp() {
  if (!http) {
    http = axios.create({
      baseURL: MP_API_BASE_URL,
      timeout: Math.min(
        60000,
        Math.max(5000, parseInt(String(process.env.MP_REST_TIMEOUT_MS || '20000'), 10) || 20000)
      ),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    http.interceptors.request.use((config) => {
      config.headers.Authorization = `Bearer ${getAccessToken()}`;
      return config;
    });
  }
  return http;
}

/**
 * PIX — Checkout Transparente (`payment_method_id: pix`).
 *
 * @param {{
 *   transaction_amount: number;
 *   description: string;
 *   external_reference: string;
 *   payer_email: string;
 *   payer_first_name?: string;
 *   payer_last_name?: string;
 *   notification_url?: string;
 * }} p
 */
async function createPixPayment(p) {
  const payload = {
    transaction_amount: Number(p.transaction_amount),
    description: p.description,
    payment_method_id: 'pix',
    external_reference: p.external_reference,
    payer: {
      email: p.payer_email,
      first_name: p.payer_first_name || 'Cliente',
      last_name: p.payer_last_name || '',
    },
  };
  if (p.notification_url) {
    payload.notification_url = p.notification_url;
  }

  const { data, status } = await ensureHttp().post('/v1/payments', payload, {
    headers: { 'X-Idempotency-Key': randomUUID() },
    validateStatus: () => true,
  });
  if (status >= 400) {
    throw new AppError(
      typeof data?.message === 'string' ? data.message : 'Falha ao criar pagamento PIX no Mercado Pago.',
      status,
      data,
      true
    );
  }
  return data;
}

/**
 * Cartão — token gerado no front (Bricks / JS). PCI: nunca envie PAN completo ao servidor.
 *
 * @param {{
 *   transaction_amount: number;
 *   description: string;
 *   external_reference: string;
 *   token: string;
 *   payment_method_id: string;
 *   installments: number;
 *   issuer_id?: string;
 *   payer_email: string;
 *   payer_identification?: { type: string; number: string };
 *   notification_url?: string;
 * }} p
 */
async function createCardPayment(p) {
  const payload = {
    transaction_amount: Number(p.transaction_amount),
    token: p.token,
    description: p.description,
    installments: Math.max(1, parseInt(String(p.installments || 1), 10)),
    payment_method_id: `${p.payment_method_id || ''}`.trim(),
    external_reference: p.external_reference,
    payer: {
      email: p.payer_email,
      identification: p.payer_identification || undefined,
    },
  };
  if (p.issuer_id) payload.issuer_id = `${p.issuer_id}`.trim();
  if (p.notification_url) payload.notification_url = p.notification_url;

  const { data, status } = await ensureHttp().post('/v1/payments', payload, {
    headers: { 'X-Idempotency-Key': randomUUID() },
    validateStatus: () => true,
  });
  if (status >= 400) {
    throw new AppError(
      typeof data?.message === 'string' ? data.message : 'Falha ao processar pagamento com cartão no Mercado Pago.',
      status,
      data,
      true
    );
  }
  return data;
}

/** @param {string|number} paymentId — ID oficial do pagamento MP */
async function getPaymentById(paymentId) {
  const id = `${paymentId || ''}`.trim();
  if (!id) {
    throw new AppError('paymentId é obrigatório.', 400, null, true);
  }
  const { data, status } = await ensureHttp().get(`/v1/payments/${encodeURIComponent(id)}`, {
    validateStatus: () => true,
  });
  if (status === 404) {
    throw new AppError('Pagamento não encontrado no Mercado Pago.', 404, null, true);
  }
  if (status >= 400) {
    throw new AppError(
      'Falha ao consultar pagamento no Mercado Pago.',
      status,
      data,
      true
    );
  }
  return data;
}

module.exports = {
  createPixPayment,
  createCardPayment,
  getPaymentById,
  MP_API_BASE_URL,
};
