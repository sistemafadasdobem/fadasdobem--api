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
   * Consulta 1-a-1: o token é sempre gerado com privilégio de publicação (RtcRole.PUBLISHER).
   * Query `role` é legado e ignorada. Opcional: `expiresIn` / `expiresInSeconds` (60–86400).
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

  /** Resposta rápida 200; processamento deferido (retry do Wide Voice / Nginx). */
  receiveIntelbrasWebhook(req, res) {
    const preview =
      req.body && typeof req.body === 'object'
        ? {
            Evento: req.body.Evento ?? req.body.evento ?? null,
            UniqueId: req.body.UniqueId ?? null,
          }
        : {};
    console.log('[Intelbras:Webhook] HTTP recebido · respondendo 200 imediato', {
      preview,
      ip: req.ip || req.socket?.remoteAddress,
    });
    responderSucesso(res, { aceito: true }, 'Webhook Intelbras recebido.', 200);
    setImmediate(() => {
      sessionsService.processIntelbrasTelephonyWebhookAsync(req.body || {}).catch((err) => {
        console.error('[Intelbras:Webhook] falha no processamento async', err?.stack || err?.message || err);
      });
    });
  },
};
