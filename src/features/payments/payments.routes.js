'use strict';

const { Router } = require('express');
const authMiddleware = require('../../middlewares/auth.middleware');
const { validateMercadoPagoWebhook } = require('../../middlewares/mpSignature.middleware');
const paymentsController = require('./payments.controller');

const router = Router();

/** Checkout transparente PIX (cliente autenticado). */
router.post('/pix', authMiddleware, paymentsController.createPixCheckout);
/** Checkout transparente cartão — token gerado no front (Bricks/SDK). */
router.post('/card', authMiddleware, paymentsController.createCardCheckout);

/**
 * Webhook público Mercado Pago.
 * IMPORTANTE: o corpo JSON já deve estar parseado (ver `express.json()` no `app.js` antes qualquer middleware desta árvore).
 */
router.post('/webhook', validateMercadoPagoWebhook, paymentsController.receiveMercadoPagoWebhook);

module.exports = router;
