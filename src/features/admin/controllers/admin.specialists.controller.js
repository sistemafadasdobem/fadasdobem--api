'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const {
  approveOrRejectTarologa,
  patchRankingBoostMultiplier,
  listSpecialistsAdmin,
} = require('../services/admin.specialists.service');

function httpCtx(req) {
  return {
    ip: req.ip || req.socket?.remoteAddress,
    user_agent: req.headers['user-agent'],
    correlation_id: req.headers['x-request-id'],
  };
}

module.exports = {
  list: catchAsyncRoute(async (req, res) => {
    const dados = await listSpecialistsAdmin(req.query || {});
    return responderSucesso(res, { items: dados, count: dados.length }, 'Lista administrativa tarólogas.', 200);
  }),

  patchApprove: catchAsyncRoute(async (req, res) => {
    const dados = await approveOrRejectTarologa(req.user.id, req.params.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Fluxo cadastro/especialista actualizado pela Gestora.', 200);
  }),

  patchRankingBoost: catchAsyncRoute(async (req, res) => {
    const dados = await patchRankingBoostMultiplier(req.user.id, req.params.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Ranking boost/manual guardado.', 200);
  }),
};
