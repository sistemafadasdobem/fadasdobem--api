const { responderSucesso } = require('../../utils/response.util');
const { catchAsyncRoute } = require('../../utils/catchAsync.util');
const sessionsService = require('./sessions.service');

module.exports = {
  /**
   * POST /api/v1/sessions · Auth Bearer (perfil **cliente**)
   * Body: `specialist_id`, `modality` (TEXTO|VOZ|VIDEO), opcional `status` (SCHEDULED|READY)
   */
  createSession: catchAsyncRoute(async (req, res) => {
    const dados = await sessionsService.createSession(req.user, req.body || {});
    return responderSucesso(res, dados, 'Sessão criada.', 201);
  }),

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
    const snap = sessionsService.summarizeNcsBodyForLog(req.body || {});
    console.log('[Agora:Webhook] HTTP recebido · respondendo 200 imediato', {
      snap,
      ip: req.ip || req.socket?.remoteAddress,
    });
    responderSucesso(res, { aceito: true }, 'Webhook NCS recebido.', 200);
    setImmediate(() => {
      sessionsService.processAgoraNcsWebhookAsync(req.body || {}).catch((err) => {
        console.error('[Agora:Webhook] falha no processamento async', err?.stack || err?.message || err);
      });
    });
  },
};
