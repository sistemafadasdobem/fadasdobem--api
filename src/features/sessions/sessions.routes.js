const { Router } = require('express');
const authMiddleware = require('../../middlewares/auth.middleware');
const sessionsController = require('./sessions.controller');

const router = Router();

router.post('/agora-webhook', sessionsController.receiveAgoraNcsWebhook);
router.post('/', authMiddleware, sessionsController.createSession);
router.get('/:id/token', authMiddleware, sessionsController.getRtcJoinToken);

module.exports = router;
