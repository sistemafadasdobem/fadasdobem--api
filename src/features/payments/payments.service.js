'use strict';

const { randomUUID } = require('crypto');
const { Op } = require('sequelize');
const {
  PaymentOrder,
  ClientCreditLot,
  TransactionLedger,
  LedgerAccount,
} = require('../../models');
const { sequelize } = require('../../config/database');
const AppError = require('../../utils/AppError');
const mpClient = require('../../providers/mercadopago/mercadopago.client');
const { loadPackageCatalog } = require('./payments.constants');

function cloneJson(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return null;
  }
}

function redactWebhookHeaders(h) {
  const out = { ...h };
  if (out['x-signature']) out['x-signature'] = '[redacted]';
  return out;
}

function isMercadoPagoProductionEnv() {
  return `${process.env.MP_ENV || 'sandbox'}`.trim().toLowerCase() === 'production';
}

/** Bloqueia notificações de teste (`live_mode: false`) quando a API está em modo produção. */
function assertNoTestNotificationInProduction(body, mpPayment) {
  if (!isMercadoPagoProductionEnv()) return true;
  const candidates = [body?.live_mode, mpPayment?.live_mode];
  for (const lm of candidates) {
    if (lm === false || lm === 'false' || lm === 0 || lm === '0') {
      console.error(
        '[Security] Tentativa de injetar pagamento de Teste em ambiente de Produção bloqueada.'
      );
      return false;
    }
  }
  return true;
}

/** Logs detalhados do webhook (`MP_WEBHOOK_VERBOSE=false` para silenciar JSON completo). */
function isMpWebhookVerbose() {
  const v = process.env.MP_WEBHOOK_VERBOSE;
  if (v === undefined || String(v).trim() === '') return true;
  return ['true', '1', 'yes', 'on'].includes(String(v).trim().toLowerCase());
}

function safeJsonForLog(obj, maxChars) {
  const max = typeof maxChars === 'number' && maxChars > 0 ? maxChars : 32000;
  try {
    const s = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
    if (s.length <= max) return s;
    return `${s.slice(0, max)}\n… [{MP:Webhook} truncado — total ${s.length} chars]`;
  } catch (e) {
    return `[MP:Webhook] não serializável: ${e?.message || e}`;
  }
}

function appendWebhookVault(existing, entry) {
  const row = {
    received_at: new Date().toISOString(),
    ...entry,
  };
  if (existing == null) return [row];
  if (Array.isArray(existing)) return [...existing, row];
  return [existing, row];
}

function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return null;
  return Math.round(x * 10000) / 10000;
}

function validateCreditType(ct) {
  const allowed = ClientCreditLot.CREDIT_TYPES || ['AVULSO', 'PACOTE_SESSAO_UNICA'];
  if (!allowed.includes(ct)) {
    throw new AppError(`credit_type inválido. Use: ${allowed.join(', ')}.`, 400, null, true);
  }
  return ct;
}

function pickCreditBrlFromMp(order, mp) {
  const net = mp?.transaction_details?.net_received_amount;
  const netN = net != null ? Number(net) : NaN;
  if (Number.isFinite(netN) && netN >= 0) return roundMoney(netN);
  const gross = mp?.transaction_amount != null ? Number(mp.transaction_amount) : Number(order.amount);
  return roundMoney(gross);
}

function mapPaymentMethod(mp) {
  const tid = `${mp?.payment_type_id || ''}`.toLowerCase();
  if (tid.includes('credit')) return 'CREDIT_CARD';
  if (tid.includes('debit')) return 'DEBIT_CARD';
  if (tid.includes('bank') || `${mp?.payment_method_id || ''}`.toLowerCase() === 'pix') return 'PIX';
  if (tid.includes('account_money')) return 'WALLET_MP';
  return 'UNKNOWN';
}

