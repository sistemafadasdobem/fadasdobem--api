'use strict';

const { responderSucesso } = require('../../utils/response.util');
const { catchAsyncRoute } = require('../../utils/catchAsync.util');
const paymentsService = require('./payments.service');

/** Alinhado a `payments.service.isMpWebhookVerbose` — JSON completo no log. */
function mpWebhookLogVerbose() {
  const v = process.env.MP_WEBHOOK_VERBOSE;
  if (v === undefined || String(v).trim() === '') return true;
  return ['true', '1', 'yes', 'on'].includes(String(v).trim().toLowerCase());
}

module.exports = {
  createPixCheckout: catchAsyncRoute(async (req, res) => {
    const dados = await paymentsService.createPixCheckout(req.user, req.body || {});
    return responderSucesso(res, dados, 'PIX gerado. Conclua o pagamento para creditar o saldo.', 201);
  }),

  createCardCheckout: catchAsyncRoute(async (req, res) => {
    const dados = await paymentsService.createCardCheckout(req.user, req.body || {});
    return responderSucesso(res, dados, 'Pagamento com cartão processado.', 201);
  }),

  /**
   * GET/HEAD — apenas para comprovar que o URL existe (painel MP, proxies, curl).
   * **As notificações reais são sempre POST** com assinatura `x-signature`.
   */
  mercadoPagoWebhookProbeGet(_req, res) {
    return res.status(200).json({
      ok: true,
      recurso: 'mercadopago_webhook',
      metodo_notificacao: 'POST',
      path_esperado: '/api/v1/payments/webhook',
    });
  },

  mercadoPagoWebhookProbeHead(_req, res) {
    return res.status(200).end();
  },

  /**
   * `express.json()` global deve ter parseado o corpo antes do middleware de assinatura.
   * O fluxo espera terminar antes do **200**: erros recuperáveis (ex.: mutex Redis / indisponibilidade
   * transitória) regressam como **503** para o Mercado Pago repetir a notificação.
   */
  receiveMercadoPagoWebhook: catchAsyncRoute(async (req, res) => {
    const sig = req.get('x-signature') || '';
    console.log('[MP:Webhook] recebido', {
      ip: req.ip || req.socket?.remoteAddress,
      method: req.method,
      path: req.originalUrl,
      query: req.query || {},
      action: req.body?.action,
      type: req.body?.type,
      live_mode: req.body?.live_mode,
      data_id: req.body?.data?.id,
      x_request_id: req.get('x-request-id'),
      x_signature_length: sig.length,
      x_signature_preview: sig ? `${sig.slice(0, 24)}…` : null,
    });
    if (mpWebhookLogVerbose()) {
      try {
        console.log(
          '[MP:Webhook] body bruto (HTTP)',
          typeof req.body === 'object' ? JSON.stringify(req.body, null, 2) : String(req.body)
        );
      } catch (e) {
        console.log('[MP:Webhook] body não serializável', e?.message);
      }
    }

    const hdrs = {
      'x-request-id': req.get('x-request-id'),
      'x-signature': req.get('x-signature'),
    };
    const envelope = {
      body: req.body || {},
      query: req.query || {},
      headers: hdrs,
    };

    await paymentsService.processMercadoPagoWebhookAsync(envelope);
    return responderSucesso(res, { aceito: true }, 'Webhook Mercado Pago processado.', 200);
  }),
};
