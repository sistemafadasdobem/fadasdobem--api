const { responderSucesso } = require('../../utils/response.util');
const { catchAsyncRoute } = require('../../utils/catchAsync.util');
const sessionsService = require('./sessions.service');

module.exports = {
  /**
   * GET /api/v1/sessions/:id/token · Auth Bearer
   * Query: `role` = `publisher` (taróloga) ou `subscriber`/`audience` (cliente);
   * opcional `expiresIn` ou `expiresInSeconds` (60–86400).
   */
  getRtcJoinToken: catchAsyncRoute(async (req, res) => {
    const dados = await sessionsService.getRtcTokenForAuthenticatedUser(
      req.params.id,
      req.user.id,
      {
        role: req.query.role,
        expiresInSeconds: req.query.expiresIn ?? req.query.expirationSecs ?? req.query.expiresInSeconds,
      }
    );
    return responderSucesso(res, dados, 'Credenciais RTC Agora geradas.', 200);
  }),

  /** Resposta rápida 200; processamento deferido para não causar retry do NCS. */
  receiveAgoraNcsWebhook(req, res) {
    responderSucesso(res, { aceito: true }, 'Webhook NCS recebido.', 200);
    setImmediate(() => {
      sessionsService.processAgoraNcsWebhookAsync(req.body || {}).catch((err) => {
        console.error('[sessions:agora-ncs-async]', err?.message || err);
      });
    });
  },
};