function resolveNotificationUrl() {
  const explicit = `${process.env.MP_NOTIFICATION_URL || ''}`.trim();
  if (explicit) return explicit;
  const base = `${process.env.API_PUBLIC_URL || ''}`.trim().replace(/\/+$/, '');
  if (!base) return undefined;
  return `${base}/api/v1/payments/webhook`;
}

function resolvePurchaseInput(body = {}) {
  const catalog = loadPackageCatalog();
  const packageId = body.package_id != null ? String(body.package_id).trim() : '';
  const amountRaw = body.amount;

  if (amountRaw != null && amountRaw !== '') {
    const amt = roundMoney(amountRaw);
    if (!amt) {
      throw new AppError('amount inválido — informe um valor positivo em BRL.', 400, null, true);
    }
    return {
      amount_brl: amt,
      credit_type: validateCreditType(`${body.credit_type || 'AVULSO'}`.trim().toUpperCase()),
      label: body.label || 'Recarga avulsa',
      package_id: null,
    };
  }

  if (!packageId) {
    throw new AppError('Informe `package_id` ou `amount` (BRL).', 400, null, true);
  }

  const pkg = catalog[packageId];
  if (!pkg || typeof pkg !== 'object') {
    throw new AppError(`Pacote desconhecido: "${packageId}".`, 400, null, true);
  }
  const amt = roundMoney(pkg.amount_brl);
  if (!amt) {
    throw new AppError(`Pacote "${packageId}" sem amount_brl válido.`, 500, null, true);
  }
  return {
    amount_brl: amt,
    credit_type: validateCreditType(
      `${pkg.credit_type || 'PACOTE_SESSAO_UNICA'}`.trim().toUpperCase()
    ),
    label: pkg.label || packageId,
    package_id: packageId,
  };
}

