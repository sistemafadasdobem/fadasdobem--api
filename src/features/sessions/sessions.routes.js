const { Router } = require('express');
const authMiddleware = require('../../middlewares/auth.middleware');
const requireClienteRole = require('../../middlewares/clienteRole.middleware');
const requireTarologaRole = require('../../middlewares/tarologaRole.middleware');
const sessionsController = require('./sessions.controller');

const router = Router();

router.post('/agora-webhook', sessionsController.receiveAgoraNcsWebhook);
router.post('/intelbras-webhook', sessionsController.receiveIntelbrasWebhook);
router.post('/', authMiddleware, sessionsController.createSession);
router.post('/:id/review', authMiddleware, requireClienteRole, sessionsController.submitSessionReview);
router.patch('/:id/ritual', authMiddleware, requireTarologaRole, sessionsController.patchSessionRitual);
router.get('/:id/token', authMiddleware, sessionsController.getRtcJoinToken);

module.exports = router;