async function ensurePlatformSuspense(t) {
  let acc = await LedgerAccount.findOne({
    where: {
      account_type: 'PLATFORM_SUSPENSE',
      client_id: { [Op.is]: null },
      specialist_id: { [Op.is]: null },
    },
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  if (!acc) {
    acc = await LedgerAccount.create(
      {
        account_type: 'PLATFORM_SUSPENSE',
        currency: 'BRL',
        label: 'Suspense — liquidação gateways',
        cached_balance: null,
      },
      { transaction: t }
    );
  }
  return acc;
}

async function ensureChargebackReserve(t) {
  let acc = await LedgerAccount.findOne({
    where: {
      account_type: 'CHARGEBACK_RESERVE',
      client_id: { [Op.is]: null },
      specialist_id: { [Op.is]: null },
    },
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  if (!acc) {
    acc = await LedgerAccount.create(
      {
        account_type: 'CHARGEBACK_RESERVE',
        currency: 'BRL',
        label: 'Reserva chargeback / disputas',
        cached_balance: null,
      },
      { transaction: t }
    );
  }
  return acc;
}

async function ensureClientWallet(clientId, t) {
  let acc = await LedgerAccount.findOne({
    where: { client_id: clientId, account_type: 'CLIENT_WALLET' },
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  if (!acc) {
    acc = await LedgerAccount.create(
      {
        client_id: clientId,
        account_type: 'CLIENT_WALLET',
        currency: 'BRL',
        label: 'Carteira',
        cached_balance: 0,
      },
      { transaction: t }
    );
  }
  return acc;
}

async function applyMpSnapshotToOrder(order, mp, t) {
  const gross = mp.transaction_amount != null ? Number(mp.transaction_amount) : null;
  const net =
    mp.transaction_details?.net_received_amount != null
      ? Number(mp.transaction_details.net_received_amount)
      : null;
  const fee =
    Number.isFinite(gross) && Number.isFinite(net) ? Math.max(0, roundMoney(gross - net)) : null;

  const patch = {
    mp_payment_id: String(mp.id),
    mp_merchant_order_id: mp.order?.id != null ? String(mp.order.id) : order.mp_merchant_order_id,
    mp_status: mp.status,
    mp_status_detail: mp.status_detail || null,
    mp_payment_method_id: mp.payment_method_id || null,
    mp_payment_type_id: mp.payment_type_id || null,
    mp_transaction_amount: Number.isFinite(gross) ? gross : order.mp_transaction_amount,
    mp_net_received_amount: Number.isFinite(net) ? net : order.mp_net_received_amount,
    mp_fee_amount: fee != null ? fee : order.mp_fee_amount,
  };

  if (mp.point_of_interaction?.transaction_data?.qr_code) {
    patch.pix_qr_code = mp.point_of_interaction.transaction_data.qr_code;
  }
  if (mp.point_of_interaction?.transaction_data?.qr_code_base64) {
    patch.pix_qr_code_base64 = mp.point_of_interaction.transaction_data.qr_code_base64;
  }
  const exp = mp.date_of_expiration;
  if (exp) {
    const d = new Date(exp);
    if (Number.isFinite(d.getTime())) patch.pix_expires_at = d;
  }

  await order.update(patch, { transaction: t });
}

async function inactivateCreditLotsForOrder(orderId, reason, t) {
  const lots = await ClientCreditLot.findAll({
    where: { payment_order_id: orderId },
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  for (const lot of lots) {
    const rem = Number(lot.remaining_amount || 0);
    if (rem <= 0 && lot.is_locked) continue;
    await lot.update(
      {
        remaining_amount: 0,
        is_locked: true,
        notes: `${reason}`.slice(0, 500),
      },
      { transaction: t }
    );
  }
  return lots;
}

/** @param {'REFUND'|'CHARGEBACK'} kind */
async function reverseWalletTopup(order, mp, kind, t) {
  const amountGoal = Number(order.mp_net_received_amount ?? order.amount ?? 0);
  if (!Number.isFinite(amountGoal) || amountGoal <= 0) return;

  const wallet = await ensureClientWallet(order.client_id, t);
  const reserve =
    kind === 'CHARGEBACK' ? await ensureChargebackReserve(t) : await ensurePlatformSuspense(t);

  const idem =
    kind === 'CHARGEBACK'
      ? `mp-pay-chargeback-${mp.id}`
      : `mp-pay-refund-${mp.id}`;

  const exists = await TransactionLedger.findOne({ where: { idempotency_key: idem }, transaction: t });
  if (exists) return;

  const bal = Number(wallet.cached_balance ?? 0);
  const reversal = Math.min(bal, amountGoal);
  if (reversal <= 0) return;

  await TransactionLedger.create(
    {
      debit_account_id: wallet.id,
      credit_account_id: reserve.id,
      amount: reversal,
      reference_type: kind,
      reference_id: order.id,
      idempotency_key: idem,
      description:
        kind === 'CHARGEBACK'
          ? `Chargeback MP #${mp.id} (${mp.status_detail || ''})`.trim()
          : `Estorno MP #${mp.id}`,
      metadata: {
        mp_payment_id: String(mp.id),
        mp_status: mp.status,
        mp_status_detail: mp.status_detail || null,
      },
      occurred_at: new Date(),
    },
    { transaction: t }
  );

  await wallet.update({ cached_balance: roundMoney(bal - reversal) }, { transaction: t });
}

async function handleApproved(order, mp, t) {
  await applyMpSnapshotToOrder(order, mp, t);
  await order.reload({ transaction: t, lock: t.LOCK.UPDATE });

  if (order.status === 'PAID') return;

  const creditBrl = pickCreditBrlFromMp(order, mp);
  if (!creditBrl) {
    throw new AppError('Não foi possível determinar o valor líquido/bruto do pagamento.', 500, null, false);
  }

  const idem = `mp-pay-approved-${mp.id}`;
  const dup = await TransactionLedger.findOne({ where: { idempotency_key: idem }, transaction: t });
  if (dup) {
    await order.update(
      {
        status: 'PAID',
        paid_at: order.paid_at || new Date(),
        payment_method: mapPaymentMethod(mp),
      },
      { transaction: t }
    );
    return;
  }

  const suspense = await ensurePlatformSuspense(t);
  const wallet = await ensureClientWallet(order.client_id, t);

  await TransactionLedger.create(
    {
      debit_account_id: suspense.id,
      credit_account_id: wallet.id,
      amount: creditBrl,
      reference_type: 'PAYMENT_TOPUP',
      reference_id: order.id,
      idempotency_key: idem,
      description: `Recarga aprovada (MP ${mp.id})`,
      metadata: {
        mp_payment_id: String(mp.id),
        mp_transaction_amount: order.mp_transaction_amount,
        mp_net_received_amount: order.mp_net_received_amount,
        mp_fee_amount: order.mp_fee_amount,
      },
      occurred_at: new Date(mp.date_approved || Date.now()),
    },
    { transaction: t }
  );

  const ctx = order.checkout_context || {};
  const creditType = ctx.credit_type || 'AVULSO';

  const validTypes = ClientCreditLot.CREDIT_TYPES || ['AVULSO', 'PACOTE_SESSAO_UNICA'];
  const lotType = validTypes.includes(creditType) ? creditType : 'AVULSO';

  await ClientCreditLot.create(
    {
      client_id: order.client_id,
      payment_order_id: order.id,
      credit_type: lotType,
      initial_amount: creditBrl,
      remaining_amount: creditBrl,
      expires_at: null,
      notes: ctx.package_id ? `Pacote: ${ctx.package_id}` : ctx.label || null,
    },
    { transaction: t }
  );

  const newBal = roundMoney(Number(wallet.cached_balance ?? 0) + creditBrl);
  await wallet.update({ cached_balance: newBal }, { transaction: t });

  await order.update(
    {
      status: 'PAID',
      paid_at: new Date(mp.date_approved || Date.now()),
      payment_method: mapPaymentMethod(mp),
    },
    { transaction: t }
  );
}

async function handleRejected(order, mp, t) {
  await applyMpSnapshotToOrder(order, mp, t);
  await order.update(
    {
      status: 'FAILED',
      mp_status_detail:
        `${mp.status_detail || ''}`.trim() || `${mp.status || ''}`.trim() || 'unknown',
    },
    { transaction: t }
  );
}

async function handleRefund(order, mp, t) {
  await applyMpSnapshotToOrder(order, mp, t);
  const wasPaid = `${order.status}` === 'PAID' || Boolean(order.paid_at);
  await order.update(
    {
      status: mp.status === 'partially_refunded' ? 'PARTIALLY_REFUNDED' : 'REFUNDED',
      refunded_at: new Date(),
      refund_reason: mp.status_detail || 'refunded',
    },
    { transaction: t }
  );
  await order.reload({ transaction: t, lock: t.LOCK.UPDATE });
  if (wasPaid) {
    await inactivateCreditLotsForOrder(order.id, `Estorno MP ${mp.id}`, t);
    await reverseWalletTopup(order, mp, 'REFUND', t);
  }
}

async function handleChargeback(order, mp, t) {
  await applyMpSnapshotToOrder(order, mp, t);
  await order.update(
    {
      status: 'CHARGEBACK',
      chargeback_opened_at: new Date(),
      chargeback_reason_code: mp.status_detail || 'charged_back',
      chargeback_notes: (() => {
        const s = JSON.stringify(cloneJson(mp) || {});
        return s.length > 12000 ? `${s.slice(0, 12000)}…` : s;
      })(),
    },
    { transaction: t }
  );
  await order.reload({ transaction: t, lock: t.LOCK.UPDATE });
  await inactivateCreditLotsForOrder(order.id, `Chargeback MP ${mp.id}`, t);
  await reverseWalletTopup(order, mp, 'CHARGEBACK', t);
}

async function handleInProcess(order, mp, t) {
  await applyMpSnapshotToOrder(order, mp, t);
  await order.update(
    {
      status: 'PROCESSING',
    },
    { transaction: t }
  );
}

/**
 * @param {import('express').Request['user']} user — Sequelize User com `client_profile`
 */
async function createPixCheckout(user, body = {}) {
  const client = user.client_profile;
  if (!client || !client.id) {
    throw new AppError('Apenas clientes autenticados podem gerar PIX.', 403, null, true);
  }

  const purchase = resolvePurchaseInput(body);
  const externalReference = randomUUID();
  const payerEmail = `${user.email || ''}`.trim();
  if (!payerEmail) {
    throw new AppError('E-mail do utilizador em falta — necessário para o Mercado Pago.', 400, null, true);
  }

  const order = await PaymentOrder.create({
    client_id: client.id,
    user_id: user.id,
    external_reference: externalReference,
    amount: purchase.amount_brl,
    currency: 'BRL',
    status: 'PENDING',
    payment_method: 'PIX',
    checkout_context: {
      package_id: purchase.package_id,
      credit_type: purchase.credit_type,
      label: purchase.label,
    },
  });

  try {
    const mpPayment = await mpClient.createPixPayment({
      transaction_amount: purchase.amount_brl,
      description: `[Fadas do Bem] ${purchase.label}`.slice(0, 256),
      external_reference: externalReference,
      payer_email: payerEmail,
      payer_first_name: client.nome || client.tratar_por || 'Cliente',
      payer_last_name: '',
      notification_url: resolveNotificationUrl(),
    });

    const pixExpRaw = mpPayment.date_of_expiration;
    const pixExp = pixExpRaw ? new Date(pixExpRaw) : null;

    await order.update({
      mp_payment_id: String(mpPayment.id),
      pix_qr_code: mpPayment.point_of_interaction?.transaction_data?.qr_code || null,
      pix_qr_code_base64: mpPayment.point_of_interaction?.transaction_data?.qr_code_base64 || null,
      mp_status: mpPayment.status || null,
      mp_status_detail: mpPayment.status_detail || null,
      pix_expires_at: pixExp && Number.isFinite(pixExp.getTime()) ? pixExp : null,
    });

    if (mpPayment.status === 'approved') {
      await sequelize.transaction(async (t) => {
        const locked = await PaymentOrder.findByPk(order.id, { transaction: t, lock: t.LOCK.UPDATE });
        await handleApproved(locked, mpPayment, t);
      });
    }

    return {
      payment_order_id: order.id,
      external_reference: externalReference,
      mp_payment_id: String(mpPayment.id),
      mp_status: mpPayment.status,
      pix: {
        qr_code:
          mpPayment.point_of_interaction?.transaction_data?.qr_code ||
          order.pix_qr_code ||
          null,
        qr_code_base64:
          mpPayment.point_of_interaction?.transaction_data?.qr_code_base64 ||
          order.pix_qr_code_base64 ||
          null,
        expires_at: order.pix_expires_at || mpPayment.date_of_expiration || null,
      },
    };
  } catch (err) {
    await order
      .update({
        status: 'FAILED',
        mp_status_detail: err?.message?.slice?.(0, 256) || String(err),
      })
      .catch(() => {});
    throw err;
  }
}

async function createCardCheckout(user, body = {}) {
  const client = user.client_profile;
  if (!client || !client.id) {
    throw new AppError('Apenas clientes autenticados podem pagar com cartão.', 403, null, true);
  }

  const token = `${body.token || ''}`.trim();
  const payment_method_id = `${body.payment_method_id || ''}`.trim();
  if (!token || !payment_method_id) {
    throw new AppError(
      'token e payment_method_id são obrigatórios (Bricks / checkout transparente).',
      400,
      null,
      true
    );
  }

  const purchase = resolvePurchaseInput(body);
  const externalReference = randomUUID();
  const payerEmail = `${user.email || ''}`.trim();
  if (!payerEmail) {
    throw new AppError('E-mail do utilizador em falta — necessário para o Mercado Pago.', 400, null, true);
  }
  const installments = parseInt(`${body.installments ?? 1}`, 10) || 1;

  const order = await PaymentOrder.create({
    client_id: client.id,
    user_id: user.id,
    external_reference: externalReference,
    amount: purchase.amount_brl,
    currency: 'BRL',
    status: 'PENDING',
    payment_method: 'CREDIT_CARD',
    checkout_context: {
      package_id: purchase.package_id,
      credit_type: purchase.credit_type,
      label: purchase.label,
      installments,
    },
  });

  try {
    const payer_identification =
      body.payer_identification?.type && body.payer_identification?.number
        ? {
            type: String(body.payer_identification.type),
            number: String(body.payer_identification.number).replace(/\D/g, ''),
          }
        : undefined;

    const mpPayment = await mpClient.createCardPayment({
      transaction_amount: purchase.amount_brl,
      description: `[Fadas do Bem] ${purchase.label}`.slice(0, 256),
      external_reference: externalReference,
      token,
      payment_method_id,
      installments,
      issuer_id: body.issuer_id,
      payer_email: payerEmail,
      payer_identification,
      notification_url: resolveNotificationUrl(),
    });

    await order.update({
      mp_payment_id: String(mpPayment.id),
      mp_status: mpPayment.status || null,
      mp_status_detail: mpPayment.status_detail || null,
      card_last_four_digits: mpPayment.card?.last_four_digits || null,
      installments,
    });

    await sequelize.transaction(async (t) => {
      const locked = await PaymentOrder.findByPk(order.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (mpPayment.status === 'approved') {
        await handleApproved(locked, mpPayment, t);
      } else if (
        mpPayment.status === 'rejected' ||
        mpPayment.status === 'cancelled' ||
        mpPayment.status === 'canceled'
      ) {
        await handleRejected(locked, mpPayment, t);
      } else {
        await handleInProcess(locked, mpPayment, t);
      }
    });

    const fresh = await PaymentOrder.findByPk(order.id, { paranoid: true });
    return {
      payment_order_id: fresh.id,
      external_reference: externalReference,
      mp_payment_id: String(mpPayment.id),
      mp_status: mpPayment.status,
      mp_status_detail: mpPayment.status_detail || null,
      internal_status: fresh.status,
    };
  } catch (err) {
    await order
      .update({
        status: 'FAILED',
        mp_status_detail: err?.message?.slice?.(0, 256) || String(err),
      })
      .catch(() => {});
    throw err;
  }
}

/**
 * Processamento assíncrono — chamado depois do HTTP 200.
 *
 * @param {{
 *   body: object;
 *   query?: object;
 *   headers?: Record<string, string | string[] | undefined>;
 * }} envelope
 */
async function processMercadoPagoWebhookAsync(envelope = {}) {
  const body = envelope.body && typeof envelope.body === 'object' ? envelope.body : {};

  console.log('[MP:Webhook] --- início processamento async ---');

  if (isMpWebhookVerbose()) {
    console.log('[MP:Webhook] envelope (payload bruto + query)', {
      query: envelope.query || {},
      body_json: safeJsonForLog(body, 48000),
    });
  } else {
    console.log('[MP:Webhook] resumo notificação', {
      action: body.action,
      type: body.type,
      live_mode: body.live_mode,
      data_id: body.data?.id,
      api_version: body.api_version,
      date_created: body.date_created,
    });
  }

  if (!assertNoTestNotificationInProduction(body, null)) {
    console.warn('[MP:Webhook] abortado pela trava production/sandbox (payload).');
    return;
  }

  let paymentId = body?.data?.id ?? envelope.query?.['data.id'];
  if (paymentId == null && envelope.query?.data?.id != null) {
    paymentId = envelope.query.data.id;
  }

  paymentId = paymentId != null ? String(paymentId).trim() : '';
  if (!paymentId) {
    console.warn('[MP:Webhook] sem data.id no corpo/query — ignorado');
    return;
  }

  let mpPayment;
  try {
    mpPayment = await mpClient.getPaymentById(paymentId);
  } catch (e) {
    console.error('[MP:Webhook] getPaymentById falhou:', e?.message || e);
    throw e;
  }

  if (!assertNoTestNotificationInProduction(body, mpPayment)) {
    console.warn('[MP:Webhook] abortado pela trava production/sandbox (GET payment live_mode).', {
      payment_id: mpPayment?.id,
    });
    return;
  }

  if (isMpWebhookVerbose()) {
    console.log(
      '[MP:Webhook] GET /v1/payments/:id — resposta API',
      safeJsonForLog(mpPayment, 48000)
    );
  } else {
    console.log('[MP:Webhook] GET /v1/payments/:id — resumo', {
      id: mpPayment.id,
      status: mpPayment.status,
      status_detail: mpPayment.status_detail,
      live_mode: mpPayment.live_mode,
      external_reference: mpPayment.external_reference,
      transaction_amount: mpPayment.transaction_amount,
      net_received: mpPayment.transaction_details?.net_received_amount,
    });
  }

  const extRef = `${mpPayment.external_reference || ''}`.trim();
  let order =
    extRef &&
    (await PaymentOrder.findOne({
      where: { external_reference: extRef },
      paranoid: true,
    }));

  if (!order) {
    order = await PaymentOrder.findOne({
      where: { mp_payment_id: String(mpPayment.id) },
      paranoid: true,
    });
  }

  const vaultEntry = {
    gateway: 'mercadopago',
    notification: cloneJson(body),
    mp_payment_snapshot: {
      id: mpPayment.id,
      status: mpPayment.status,
      status_detail: mpPayment.status_detail,
    },
    headers: redactWebhookHeaders(envelope.headers || {}),
    query: cloneJson(envelope.query) || envelope.query || {},
  };

  if (!order) {
    console.warn('[MP:Webhook] PaymentOrder não encontrado', {
      external_reference: extRef || null,
      mp_id: mpPayment.id,
    });
    return;
  }

  console.log('[MP:Webhook] PaymentOrder encontrado', {
    payment_order_id: order.id,
    external_reference: order.external_reference,
    status_atual_bd: order.status,
  });

  await sequelize.transaction(async (t) => {
    const locked = await PaymentOrder.findByPk(order.id, { transaction: t, lock: t.LOCK.UPDATE });
    const mergedVault = appendWebhookVault(locked.raw_webhook_payload, vaultEntry);
    await locked.update({ raw_webhook_payload: mergedVault }, { transaction: t });

    switch (mpPayment.status) {
      case 'approved':
        await handleApproved(locked, mpPayment, t);
        break;

      case 'rejected':
      case 'cancelled':
      case 'canceled':
        await handleRejected(locked, mpPayment, t);
        break;

      case 'refunded':
      case 'partially_refunded':
        await handleRefund(locked, mpPayment, t);
        break;

      case 'charged_back':
        await handleChargeback(locked, mpPayment, t);
        break;

      case 'pending':
      case 'in_process':
      case 'in_mediation':
        await handleInProcess(locked, mpPayment, t);
        break;

      default:
        await applyMpSnapshotToOrder(locked, mpPayment, t);
        console.log('[MP:Webhook] status não mapeado em switch', mpPayment.status);
    }
  });

  console.log('[MP:Webhook] --- fim processamento ---', {
    payment_order_id: order.id,
    mp_payment_id: mpPayment.id,
    mp_status: mpPayment.status,
  });
}

module.exports = {
  createPixCheckout,
  createCardCheckout,
  processMercadoPagoWebhookAsync,
  resolvePurchaseInput,
};
